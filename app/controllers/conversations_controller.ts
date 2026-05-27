import type { HttpContext } from '@adonisjs/core/http'

import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Conversation from '#models/conversation'
import ConversationMember from '#models/conversation_member'
import Friendship from '#models/friendship'
import Message from '#models/message'
import User from '#models/user'
import UserBlock from '#models/user_block'
import GroupJoinRequest from '#models/group_join_request'
import { ApiResponse } from '#utils/api_response'
import {
  createDirectConversationValidator,
  createGroupConversationValidator,
  addMembersValidator,
  updateMemberRoleValidator,
  updateMemberNicknameValidator,
  transferOwnershipValidator,
  markReadValidator,
  joinByCodeValidator,
  updateGroupSettingsValidator,
} from '#validators/conversation'
import { generateInviteCode } from '#models/conversation'
import { updateAvatarValidator } from '#validators/update_avatar'
import messageService from '#services/message_service'
import realtimeService from '#services/realtime_service'
import s3Service from '#services/s3_service'
import chatbot from '#services/chatbot_service'

/** Resolve a conversation by its public UUID. */
async function resolveByUuid(uuid: string) {
  return Conversation.query().where('uuid', uuid).first()
}

/** Resolve a batch of user UUIDs to their numeric ids. */
async function resolveUserIds(uuids: string[]): Promise<number[]> {
  if (uuids.length === 0) return []
  const rows = await User.query().whereIn('uuid', uuids).select('id')
  return rows.map((u) => u.id)
}

/**
 * For each direct conversation, figure out whether the current user is
 * blocking (or is blocked by) the OTHER participant. Returns two maps
 * keyed by conversation id. Group conversations are never in the maps.
 */
async function computeDirectBlockStatus(
  meId: number,
  conversations: Conversation[]
): Promise<{
  blockedByMe: Map<number, boolean>
  blockedByOther: Map<number, boolean>
}> {
  const blockedByMe = new Map<number, boolean>()
  const blockedByOther = new Map<number, boolean>()

  // Collect (convId, otherUserId) for directs only.
  const pairs: Array<{ convId: number; otherId: number }> = []
  for (const c of conversations) {
    if (c.type !== 'direct') continue
    const other = c.members.find((m) => m.userId !== meId)
    if (other) pairs.push({ convId: c.id, otherId: other.userId })
  }
  if (pairs.length === 0) return { blockedByMe, blockedByOther }

  const otherIds = pairs.map((p) => p.otherId)

  // One round-trip covers both directions of the relationship.
  const blocks = await UserBlock.query().where((q) => {
    q.where((s) => s.where('blocker_id', meId).whereIn('blocked_id', otherIds)).orWhere((s) =>
      s.whereIn('blocker_id', otherIds).where('blocked_id', meId)
    )
  })

  const mineSet = new Set<number>()
  const theirSet = new Set<number>()
  for (const b of blocks) {
    if (b.blockerId === meId) mineSet.add(b.blockedId)
    else theirSet.add(b.blockerId)
  }

  for (const p of pairs) {
    if (mineSet.has(p.otherId)) blockedByMe.set(p.convId, true)
    if (theirSet.has(p.otherId)) blockedByOther.set(p.convId, true)
  }

  return { blockedByMe, blockedByOther }
}

/**
 * For each direct conversation, figure out the friendship state
 * between the current user and the OTHER participant. Returns per-conv
 * flags + the friendship UUID when one exists (needed for Accept /
 * Cancel request actions in the UI).
 */
type DirectFriendshipStatus = {
  isFriend: boolean
  friendRequestSent: boolean
  friendRequestReceived: boolean
  friendshipId: string | null
}

async function computeDirectFriendshipStatus(
  meId: number,
  conversations: Conversation[]
): Promise<Map<number, DirectFriendshipStatus>> {
  const out = new Map<number, DirectFriendshipStatus>()

  const pairs: Array<{ convId: number; otherId: number }> = []
  for (const c of conversations) {
    if (c.type !== 'direct') continue
    const other = c.members.find((m) => m.userId !== meId)
    if (other) pairs.push({ convId: c.id, otherId: other.userId })
  }
  if (pairs.length === 0) return out

  const otherIds = pairs.map((p) => p.otherId)
  const rows = await Friendship.query().where((q) => {
    q.where((s) => s.where('requester_id', meId).whereIn('addressee_id', otherIds)).orWhere((s) =>
      s.whereIn('requester_id', otherIds).where('addressee_id', meId)
    )
  })

  // Index by the "other user id" for O(1) lookup.
  const byOther = new Map<number, Friendship>()
  for (const r of rows) {
    const otherUserId = r.requesterId === meId ? r.addresseeId : r.requesterId
    byOther.set(otherUserId, r)
  }

  for (const p of pairs) {
    const row = byOther.get(p.otherId)
    if (!row) {
      out.set(p.convId, {
        isFriend: false,
        friendRequestSent: false,
        friendRequestReceived: false,
        friendshipId: null,
      })
      continue
    }
    const isFriend = row.status === 'accepted'
    const friendRequestSent = row.status === 'pending' && row.requesterId === meId
    const friendRequestReceived = row.status === 'pending' && row.addresseeId === meId
    out.set(p.convId, {
      isFriend,
      friendRequestSent,
      friendRequestReceived,
      friendshipId: row.uuid,
    })
  }

  return out
}

/**
 * Batch-compute the unread message count per conversation for a given
 * user. A message is "unread" when:
 *   - it belongs to one of the target conversations,
 *   - it is NOT authored by the user themselves, and
 *   - its `created_at` is newer than the user's `last_read_at` on that
 *     conversation (or the user has never read it).
 *
 * Single JOIN query, grouped by conversation.
 */
async function computeUnreadCounts(
  userId: number,
  conversationIds: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  if (conversationIds.length === 0) return out

  const rows = await db
    .from('messages as m')
    .innerJoin('conversation_members as cm', 'cm.conversation_id', 'm.conversation_id')
    .where('cm.user_id', userId)
    .whereIn('m.conversation_id', conversationIds)
    .whereRaw('m.sender_id != ?', [userId])
    .andWhere((q) => {
      q.whereNull('cm.last_read_at').orWhereRaw('m.created_at > cm.last_read_at')
    })
    .groupBy('m.conversation_id')
    .select('m.conversation_id as conversationId')
    .count('* as total')

  for (const row of rows) {
    out.set(Number(row.conversationId), Number(row.total))
  }
  return out
}

export default class ConversationsController {
  /**
   * @createDirect
   * @operationId createDirectConversation
   * @description Creates (or returns the existing) 1-1 conversation with a user.
   * @requestBody {"user_id": "string"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   */
  public async createDirect({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { user_id: otherUuid } = await request.validateUsing(createDirectConversationValidator)

    const other = await User.findBy('uuid', otherUuid)
    if (!other) return ApiResponse.error(response, 404, 'User not found.')
    const otherId = other.id

    if (otherId === me.id) {
      const existing = await db
        .from('conversations as c')
        .select('c.id')
        .where('c.type', 'direct')
        .whereIn('c.id', (subQuery) => {
          subQuery
            .from('conversation_members')
            .groupBy('conversation_id')
            .havingRaw('count(user_id) = 1')
            .select('conversation_id')
        })
        .whereIn('c.id', (subQuery) => {
          subQuery
            .from('conversation_members')
            .where('user_id', me.id)
            .select('conversation_id')
        })
        .first()

      if (existing) {
        const conv = await Conversation.query()
          .where('id', existing.id)
          .preload('members', (q) => q.preload('user'))
          .firstOrFail()
        const lastMsg = await Message.query()
          .where('conversation_id', conv.id)
          .preload('attachments')
          .preload('sender')
          .orderBy('id', 'desc')
          .first()
        const serializedMsg = lastMsg ? await messageService.serialize(lastMsg, me.id) : null
        const serializedConv = {
          ...conv.serialize(),
          messages: serializedMsg ? [serializedMsg] : [],
        }
        return ApiResponse.ok(response, 'OK', { conversation: serializedConv })
      }

      const conv = await db.transaction(async (trx) => {
        const c = await Conversation.create({ type: 'direct', createdBy: me.id }, { client: trx })
        await ConversationMember.create(
          { conversationId: c.id, userId: me.id, role: 'member' as const, joinedAt: DateTime.now() },
          { client: trx }
        )
        return c
      })

      await conv.load('members', (q) => q.preload('user'))
      await realtimeService.joinUserToConversation(me.id, conv)
      realtimeService.emitToUser(me.id, 'conversation:joined', {
        conversationId: conv.uuid,
      })

      return ApiResponse.created(response, 'Conversation created.', { conversation: conv })
    }

    // Find existing direct conversation
    const existing = await db
      .from('conversations as c')
      .select('c.id')
      .join('conversation_members as m1', 'm1.conversation_id', 'c.id')
      .join('conversation_members as m2', 'm2.conversation_id', 'c.id')
      .where('c.type', 'direct')
      .andWhere('m1.user_id', me.id)
      .andWhere('m2.user_id', otherId)
      .first()

    if (existing) {
      const conv = await Conversation.query()
        .where('id', existing.id)
        .preload('members', (q) => q.preload('user'))
        .firstOrFail()
      const lastMsg = await Message.query()
        .where('conversation_id', conv.id)
        .preload('attachments')
        .preload('sender')
        .orderBy('id', 'desc')
        .first()
      const serializedMsg = lastMsg ? await messageService.serialize(lastMsg, me.id) : null
      const serializedConv = {
        ...conv.serialize(),
        messages: serializedMsg ? [serializedMsg] : [],
      }
      return ApiResponse.ok(response, 'OK', { conversation: serializedConv })
    }

    const conv = await db.transaction(async (trx) => {
      const c = await Conversation.create({ type: 'direct', createdBy: me.id }, { client: trx })
      await ConversationMember.createMany(
        [
          { conversationId: c.id, userId: me.id, role: 'member', joinedAt: DateTime.now() },
          { conversationId: c.id, userId: otherId, role: 'member', joinedAt: DateTime.now() },
        ],
        { client: trx }
      )
      return c
    })

    await conv.load('members', (q) => q.preload('user'))

    // Realtime: make both users' sockets join the new conv room (so
    // `message:new` reaches them without reconnecting) and notify their
    // sidebars to insert the conversation. Without this the receiver
    // only learns about the new 1-1 on a full page refresh.
    await realtimeService.joinUserToConversation(me.id, conv)
    await realtimeService.joinUserToConversation(otherId, conv)
    realtimeService.emitToUser(me.id, 'conversation:joined', {
      conversationId: conv.uuid,
    })
    realtimeService.emitToUser(otherId, 'conversation:joined', {
      conversationId: conv.uuid,
    })

    return ApiResponse.created(response, 'Conversation created.', { conversation: conv })
  }

  /**
   * @createGroup
   * @operationId createGroupConversation
   * @description Creates a new group conversation. Creator becomes the owner.
   * @requestBody {"name": "string", "member_ids": "string[]"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   */
  public async createGroup({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const {
      name,
      member_ids: memberUuids,
      comments_restricted: commentsRestricted,
    } = await request.validateUsing(createGroupConversationValidator)

    const resolvedIds = await resolveUserIds(memberUuids)
    const uniqueIds = Array.from(new Set(resolvedIds.filter((id) => id !== me.id)))
    if (uniqueIds.length === 0) {
      return ApiResponse.error(response, 400, 'Group must have at least one other member.')
    }

    const conv = await db.transaction(async (trx) => {
      const c = await Conversation.create(
        {
          type: 'group',
          name,
          ownerId: me.id,
          createdBy: me.id,
          commentsRestricted: commentsRestricted ?? false,
        },
        { client: trx }
      )
      const rows = [
        { conversationId: c.id, userId: me.id, role: 'owner' as const, joinedAt: DateTime.now() },
        ...uniqueIds.map((id) => ({
          conversationId: c.id,
          userId: id,
          role: 'member' as const,
          joinedAt: DateTime.now(),
        })),
      ]
      await ConversationMember.createMany(rows, { client: trx })
      return c
    })

    await conv.load('members', (q) => q.preload('user'))

    // Notify every invited member so their sidebar list refreshes
    // in real time. Also make their sockets join the new conv room
    // so subsequent message events reach them without a reconnect.
    for (const invitedId of uniqueIds) {
      await realtimeService.joinUserToConversation(invitedId, conv)
      realtimeService.emitToUser(invitedId, 'conversation:joined', {
        conversationId: conv.uuid,
      })
    }
    // The creator's other tabs also need to know.
    await realtimeService.joinUserToConversation(me.id, conv)
    realtimeService.emitToUser(me.id, 'conversation:joined', {
      conversationId: conv.uuid,
    })

    return ApiResponse.created(response, 'Group created.', { conversation: conv })
  }

  /**
   * @list
   * @operationId listConversations
   * @description Lists the current user's conversations sorted by last message time (desc).
   * @responseBody 200 - {"success": true, "message": "string", "data": {"conversations": "array"}}
   */
  public async list({ response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    
    // Clean up duplicate AI conversations and messages older than 24 hours
    await chatbot.cleanupAiConversations(me.id)

    // Clean up duplicate or invalid self-conversations
    try {
      const selfConvIds = await db
        .from('conversation_members as m')
        .join('conversations as c', 'c.id', 'm.conversation_id')
        .where('c.type', 'direct')
        .groupBy('m.conversation_id')
        .havingRaw('sum(case when m.user_id = ? then 1 else 0 end) = count(*)', [me.id])
        .select('m.conversation_id as id')
      
      const idsArray = selfConvIds.map((row) => row.id)
      if (idsArray.length > 1) {
        const withMessages = await db
          .from('messages')
          .whereIn('conversation_id', idsArray)
          .groupBy('conversation_id')
          .select('conversation_id')
        
        const withMsgSet = new Set(withMessages.map((row) => row.conversation_id))
        let keptId = idsArray.find((id) => withMsgSet.has(id))
        if (!keptId) keptId = idsArray[0]
        
        const toDelete = idsArray.filter((id) => id !== keptId)
        if (toDelete.length > 0) {
          await db.from('conversation_members').whereIn('conversation_id', toDelete).delete()
          await db.from('conversations').whereIn('id', toDelete).delete()
        }
      }
    } catch (err) {
      // ignore
    }

    const memberships = await ConversationMember.query().where('user_id', me.id)
    const ids = memberships.map((m) => m.conversationId)
    if (ids.length === 0) return ApiResponse.ok(response, 'OK', { conversations: [] })

    // Exclude the AI bot's conversation ID from the general list
    const bot = await chatbot.getBotUser()
    const botConvIds = await db
      .from('conversation_members')
      .where('user_id', bot.id)
      .select('conversation_id')
    const botConvIdSet = new Set(botConvIds.map((row) => row.conversation_id))
    const filteredIds = ids.filter((id) => !botConvIdSet.has(id))

    if (filteredIds.length === 0) return ApiResponse.ok(response, 'OK', { conversations: [] })

    const convs = await Conversation.query()
      .whereIn('id', filteredIds)
      .preload('members', (q) => q.preload('user'))
      .orderBy('last_message_at', 'desc')

    // Fetch the last message ID for each conversation to bypass the Lucid preload limit(1) bulk gotcha
    const latestMessageRows = await db
      .from('messages')
      .whereIn('conversation_id', filteredIds)
      .groupBy('conversation_id')
      .select('conversation_id', db.raw('MAX(id) as last_message_id'))

    const lastMessageIds = latestMessageRows
      .map((row) => {
        const idVal = row.last_message_id ?? row.last_message_id
        return idVal ? Number(idVal) : null
      })
      .filter((id): id is number => id !== null)

    const lastMessages = lastMessageIds.length > 0
      ? await Message.query()
          .whereIn('id', lastMessageIds)
          .preload('attachments')
          .preload('sender')
      : []

    const serializedMessagesMap = new Map<number, any>()
    for (const m of lastMessages) {
      const serialized = await messageService.serialize(m, me.id)
      serializedMessagesMap.set(m.conversationId, serialized)
    }

    const unreadMap = await computeUnreadCounts(me.id, filteredIds)
    const { blockedByMe, blockedByOther } = await computeDirectBlockStatus(me.id, convs)
    const friendshipMap = await computeDirectFriendshipStatus(me.id, convs)
    const membershipMap = new Map(memberships.map((m) => [m.conversationId, m]))
    const out = convs.map((c) => {
      const friendship = friendshipMap.get(c.id)
      const m = membershipMap.get(c.id)
      const serializedMsg = serializedMessagesMap.get(c.id)
      return {
        ...c.serialize(),
        messages: serializedMsg ? [serializedMsg] : [],
        isPinned: m?.isPinned ?? false,
        pinOrder: m?.pinOrder ?? null,
        isMuted: m?.isMuted ?? false,
        chatBackground: c.chatBackground ?? null,
        unreadCount: unreadMap.get(c.id) ?? 0,
        blockedByMe: blockedByMe.get(c.id) ?? false,
        blockedByOther: blockedByOther.get(c.id) ?? false,
        isFriend: friendship?.isFriend ?? false,
        friendRequestSent: friendship?.friendRequestSent ?? false,
        friendRequestReceived: friendship?.friendRequestReceived ?? false,
        friendshipId: friendship?.friendshipId ?? null,
      }
    })

    out.sort((a: any, b: any) => {
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      if (a.isPinned && b.isPinned) {
        return (b.pinOrder ?? 0) - (a.pinOrder ?? 0)
      }
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return timeB - timeA
    })

    return ApiResponse.ok(response, 'OK', { conversations: out })
  }

  /**
   * @show
   * @operationId getConversation
   * @description Returns a conversation by ID (must be a member).
   * @paramPath id - Conversation ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   */
  public async show({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()

    const base = await resolveByUuid(params.id)
    if (!base) return ApiResponse.error(response, 404, 'Conversation not found.')

    const member = await messageService.assertMember(base.id, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member of this conversation.')

    const conv = await Conversation.query()
      .where('id', base.id)
      .preload('members', (q) => q.preload('user'))
      .firstOrFail()

    const lastMsg = await Message.query()
      .where('conversation_id', conv.id)
      .preload('attachments')
      .preload('sender')
      .orderBy('id', 'desc')
      .first()

    const serializedMsg = lastMsg ? await messageService.serialize(lastMsg, me.id) : null

    const unreadMap = await computeUnreadCounts(me.id, [conv.id])
    const { blockedByMe, blockedByOther } = await computeDirectBlockStatus(me.id, [conv])
    const friendshipMap = await computeDirectFriendshipStatus(me.id, [conv])
    const friendship = friendshipMap.get(conv.id)
    const out = {
      ...conv.serialize(),
      messages: serializedMsg ? [serializedMsg] : [],
      isPinned: member.isPinned ?? false,
      pinOrder: member.pinOrder ?? null,
      isMuted: member.isMuted ?? false,
      chatBackground: conv.chatBackground ?? null,
      unreadCount: unreadMap.get(conv.id) ?? 0,
      blockedByMe: blockedByMe.get(conv.id) ?? false,
      blockedByOther: blockedByOther.get(conv.id) ?? false,
      isFriend: friendship?.isFriend ?? false,
      friendRequestSent: friendship?.friendRequestSent ?? false,
      friendRequestReceived: friendship?.friendRequestReceived ?? false,
      friendshipId: friendship?.friendshipId ?? null,
    }

    return ApiResponse.ok(response, 'OK', { conversation: out })
  }

  /**
   * @addMembers
   * @operationId addConversationMembers
   * @description Adds members to a group conversation. Owner or admin only.
   * @paramPath id - Conversation ID.
   * @requestBody {"user_ids": "string[]"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"added": "number[]"}}
   */
  public async addMembers({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only group conversations support adding members.')
    }
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember) {
      return ApiResponse.error(response, 403, 'Not a member of this conversation.')
    }

    const { user_ids: userUuids } = await request.validateUsing(addMembersValidator)
    const userIds = await resolveUserIds(userUuids)
    const existing = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .whereIn('user_id', userIds)
    const existingIds = new Set(existing.map((m) => m.userId))
    const toAdd = userIds.filter((id) => !existingIds.has(id))

    if (toAdd.length > 0) {
      await ConversationMember.createMany(
        toAdd.map((id) => ({
          conversationId: conv.id,
          userId: id,
          role: 'member' as const,
          joinedAt: DateTime.now(),
        }))
      )
    }

    // Return the UUIDs of the actually-added users, not numeric ids.
    const addedUsers =
      toAdd.length === 0 ? [] : await User.query().whereIn('id', toAdd).select('id', 'uuid', 'name')
    const addedUuids = addedUsers.map((u) => u.uuid)

    // Realtime: make every newly-added user join the conv room and
    // notify their sidebar to insert the conversation.
    for (const u of addedUsers) {
      await realtimeService.joinUserToConversation(u.id, conv)
      realtimeService.emitToUser(u.id, 'conversation:joined', {
        conversationId: conv.uuid,
      })
      await messageService.createMessage({
        conversationId: conv.id,
        senderId: me.id,
        content: `__system__:added:${u.uuid}:${u.name || 'Người dùng'}`,
        skipAiTrigger: true,
      })
    }
    // Existing members get a lighter signal so their member list
    // refreshes.
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    return ApiResponse.ok(response, 'Members added.', { added: addedUuids })
  }

  /**
   * @removeMember
   * @operationId removeConversationMember
   * @description Removes a member from a group. Owner or admin only.
   * @paramPath id - Conversation ID.
   * @paramPath userId - User ID to remove.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async removeMember({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only groups support removing members.')
    }
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can remove members.')
    }
    const target = await User.findBy('uuid', params.userId)
    if (!target) return ApiResponse.error(response, 404, 'User not found.')
    const targetId = target.id
    if (targetId === conv.ownerId) {
      return ApiResponse.error(response, 400, 'Cannot remove the owner.')
    }
    await messageService.createMessage({
      conversationId: conv.id,
      senderId: me.id,
      content: `__system__:removed:${target.uuid}:${target.name || 'Người dùng'}`,
      skipAiTrigger: true,
    })

    await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', targetId)
      .delete()

    // Realtime: pop the conversation out of the removed user's
    // sidebar and take their sockets out of the conv room. The
    // remaining members get a member-list refresh signal.
    realtimeService.emitToUser(targetId, 'conversation:removed', {
      conversationId: conv.uuid,
    })
    await realtimeService.leaveUserFromConversation(targetId, conv.id)
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    return ApiResponse.ok(response, 'Member removed.', null)
  }

  /**
   * @leave
   * @operationId leaveConversation
   * @description Current user leaves a group conversation.
   * @paramPath id - Conversation ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async leave({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Cannot leave a direct conversation.')
    }
    if (conv.ownerId === me.id) {
      return ApiResponse.error(
        response,
        400,
        'Owner must transfer ownership before leaving the group.'
      )
    }
    await messageService.createMessage({
      conversationId: conv.id,
      senderId: me.id,
      content: '__system__:left',
      skipAiTrigger: true,
    })

    await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', me.id)
      .delete()

    // Realtime: drop the conv from every tab of the leaving user and
    // take their sockets out of the room. Remaining members get a
    // members-changed signal for their open group info dialogs.
    realtimeService.emitToUser(me.id, 'conversation:removed', {
      conversationId: conv.uuid,
    })
    await realtimeService.leaveUserFromConversation(me.id, conv.id)
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    return ApiResponse.ok(response, 'Left conversation.', null)
  }

  /**
   * @archive
   * @operationId archiveConversation
   * @description Archives (hides) the conversation for the current user by removing their membership row. Works for direct and group conversations.
   * @paramPath id - Conversation ID.
   */
  public async archive({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    const member = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', me.id)
      .first()
    if (!member) return ApiResponse.error(response, 403, 'Not a member of this conversation.')

    // Remove the membership so the conversation no longer appears in the user's sidebar.
    await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', me.id)
      .delete()

    // Realtime: notify this user's other tabs and make sockets leave the room.
    realtimeService.emitToUser(me.id, 'conversation:removed', {
      conversationId: conv.uuid,
    })
    await realtimeService.leaveUserFromConversation(me.id, conv.id)
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    return ApiResponse.ok(response, 'Conversation archived for user.', null)
  }

  /**
   * @updateMemberRole
   * @operationId updateMemberRole
   * @description Promotes/demotes a member to admin or member. Owner only.
   * @paramPath id - Conversation ID.
   * @paramPath userId - Target user ID.
   * @requestBody {"role": "admin | member"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"member": "object"}}
   */
  public async updateMemberRole({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.ownerId !== me.id) {
      return ApiResponse.error(response, 403, 'Only the owner can change roles.')
    }
    const target = await User.findBy('uuid', params.userId)
    if (!target) return ApiResponse.error(response, 404, 'User not found.')
    const { role } = await request.validateUsing(updateMemberRoleValidator)
    const member = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', target.id)
      .first()
    if (!member) return ApiResponse.error(response, 404, 'Member not found.')
    member.role = role
    await member.save()
    return ApiResponse.ok(response, 'Role updated.', { member })
  }

  /**
   * @updateMemberNickname
   * @operationId updateMemberNickname
   * @description Sets or removes a nickname for a member in a conversation. Any member can change nicknames.
   * @paramPath id - Conversation ID.
   * @paramPath userId - Target user ID to set nickname for.
   * @requestBody {"nickname": "string | null"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"member": "object"}}
   */
  public async updateMemberNickname({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    // Validate that current user is a member of this conversation
    const myMember = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', me.id)
      .first()
    if (!myMember) {
      return ApiResponse.error(response, 403, 'Not a member of this conversation.')
    }

    // Find target user by UUID
    const target = await User.findBy('uuid', params.userId)
    if (!target) return ApiResponse.error(response, 404, 'User not found.')

    // Validate target is a member
    const targetMember = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', target.id)
      .first()
    if (!targetMember) {
      return ApiResponse.error(response, 404, 'Target user is not a member of this conversation.')
    }

    const { nickname } = await request.validateUsing(updateMemberNicknameValidator)
    const cleanNickname = nickname ? String(nickname).trim() : null

    targetMember.nickname = cleanNickname
    await targetMember.save()

    // Realtime: notify sidebar and details pane to refetch
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    // Create system message: __system__:nickname-changed:targetUuid:newNickname
    const systemContent = `__system__:nickname-changed:${target.uuid}:${cleanNickname || ''}`
    await messageService.createMessage({
      conversationId: conv.id,
      senderId: me.id,
      content: systemContent,
      skipAiTrigger: true,
    })

    return ApiResponse.ok(response, 'Nickname updated.', { member: targetMember })
  }

  /**
   * @transferOwnership
   * @operationId transferOwnership
   * @description Transfers group ownership to another member. Owner only.
   * @paramPath id - Conversation ID.
   * @requestBody {"user_id": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   */
  public async transferOwnership({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.ownerId !== me.id) {
      return ApiResponse.error(response, 403, 'Only the owner can transfer ownership.')
    }
    const { user_id: targetUuid } = await request.validateUsing(transferOwnershipValidator)
    const targetUser = await User.findBy('uuid', targetUuid)
    if (!targetUser) return ApiResponse.error(response, 404, 'User not found.')
    const targetId = targetUser.id
    const target = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', targetId)
      .first()
    if (!target) return ApiResponse.error(response, 404, 'Target user is not a member.')

    await db.transaction(async (trx) => {
      conv.ownerId = targetId
      conv.useTransaction(trx)
      await conv.save()
      target.role = 'owner'
      target.useTransaction(trx)
      await target.save()
      await ConversationMember.query({ client: trx })
        .where('conversation_id', conv.id)
        .andWhere('user_id', me.id)
        .update({ role: 'admin' })
    })

    return ApiResponse.ok(response, 'Ownership transferred.', { conversation: conv })
  }

  /**
   * @disband
   * @operationId disbandConversation
   * @description Disbands (deletes) a group conversation. Owner only.
   * @paramPath id - Conversation ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async disband({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only groups can be disbanded.')
    }
    if (conv.ownerId !== me.id) {
      return ApiResponse.error(response, 403, 'Only the owner can disband the group.')
    }

    // Notify all members BEFORE deleting — the cascade would otherwise
    // remove the membership rows we use to figure out who to tell.
    const members = await ConversationMember.query().where('conversation_id', conv.id)
    const convUuid = conv.uuid
    const convInternalId = conv.id

    await conv.delete()

    for (const m of members) {
      realtimeService.emitToUser(m.userId, 'conversation:removed', {
        conversationId: convUuid,
      })
      await realtimeService.leaveUserFromConversation(m.userId, convInternalId)
    }

    return ApiResponse.ok(response, 'Group disbanded.', null)
  }

  /**
   * @markRead
   * @operationId markConversationRead
   * @description Marks the current user as having read the conversation up to (at least) now. Broadcasts a `conversation:read` socket event so other members see the read receipt in real time.
   * @paramPath id - Conversation ID.
   * @requestBody {"last_message_id": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"lastReadAt": "string"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   */
  public async markRead({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember) {
      return ApiResponse.error(response, 403, 'Not a member of this conversation.')
    }

    const { last_message_id: lastMessageUuid } = await request.validateUsing(markReadValidator)

    const now = DateTime.now()
    myMember.lastReadAt = now
    await myMember.save()

    // Resolve the optional message UUID for the broadcast payload.
    let lastMessagePublicId: string | null = null
    if (lastMessageUuid) {
      const m = await Message.findBy('uuid', lastMessageUuid)
      if (m) lastMessagePublicId = m.uuid
    }

    // Only broadcast read receipt if user is NOT in privacy mode.
    // When privacy mode is on, lastReadAt is still updated (so their
    // own unread counts reset) but other users won't see the receipt.
    const fullUser = await User.find(me.id)
    const isPrivate = fullUser?.isPrivatePresence ?? false

    if (!isPrivate) {
      realtimeService.emitToConversation(conv.id, 'conversation:read', {
        conversationId: conv.uuid,
        userId: me.uuid,
        lastReadAt: now,
        lastMessageId: lastMessagePublicId,
      })
    }

    return ApiResponse.ok(response, 'OK', { lastReadAt: now })
  }

  /**
   * @updateAvatar
   * @operationId updateGroupAvatar
   * @description Uploads and sets the avatar image of a group conversation. Owner or admin only.
   * @paramPath id - Conversation ID.
   * @requestBody {"avatar": "file"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   */
  public async updateAvatar({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only groups have avatars.')
    }
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can change the avatar.')
    }

    const { avatar } = await request.validateUsing(updateAvatarValidator)

    const fileName = `group_${conv.id}_avatar.${avatar.extname}`
    
    // Upload group avatar to S3
    const s3Url = await s3Service.upload(avatar, 'group-avatars', fileName)
    conv.avatarUrl = s3Url
    await conv.save()

    // Notify every member so their sidebar icon + chat header refresh.
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    await conv.load('members', (q) => q.preload('user'))
    return ApiResponse.ok(response, 'Group avatar updated.', { conversation: conv })
  }

  /**
   * @toggleMute
   * @operationId toggleMuteConversation
   * @description Toggles mute status for the current user in a conversation.
   * @paramPath id - Conversation ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"isMuted": "boolean"}}
   */
  public async toggleMute({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember) {
      return ApiResponse.error(response, 403, 'Not a member of this conversation.')
    }

    myMember.isMuted = !myMember.isMuted
    await myMember.save()

    // Notify other sessions/devices of this user about the changed mute state
    realtimeService.emitToUser(me.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    return ApiResponse.ok(response, 'Mute status updated.', { isMuted: myMember.isMuted })
  }

  /**
   * @togglePin
   * @operationId togglePinConversation
   * @description Toggles pin status for the current user in a conversation.
   * @paramPath id - Conversation ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"isPinned": "boolean"}}
   */
  public async togglePin({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember) {
      return ApiResponse.error(response, 403, 'Not a member of this conversation.')
    }

    myMember.isPinned = !myMember.isPinned
    
    // If pinning, set pin_order to current timestamp for sorting
    if (myMember.isPinned) {
      const maxOrder = await ConversationMember.query()
        .where('user_id', me.id)
        .andWhere('is_pinned', true)
        .max('pin_order as maxOrder')
        .first()
      myMember.pinOrder = (Number((maxOrder as any)?.$extras?.maxOrder) || 0) + 1
    } else {
      myMember.pinOrder = null
    }
    
    await myMember.save()

    // Notify other sessions/devices of this user about the changed pin state
    realtimeService.emitToUser(me.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    return ApiResponse.ok(response, 'Pin status updated.', { isPinned: myMember.isPinned })
  }

  /**
   * @updateSettings
   * @operationId updateGroupSettings
   * @description Updates group-wide settings (currently: comments_restricted). Owner or admin only.
   * @paramPath id - Conversation ID.
   * @requestBody {"comments_restricted": "boolean"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   */
  public async updateSettings({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only groups have settings.')
    }
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can change settings.')
    }
    const { comments_restricted: commentsRestricted, name, approve_members: approveMembers } = await request.validateUsing(
      updateGroupSettingsValidator
    )
    if (commentsRestricted !== undefined) {
      conv.commentsRestricted = commentsRestricted
    }
    if (approveMembers !== undefined) {
      conv.approveMembers = approveMembers
    }
    if (name !== undefined) {
      conv.name = name
    }
    await conv.save()
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })
    await conv.load('members', (q) => q.preload('user'))
    return ApiResponse.ok(response, 'Settings updated.', { conversation: conv })
  }

  /**
   * @regenerateInviteCode
   * @operationId regenerateInviteCode
   * @description Rotates the group invite code (invalidates the old QR). Owner or admin only.
   * @paramPath id - Conversation ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"inviteCode": "string"}}
   */
  public async regenerateInviteCode({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only groups have invite codes.')
    }
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can regenerate the code.')
    }

    // Retry on the (unlikely) unique-collision so callers always get a code.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode()
      const taken = await Conversation.query().where('invite_code', code).first()
      if (!taken) {
        conv.inviteCode = code
        await conv.save()
        return ApiResponse.ok(response, 'Invite code regenerated.', { inviteCode: code })
      }
    }
    return ApiResponse.error(response, 500, 'Failed to generate a unique invite code.')
  }

  /**
   * @joinByCode
   * @operationId joinGroupByCode
   * @description Joins a group conversation using its invite code (from QR or shared link). Anyone with the code can join.
   * @requestBody {"code": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   * @responseBody 404 - {"success": false, "message": "Invite code not found.", "errors": []}
   */
  public async joinByCode({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { code } = await request.validateUsing(joinByCodeValidator)

    const conv = await Conversation.query()
      .where('invite_code', code.toUpperCase())
      .andWhere('type', 'group')
      .first()
    if (!conv) return ApiResponse.error(response, 404, 'Invite code not found.')

    const existing = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', me.id)
      .first()

    if (existing) {
      await conv.load('members', (q) => q.preload('user'))
      return ApiResponse.ok(response, 'Already a member.', {
        conversation: conv,
      })
    }

    // If approval is required
    if (conv.approveMembers) {
      const pendingRequest = await GroupJoinRequest.query()
        .where('conversation_id', conv.id)
        .andWhere('user_id', me.id)
        .andWhere('status', 'pending')
        .first()

      if (pendingRequest) {
        return ApiResponse.ok(response, 'Waiting approval.', {
          status: 'pending',
          message: 'Yêu cầu tham gia của bạn đang chờ phê duyệt từ quản trị viên.',
        })
      }

      await GroupJoinRequest.create({
        conversationId: conv.id,
        userId: me.id,
        status: 'pending',
      })

      return ApiResponse.ok(response, 'Waiting approval.', {
        status: 'pending',
        message: 'Yêu cầu tham gia của bạn đã được gửi và đang chờ phê duyệt từ quản trị viên.',
      })
    }

    await ConversationMember.create({
      conversationId: conv.id,
      userId: me.id,
      role: 'member',
      joinedAt: DateTime.now(),
    })

    await messageService.createMessage({
      conversationId: conv.id,
      senderId: me.id,
      content: '__system__:joined',
      skipAiTrigger: true,
    })

    await realtimeService.joinUserToConversation(me.id, conv)
    realtimeService.emitToUser(me.id, 'conversation:joined', {
      conversationId: conv.uuid,
    })
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    await conv.load('members', (q) => q.preload('user'))
    return ApiResponse.ok(response, 'Joined group.', {
      conversation: conv,
    })
  }

  /**
   * @getJoinRequests
   * @operationId getJoinRequests
   * @description Get list of pending group join requests (owner or admin only).
   */
  public async getJoinRequests({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    // Must be group owner or admin
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can view join requests.')
    }

    const requests = await GroupJoinRequest.query()
      .where('conversation_id', conv.id)
      .andWhere('status', 'pending')
      .preload('user')

    return ApiResponse.ok(response, 'Join requests retrieved.', requests)
  }

  /**
   * @approveJoinRequest
   * @operationId approveJoinRequest
   * @description Approve a pending group join request (owner or admin only).
   */
  public async approveJoinRequest({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    // Must be group owner or admin
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can approve requests.')
    }

    const requestObj = await GroupJoinRequest.find(params.requestId)
    if (!requestObj || requestObj.conversationId !== conv.id || requestObj.status !== 'pending') {
      return ApiResponse.error(response, 404, 'Join request not found or not pending.')
    }

    // Update request status
    requestObj.status = 'approved'
    await requestObj.save()

    // Add to members if not already
    const existing = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', requestObj.userId)
      .first()

    if (!existing) {
      await ConversationMember.create({
        conversationId: conv.id,
        userId: requestObj.userId,
        role: 'member',
        joinedAt: DateTime.now(),
      })

      await messageService.createMessage({
        conversationId: conv.id,
        senderId: requestObj.userId,
        content: '__system__:joined',
        skipAiTrigger: true,
      })

      // Realtime trigger
      await realtimeService.joinUserToConversation(requestObj.userId, conv)
      realtimeService.emitToUser(requestObj.userId, 'conversation:joined', {
        conversationId: conv.uuid,
      })
      realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
        conversationId: conv.uuid,
      })
    }

    return ApiResponse.ok(response, 'Join request approved.', null)
  }

  /**
   * @rejectJoinRequest
   * @operationId rejectJoinRequest
   * @description Reject a pending group join request (owner or admin only).
   */
  public async rejectJoinRequest({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    // Must be group owner or admin
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can reject requests.')
    }

    const requestObj = await GroupJoinRequest.find(params.requestId)
    if (!requestObj || requestObj.conversationId !== conv.id || requestObj.status !== 'pending') {
      return ApiResponse.error(response, 404, 'Join request not found or not pending.')
    }

    // Update request status
    requestObj.status = 'rejected'
    await requestObj.save()

    return ApiResponse.ok(response, 'Join request rejected.', null)
  }

  /**
   * @updateBackground
   * @operationId updateConversationBackground
   * @description Updates the conversation background for the current user.
   * @paramPath id - Conversation ID.
   * @requestBody {"background": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"chatBackground": "string"}}
   */
  public async updateBackground({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveByUuid(params.id)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    const member = await messageService.assertMember(conv.id, me.id)
    if (!member) {
      return ApiResponse.error(response, 403, 'Not a member of this conversation.')
    }

    const { background } = request.only(['background'])
    conv.chatBackground = background || null
    await conv.save()

    // Notify ALL members of the conversation so everyone sees the same background
    realtimeService.emitToConversation(conv.id, 'conversation:members-changed', {
      conversationId: conv.uuid,
    })

    return ApiResponse.ok(response, 'Background updated.', { chatBackground: conv.chatBackground })
  }
}

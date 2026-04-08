import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Conversation from '#models/conversation'
import ConversationMember from '#models/conversation_member'
import User from '#models/user'
import { ApiResponse } from '#utils/api_response'
import {
  createDirectConversationValidator,
  createGroupConversationValidator,
  addMembersValidator,
  updateMemberRoleValidator,
  transferOwnershipValidator,
} from '#validators/conversation'
import messageService from '#services/message_service'

export default class ConversationsController {
  /**
   * @createDirect
   * @operationId createDirectConversation
   * @description Creates (or returns the existing) 1-1 conversation with a user.
   * @requestBody {"user_id": "number"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   */
  public async createDirect({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { user_id: otherId } = await request.validateUsing(createDirectConversationValidator)

    if (otherId === me.id) {
      return ApiResponse.error(response, 400, 'Cannot create a conversation with yourself.')
    }
    const other = await User.find(otherId)
    if (!other) return ApiResponse.error(response, 404, 'User not found.')

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
      return ApiResponse.ok(response, 'OK', { conversation: conv })
    }

    const conv = await db.transaction(async (trx) => {
      const c = await Conversation.create(
        { type: 'direct', createdBy: me.id },
        { client: trx }
      )
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
    return ApiResponse.created(response, 'Conversation created.', { conversation: conv })
  }

  /**
   * @createGroup
   * @operationId createGroupConversation
   * @description Creates a new group conversation. Creator becomes the owner.
   * @requestBody {"name": "string", "member_ids": "number[]"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   */
  public async createGroup({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { name, member_ids: memberIds } = await request.validateUsing(
      createGroupConversationValidator
    )

    const uniqueIds = Array.from(new Set(memberIds.filter((id) => id !== me.id)))
    if (uniqueIds.length === 0) {
      return ApiResponse.error(response, 400, 'Group must have at least one other member.')
    }

    const conv = await db.transaction(async (trx) => {
      const c = await Conversation.create(
        { type: 'group', name, ownerId: me.id, createdBy: me.id },
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
    const memberships = await ConversationMember.query().where('user_id', me.id)
    const ids = memberships.map((m) => m.conversationId)
    if (ids.length === 0) return ApiResponse.ok(response, 'OK', { conversations: [] })

    const convs = await Conversation.query()
      .whereIn('id', ids)
      .preload('members', (q) => q.preload('user'))
      .orderBy('last_message_at', 'desc')

    return ApiResponse.ok(response, 'OK', { conversations: convs })
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
    const member = await messageService.assertMember(Number(params.id), me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member of this conversation.')

    const conv = await Conversation.query()
      .where('id', params.id)
      .preload('members', (q) => q.preload('user'))
      .firstOrFail()
    return ApiResponse.ok(response, 'OK', { conversation: conv })
  }

  /**
   * @addMembers
   * @operationId addConversationMembers
   * @description Adds members to a group conversation. Owner or admin only.
   * @paramPath id - Conversation ID.
   * @requestBody {"user_ids": "number[]"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"added": "number[]"}}
   */
  public async addMembers({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await Conversation.findOrFail(params.id)
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only group conversations support adding members.')
    }
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can add members.')
    }

    const { user_ids: userIds } = await request.validateUsing(addMembersValidator)
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
    return ApiResponse.ok(response, 'Members added.', { added: toAdd })
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
    const conv = await Conversation.findOrFail(params.id)
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only groups support removing members.')
    }
    const myMember = await messageService.assertMember(conv.id, me.id)
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return ApiResponse.error(response, 403, 'Only owner or admin can remove members.')
    }
    const targetId = Number(params.userId)
    if (targetId === conv.ownerId) {
      return ApiResponse.error(response, 400, 'Cannot remove the owner.')
    }
    await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', targetId)
      .delete()
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
    const conv = await Conversation.findOrFail(params.id)
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
    await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', me.id)
      .delete()
    return ApiResponse.ok(response, 'Left conversation.', null)
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
    const conv = await Conversation.findOrFail(params.id)
    if (conv.ownerId !== me.id) {
      return ApiResponse.error(response, 403, 'Only the owner can change roles.')
    }
    const { role } = await request.validateUsing(updateMemberRoleValidator)
    const member = await ConversationMember.query()
      .where('conversation_id', conv.id)
      .andWhere('user_id', params.userId)
      .first()
    if (!member) return ApiResponse.error(response, 404, 'Member not found.')
    member.role = role
    await member.save()
    return ApiResponse.ok(response, 'Role updated.', { member })
  }

  /**
   * @transferOwnership
   * @operationId transferOwnership
   * @description Transfers group ownership to another member. Owner only.
   * @paramPath id - Conversation ID.
   * @requestBody {"user_id": "number"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   */
  public async transferOwnership({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await Conversation.findOrFail(params.id)
    if (conv.ownerId !== me.id) {
      return ApiResponse.error(response, 403, 'Only the owner can transfer ownership.')
    }
    const { user_id: targetId } = await request.validateUsing(transferOwnershipValidator)
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
    const conv = await Conversation.findOrFail(params.id)
    if (conv.type !== 'group') {
      return ApiResponse.error(response, 400, 'Only groups can be disbanded.')
    }
    if (conv.ownerId !== me.id) {
      return ApiResponse.error(response, 403, 'Only the owner can disband the group.')
    }
    await conv.delete()
    return ApiResponse.ok(response, 'Group disbanded.', null)
  }
}

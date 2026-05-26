import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import Conversation from '#models/conversation'
import ConversationMember from '#models/conversation_member'
import Message from '#models/message'
import MessageAttachment from '#models/message_attachment'
import User from '#models/user'
import realtime from '#services/realtime_service'
import notificationService from '#services/notification_service'

// Small in-memory caches so `serialize()` can surface UUIDs without
// hitting the DB on every emit. Entries are immutable once the row is
// created so there's no invalidation concern.
const conversationUuidCache = new Map<number, string>()
async function getConversationUuid(conversationId: number): Promise<string | null> {
  const cached = conversationUuidCache.get(conversationId)
  if (cached) return cached
  const conv = await Conversation.find(conversationId)
  if (!conv) return null
  conversationUuidCache.set(conv.id, conv.uuid)
  return conv.uuid
}

const messageUuidCache = new Map<number, string>()
async function getMessageUuid(messageId: number | null): Promise<string | null> {
  if (!messageId) return null
  const cached = messageUuidCache.get(messageId)
  if (cached) return cached
  const m = await Message.find(messageId)
  if (!m) return null
  messageUuidCache.set(m.id, m.uuid)
  return m.uuid
}

const userUuidCache = new Map<number, string>()
async function getUserUuids(userIds: number[]): Promise<Map<number, string>> {
  const missing: number[] = []
  const out = new Map<number, string>()
  for (const id of userIds) {
    const cached = userUuidCache.get(id)
    if (cached) out.set(id, cached)
    else missing.push(id)
  }
  if (missing.length > 0) {
    const rows = await User.query().whereIn('id', missing).select('id', 'uuid')
    for (const r of rows) {
      userUuidCache.set(r.id, r.uuid)
      out.set(r.id, r.uuid)
    }
  }
  return out
}

export interface CreateMessageInput {
  conversationId: number
  senderId: number
  content?: string
  replyToMessageId?: number
  attachmentIds?: number[]
  skipAiTrigger?: boolean
}

class MessageService {
  /**
   * Asserts that `userId` is a member of `conversationId`. Returns the
   * member row or `null` if not a member.
   */
  async assertMember(conversationId: number, userId: number): Promise<ConversationMember | null> {
    return ConversationMember.query()
      .where('conversation_id', conversationId)
      .andWhere('user_id', userId)
      .first()
  }

  async createMessage(input: CreateMessageInput): Promise<Message> {
    const { conversationId, senderId, content, replyToMessageId, attachmentIds, skipAiTrigger } = input

    if (!content && (!attachmentIds || attachmentIds.length === 0)) {
      throw Object.assign(new Error('Message must have content or attachments.'), { status: 400 })
    }

    const message = await db.transaction(async (trx) => {
      const m = await Message.create(
        {
          conversationId,
          senderId,
          content: content ?? null,
          replyToMessageId: replyToMessageId ?? null,
          isRecalled: false,
        },
        { client: trx }
      )

      if (attachmentIds && attachmentIds.length > 0) {
        await MessageAttachment.query({ client: trx })
          .whereIn('id', attachmentIds)
          .andWhere('uploaded_by', senderId)
          .whereNull('message_id')
          .update({ messageId: m.id })
      }

      await Conversation.query({ client: trx })
        .where('id', conversationId)
        .update({ lastMessageAt: DateTime.now().toSQL({ includeOffset: false }) })

      return m
    })

    await message.load((loader) => {
      loader.load('sender').load('attachments').load('reactions')
    })

    realtime.emitToConversation(conversationId, 'message:new', await this.serialize(message))

    // Push notification to other members
    const otherMembers = await ConversationMember.query()
      .where('conversation_id', conversationId)
      .andWhereNot('user_id', senderId)
    for (const m of otherMembers) {
      notificationService
        .sendToUser(m.userId, {
          title: 'New message',
          body: content?.slice(0, 120) ?? '[attachment]',
          data: { type: 'message', conversationId: String(conversationId) },
        })
        .catch(() => {})
    }

    // Trigger AI chatbot reply in background if not skipped
    if (!skipAiTrigger) {
      this.triggerAiBotReplyIfNeeded(conversationId, senderId, content).catch((err) => {
        logger.error({ err }, 'Failed to trigger background AI bot reply')
      })
    }

    return message
  }

  async recall(messageId: number, userId: number): Promise<Message> {
    const message = await Message.findOrFail(messageId)
    if (message.senderId !== userId) {
      throw Object.assign(new Error('Only the sender can recall a message.'), { status: 403 })
    }
    message.isRecalled = true
    message.content = null
    await message.save()
    realtime.emitToConversation(message.conversationId, 'message:recalled', {
      id: message.uuid,
    })
    return message
  }

  async forward(
    messageId: number,
    userId: number,
    conversationUuids: string[]
  ): Promise<Message[]> {
    const original = await Message.query()
      .where('id', messageId)
      .preload('attachments')
      .firstOrFail()

    // Resolve UUIDs → internal numeric ids in one query.
    const convs = await Conversation.query().whereIn('uuid', conversationUuids)

    const created: Message[] = []
    for (const targetConv of convs) {
      const convId = targetConv.id
      const member = await this.assertMember(convId, userId)
      if (!member) continue
      const m = await Message.create({
        conversationId: convId,
        senderId: userId,
        content: original.content,
        forwardedFromId: original.id,
        isRecalled: false,
      })
      // Clone attachments
      for (const att of original.attachments) {
        await MessageAttachment.create({
          messageId: m.id,
          url: att.url,
          type: att.type,
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
        })
      }
      await Conversation.query()
        .where('id', convId)
        .update({ lastMessageAt: DateTime.now().toSQL({ includeOffset: false }) })

      await m.load((l) => l.load('sender').load('attachments'))
      realtime.emitToConversation(convId, 'message:new', await this.serialize(m))
      created.push(m)
    }
    return created
  }

  async serialize(m: Message, viewerUserId?: number): Promise<Record<string, unknown>> {
    const [conversationUuid, replyUuid, forwardedUuid] = await Promise.all([
      getConversationUuid(m.conversationId),
      getMessageUuid(m.replyToMessageId),
      getMessageUuid(m.forwardedFromId),
    ])

    const sender = (m as any).sender
    const reactions = ((m as any).reactions ?? []) as Array<{
      userId: number
      emoji: string
    }>

    // Translate reaction userIds to UUIDs in a single batched lookup.
    const reactionUserMap = await getUserUuids(reactions.map((r) => r.userId))

    // isStarred — only meaningful when we know who's viewing
    let isStarred = false
    if (viewerUserId) {
      const { default: MessageStar } = await import('#models/message_star')
      const star = await MessageStar.query()
        .where('message_id', m.id)
        .andWhere('user_id', viewerUserId)
        .first()
      isStarred = Boolean(star)
    }

    // pinnedBy UUID
    let pinnedByUuid: string | null = null
    if (m.pinnedBy) {
      const uuidMap = await getUserUuids([m.pinnedBy])
      pinnedByUuid = uuidMap.get(m.pinnedBy) ?? null
    }

    // Poll payload — only present when the message is poll-bearing and
    // the caller preloaded the `poll` relation.
    let pollPayload: Record<string, unknown> | null = null
    const poll = (m as any).poll
    if (poll) {
      const { default: PollOption } = await import('#models/poll_option')
      const { default: PollVote } = await import('#models/poll_vote')
      await poll.load((l: any) => l.load('options', (q: any) => q.orderBy('position', 'asc').preload('votes')))
      const optionIds = poll.options.map((o: any) => o.id)
      let mySet = new Set<number>()
      if (viewerUserId && optionIds.length > 0) {
        const mine = await PollVote.query()
          .whereIn('poll_option_id', optionIds)
          .andWhere('user_id', viewerUserId)
        mySet = new Set(mine.map((v) => v.pollOptionId))
      }
      void PollOption
      pollPayload = {
        id: poll.uuid,
        question: poll.question,
        allowMultiple: poll.allowMultiple,
        isClosed: poll.isClosed,
        options: poll.options.map((o: any) => ({
          id: o.uuid,
          text: o.text,
          voteCount: o.votes?.length ?? 0,
          votedByMe: mySet.has(o.id),
        })),
        totalVotes: poll.options.reduce((sum: number, o: any) => sum + (o.votes?.length ?? 0), 0),
      }
    }

    return {
      id: m.uuid,
      conversationId: conversationUuid,
      senderId: sender?.uuid ?? null,
      content: m.isRecalled ? null : m.content,
      replyToMessageId: replyUuid,
      forwardedFromId: forwardedUuid,
      isRecalled: m.isRecalled,
      isPinned: m.isPinned ?? false,
      pinnedBy: pinnedByUuid,
      pinnedAt: m.pinnedAt ?? null,
      isStarred,
      createdAt: m.createdAt,
      sender: sender
        ? {
            id: sender.uuid,
            name: sender.name,
            avatarUrl: sender.avatarUrl,
          }
        : undefined,
      attachments: (m as any).attachments ?? [],
      reactions: reactions.map((r) => ({
        userId: reactionUserMap.get(r.userId) ?? null,
        emoji: r.emoji,
      })),
      poll: pollPayload,
    }
  }

  /** Triggers the AI bot reply in the background for direct AI conversations. */
  async triggerAiBotReplyIfNeeded(conversationId: number, senderId: number, content?: string) {
    if (!content) return

    // Load chatbot service dynamically to prevent circular dependencies
    const { default: chatbot } = await import('#services/chatbot_service')
    if (!chatbot.isEnabled()) return

    const bot = await chatbot.getBotUser()
    if (senderId === bot.id) return // Don't reply to self

    // Verify if the bot is in this conversation
    const botMember = await ConversationMember.query()
      .where('conversation_id', conversationId)
      .andWhere('user_id', bot.id)
      .first()

    if (!botMember) return

    // Only auto-reply in direct 1-1 chats
    const conv = await Conversation.find(conversationId)
    if (!conv || conv.type !== 'direct') return

    try {
      const reply = await chatbot.generateReply(conversationId, content)
      
      // Save and broadcast the AI message
      await this.createMessage({
        conversationId,
        senderId: bot.id,
        content: reply,
        skipAiTrigger: true, // Prevent infinite loops!
      })
    } catch (err: any) {
      logger.error({ err }, 'Error during background AI response generation')
    }
  }
}

export default new MessageService()

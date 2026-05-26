import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Conversation from '#models/conversation'
import ConversationMember from '#models/conversation_member'
import Message from '#models/message'
import { ApiResponse } from '#utils/api_response'
import { aiChatValidator } from '#validators/ai'
import chatbot from '#services/chatbot_service'
import messageService from '#services/message_service'
import realtimeService from '#services/realtime_service'

export default class AiController {
  /**
   * @startConversation
   * @operationId startAiConversation
   * @description Creates (or returns) a 1-1 conversation between the current user and the AI bot.
   * @responseBody 201 - {"success": true, "message": "string", "data": {"conversation": "object"}}
   * @responseBody 503 - {"success": false, "message": "AI is disabled.", "errors": []}
   */
  public async startConversation({ response, auth }: HttpContext) {
    if (!chatbot.isEnabled()) {
      return ApiResponse.error(response, 503, 'AI is disabled. Configure GEMINI_API_KEY.')
    }
    const me = auth.use('jwt').getUserOrFail()
    
    // Clean up duplicate AI conversations and messages older than 24 hours
    await chatbot.cleanupAiConversations(me.id)
    
    const bot = await chatbot.getBotUser()

    const existing = await db
      .from('conversations as c')
      .select('c.id')
      .join('conversation_members as m1', 'm1.conversation_id', 'c.id')
      .join('conversation_members as m2', 'm2.conversation_id', 'c.id')
      .where('c.type', 'direct')
      .andWhere('m1.user_id', me.id)
      .andWhere('m2.user_id', bot.id)
      .first()

    let conv: Conversation
    if (existing) {
      conv = await Conversation.query()
        .where('id', existing.id)
        .preload('members', (q) => q.preload('user'))
        .firstOrFail()
    } else {
      conv = await db.transaction(async (trx) => {
        const c = await Conversation.create({ type: 'direct', createdBy: me.id }, { client: trx })
        await ConversationMember.createMany(
          [
            { conversationId: c.id, userId: me.id, role: 'member', joinedAt: DateTime.now() },
            { conversationId: c.id, userId: bot.id, role: 'member', joinedAt: DateTime.now() },
          ],
          { client: trx }
        )
        return c
      })
      await conv.load('members', (q) => q.preload('user'))
    }

    await chatbot.ensureGreetingMessage(conv.id)
    return ApiResponse.ok(response, 'AI conversation started.', { conversation: conv })
  }

  /**
   * @startNewConversation
   * @operationId startNewAiConversation
   * @description Force-creates a new AI conversation between the user and the bot.
   */
  public async startNewConversation({ response, auth }: HttpContext) {
    if (!chatbot.isEnabled()) {
      return ApiResponse.error(response, 503, 'AI is disabled. Configure GEMINI_API_KEY.')
    }
    const me = auth.use('jwt').getUserOrFail()
    
    // Clean up first
    await chatbot.cleanupAiConversations(me.id)
    
    const bot = await chatbot.getBotUser()

    const existing = await db
      .from('conversations as c')
      .select('c.id')
      .join('conversation_members as m1', 'm1.conversation_id', 'c.id')
      .join('conversation_members as m2', 'm2.conversation_id', 'c.id')
      .where('c.type', 'direct')
      .andWhere('m1.user_id', me.id)
      .andWhere('m2.user_id', bot.id)
      .first()

    let conv: Conversation
    if (existing) {
      conv = await Conversation.query()
        .where('id', existing.id)
        .preload('members', (q) => q.preload('user'))
        .firstOrFail()
      // Delete all messages to start fresh
      await Message.query().where('conversation_id', conv.id).delete()
    } else {
      conv = await db.transaction(async (trx) => {
        const c = await Conversation.create({ type: 'direct', createdBy: me.id }, { client: trx })
        await ConversationMember.createMany(
          [
            { conversationId: c.id, userId: me.id, role: 'member', joinedAt: DateTime.now() },
            { conversationId: c.id, userId: bot.id, role: 'member', joinedAt: DateTime.now() },
          ],
          { client: trx }
        )
        return c
      })
      await conv.load('members', (q) => q.preload('user'))
    }

    // Realtime: join sockets and notify the current user's sidebars so
    // the new conversation appears immediately without a full refresh.
    await realtimeService.joinUserToConversation(me.id, conv)
    
    // Ensure greeting message is present
    await chatbot.ensureGreetingMessage(conv.id)
    
    realtimeService.emitToUser(me.id, 'conversation:joined', { conversationId: conv.uuid })
    return ApiResponse.created(response, 'New AI conversation started.', { conversation: conv })
  }

  /**
   * @chat
   * @operationId aiChat
   * @description Sends a user message to the AI conversation and returns the AI reply (also broadcast via WebSocket).
   * @requestBody {"conversation_id": "string", "content": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"userMessage": "object", "aiMessage": "object"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   * @responseBody 503 - {"success": false, "message": "AI is disabled.", "errors": []}
   */
  public async chat({ request, response, auth }: HttpContext) {
    if (!chatbot.isEnabled()) {
      return ApiResponse.error(response, 503, 'AI is disabled. Configure GEMINI_API_KEY.')
    }
    const me = auth.use('jwt').getUserOrFail()
    
    // Clean up first
    await chatbot.cleanupAiConversations(me.id)
    
    const { conversation_id: conversationUuid, content } =
      await request.validateUsing(aiChatValidator)

    const conv = await Conversation.query().where('uuid', conversationUuid).first()
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    const conversationId = conv.id

    const member = await messageService.assertMember(conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member of this conversation.')

    const bot = await chatbot.getBotUser()
    const botMember = await messageService.assertMember(conversationId, bot.id)
    if (!botMember) {
      return ApiResponse.error(response, 400, 'This conversation has no AI participant.')
    }

    const userMessage = await messageService.createMessage({
      conversationId,
      senderId: me.id,
      content,
      skipAiTrigger: true,
    })

    let reply: string
    try {
      reply = await chatbot.generateReply(conversationId, content)
    } catch (err: any) {
      const status = err.status ?? 500
      let message = err.message ?? 'AI failed.'
      if (status === 429) {
        message = 'AI đang quá tải, vui lòng thử lại sau vài phút.'
      } else if (status === 503) {
        message = 'AI tạm thời không khả dụng, vui lòng thử lại sau.'
      }
      return ApiResponse.error(response, status, message)
    }

    const aiMessage = await messageService.createMessage({
      conversationId,
      senderId: bot.id,
      content: reply,
      skipAiTrigger: true,
    })

    return ApiResponse.ok(response, 'OK', {
      userMessage: await messageService.serialize(userMessage),
      aiMessage: await messageService.serialize(aiMessage),
    })
  }
}

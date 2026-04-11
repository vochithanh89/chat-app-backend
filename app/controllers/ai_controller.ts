import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Conversation from '#models/conversation'
import ConversationMember from '#models/conversation_member'
import { ApiResponse } from '#utils/api_response'
import { aiChatValidator } from '#validators/ai'
import chatbot from '#services/chatbot_service'
import messageService from '#services/message_service'

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
          { conversationId: c.id, userId: bot.id, role: 'member', joinedAt: DateTime.now() },
        ],
        { client: trx }
      )
      return c
    })

    await conv.load('members', (q) => q.preload('user'))
    return ApiResponse.created(response, 'AI conversation started.', { conversation: conv })
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
    })

    let reply: string
    try {
      reply = await chatbot.generateReply(conversationId, content)
    } catch (err: any) {
      return ApiResponse.error(response, err.status ?? 500, err.message ?? 'AI failed.')
    }

    const aiMessage = await messageService.createMessage({
      conversationId,
      senderId: bot.id,
      content: reply,
    })

    return ApiResponse.ok(response, 'OK', {
      userMessage: await messageService.serialize(userMessage),
      aiMessage: await messageService.serialize(aiMessage),
    })
  }
}

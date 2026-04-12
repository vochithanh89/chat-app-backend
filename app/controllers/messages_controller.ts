import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import Conversation from '#models/conversation'
import Message from '#models/message'
import MessageAttachment, { type AttachmentType } from '#models/message_attachment'
import MessageReaction from '#models/message_reaction'
import MessageDeletion from '#models/message_deletion'
import { ApiResponse } from '#utils/api_response'
import {
  sendMessageValidator,
  forwardMessageValidator,
  reactMessageValidator,
  uploadAttachmentValidator,
  listMessagesValidator,
} from '#validators/message'
import messageService from '#services/message_service'
import realtime from '#services/realtime_service'

function detectAttachmentType(extname: string): AttachmentType {
  const ext = extname.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio'
  return 'document'
}

/** Resolve a conversation by its public UUID (from a route param). */
async function resolveConversationByUuid(uuid: string) {
  return Conversation.query().where('uuid', uuid).first()
}

/** Resolve a message by its public UUID (from a route param). */
async function resolveMessageByUuid(uuid: string) {
  return Message.findBy('uuid', uuid)
}

export default class MessagesController {
  /**
   * @list
   * @operationId listMessages
   * @description Lists messages of a conversation. Cursor by `before` (message id), newest first.
   * @paramPath conversationId - Conversation ID.
   * @paramQuery before - Return messages with id < before.
   * @paramQuery limit - Page size (default 30, max 100).
   * @responseBody 200 - {"success": true, "message": "string", "data": {"messages": "array"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   */
  public async list({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveConversationByUuid(params.conversationId)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    const conversationId = conv.id
    const member = await messageService.assertMember(conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    const { before, limit = 30 } = await request.validateUsing(listMessagesValidator, {
      data: request.qs(),
    })

    // Hide messages the user has deleted on their side
    const deletedIds = (
      await MessageDeletion.query().where('user_id', me.id).select('message_id')
    ).map((d) => d.messageId)

    // Translate the UUID cursor (public) to its internal numeric id.
    let beforeId: number | null = null
    if (before) {
      const anchor = await Message.findBy('uuid', before)
      if (anchor) beforeId = anchor.id
    }

    const query = Message.query()
      .where('conversation_id', conversationId)
      .if(deletedIds.length > 0, (q) => q.whereNotIn('id', deletedIds))
      .if(beforeId, (q) => q.where('id', '<', beforeId!))
      .preload('sender')
      .preload('attachments')
      .preload('reactions')
      .orderBy('id', 'desc')
      .limit(limit)

    const messages = await query
    return ApiResponse.ok(response, 'OK', {
      messages: await Promise.all(messages.map((m) => messageService.serialize(m))),
    })
  }

  /**
   * @send
   * @operationId sendMessage
   * @description Sends a message to a conversation. Broadcasts via WebSocket.
   * @paramPath conversationId - Conversation ID.
   * @requestBody {"content": "string", "reply_to_message_id": "string", "attachment_ids": "string[]"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"message": "object"}}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async send({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveConversationByUuid(params.conversationId)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')
    const conversationId = conv.id
    const member = await messageService.assertMember(conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    const payload = await request.validateUsing(sendMessageValidator)

    // Public API uses UUIDs; resolve them to the internal numeric FKs
    // the messages table actually stores.
    let replyToMessageId: number | undefined
    if (payload.reply_to_message_id) {
      const replyTarget = await Message.findBy('uuid', payload.reply_to_message_id)
      if (!replyTarget || replyTarget.conversationId !== conversationId) {
        return ApiResponse.error(response, 400, 'Reply target not found in this conversation.')
      }
      replyToMessageId = replyTarget.id
    }

    let attachmentIds: number[] | undefined
    if (payload.attachment_ids && payload.attachment_ids.length > 0) {
      const rows = await MessageAttachment.query()
        .whereIn('uuid', payload.attachment_ids)
        .andWhere('uploaded_by', me.id)
        .whereNull('message_id')
      attachmentIds = rows.map((r) => r.id)
    }

    const message = await messageService.createMessage({
      conversationId,
      senderId: me.id,
      content: payload.content,
      replyToMessageId,
      attachmentIds,
    })

    return ApiResponse.created(response, 'Message sent.', {
      message: await messageService.serialize(message),
    })
  }

  /**
   * @uploadAttachment
   * @operationId uploadMessageAttachment
   * @description Uploads a file to be attached to a future message. Returns an attachment id to pass into `send`.
   * @requestBody {"file": "file"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"attachment": "object"}}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async uploadAttachment({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { file } = await request.validateUsing(uploadAttachmentValidator)

    const fileName = `${me.id}_${Date.now()}.${file.extname}`
    await file.move(app.makePath('public/uploads/messages'), { name: fileName, overwrite: true })

    const baseUrl = `${request.protocol()}://${request.host()}`
    const url = `${baseUrl}/uploads/messages/${fileName}`

    const attachment = await MessageAttachment.create({
      messageId: null,
      uploadedBy: me.id,
      url,
      type: detectAttachmentType(file.extname ?? ''),
      fileName: file.clientName,
      mimeType: file.headers['content-type'] ?? null,
      fileSize: file.size,
    })

    return ApiResponse.created(response, 'File uploaded.', { attachment })
  }

  /**
   * @recall
   * @operationId recallMessage
   * @description Recalls (un-sends) a message globally. Sender only.
   * @paramPath id - Message ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"message": "object"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   */
  public async recall({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const target = await resolveMessageByUuid(params.id)
    if (!target) return ApiResponse.error(response, 404, 'Message not found.')
    try {
      const message = await messageService.recall(target.id, me.id)
      return ApiResponse.ok(response, 'Message recalled.', {
        message: await messageService.serialize(message),
      })
    } catch (err: any) {
      return ApiResponse.error(response, err.status ?? 500, err.message ?? 'Failed.')
    }
  }

  /**
   * @deleteForMe
   * @operationId deleteMessageForMe
   * @description Hides a message for the current user only (other members still see it).
   * @paramPath id - Message ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async deleteForMe({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const message = await resolveMessageByUuid(params.id)
    if (!message) return ApiResponse.error(response, 404, 'Message not found.')
    const member = await messageService.assertMember(message.conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    await MessageDeletion.firstOrCreate({ messageId: message.id, userId: me.id })
    return ApiResponse.ok(response, 'Message deleted on your side.', null)
  }

  /**
   * @forward
   * @operationId forwardMessage
   * @description Forwards a message to one or more conversations.
   * @paramPath id - Message ID to forward.
   * @requestBody {"conversation_ids": "string[]"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"messages": "array"}}
   */
  public async forward({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const original = await resolveMessageByUuid(params.id)
    if (!original) return ApiResponse.error(response, 404, 'Message not found.')
    const { conversation_ids: conversationUuids } =
      await request.validateUsing(forwardMessageValidator)
    const created = await messageService.forward(original.id, me.id, conversationUuids)
    return ApiResponse.created(response, 'Message forwarded.', {
      messages: await Promise.all(created.map((m) => messageService.serialize(m))),
    })
  }

  /**
   * @react
   * @operationId reactToMessage
   * @description Adds a reaction (emoji) to a message.
   * @paramPath id - Message ID.
   * @requestBody {"emoji": "string"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"reaction": "object"}}
   */
  public async react({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { emoji } = await request.validateUsing(reactMessageValidator)
    const message = await resolveMessageByUuid(params.id)
    if (!message) return ApiResponse.error(response, 404, 'Message not found.')
    const member = await messageService.assertMember(message.conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    await MessageReaction.firstOrCreate(
      { messageId: message.id, userId: me.id, emoji },
      { messageId: message.id, userId: me.id, emoji }
    )
    realtime.emitToConversation(message.conversationId, 'message:reaction:added', {
      messageId: message.uuid,
      userId: me.uuid,
      emoji,
    })
    return ApiResponse.created(response, 'Reaction added.', {
      reaction: { messageId: message.uuid, userId: me.uuid, emoji },
    })
  }

  /**
   * @unreact
   * @operationId removeReaction
   * @description Removes a reaction the current user previously added.
   * @paramPath id - Message ID.
   * @paramPath emoji - The emoji to remove.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async unreact({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const message = await resolveMessageByUuid(params.id)
    if (!message) return ApiResponse.error(response, 404, 'Message not found.')

    await MessageReaction.query()
      .where('message_id', message.id)
      .andWhere('user_id', me.id)
      .andWhere('emoji', params.emoji)
      .delete()

    realtime.emitToConversation(message.conversationId, 'message:reaction:removed', {
      messageId: message.uuid,
      userId: me.uuid,
      emoji: params.emoji,
    })
    return ApiResponse.ok(response, 'Reaction removed.', null)
  }
}

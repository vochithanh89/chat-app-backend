import vine from '@vinejs/vine'

export const aiChatValidator = vine.compile(
  vine.object({
    conversation_id: vine.number().positive(),
    content: vine.string().trim().minLength(1).maxLength(4000),
  })
)

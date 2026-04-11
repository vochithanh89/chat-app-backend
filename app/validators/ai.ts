import vine from '@vinejs/vine'

export const aiChatValidator = vine.compile(
  vine.object({
    // Public conversation identifier is the UUID.
    conversation_id: vine.string().uuid(),
    content: vine.string().trim().minLength(1).maxLength(4000),
  })
)

import vine from '@vinejs/vine'

export const blockUserValidator = vine.compile(
  vine.object({
    // Public identifier — UUID.
    user_id: vine.string().uuid(),
  })
)

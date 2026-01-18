import vine from '@vinejs/vine'

export const resetPasswordValidator = vine.compile(
  vine.object({
    token: vine.string(),
    password: vine.string().minLength(8).confirmed(),
  })
)
import vine from '@vinejs/vine'

export const sendFriendRequestValidator = vine.compile(
  vine.object({
    addressee_id: vine.number().positive(),
  })
)

export const searchUsersValidator = vine.compile(
  vine.object({
    q: vine.string().trim().minLength(2).maxLength(100),
    type: vine.enum(['name', 'email', 'phone', 'auto'] as const).optional(),
    page: vine.number().positive().optional(),
    limit: vine.number().positive().max(50).optional(),
  })
)

export const registerDeviceTokenValidator = vine.compile(
  vine.object({
    token: vine.string().minLength(10).maxLength(512),
    platform: vine.enum(['android', 'ios', 'web'] as const),
  })
)

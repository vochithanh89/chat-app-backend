import vine from '@vinejs/vine'

export const changePasswordValidator = vine.compile(
  vine.object({
    current_password: vine.string(),
    password: vine.string().minLength(8).confirmed(),
    device_type: vine.enum(['web', 'mobile_android', 'mobile_ios']).optional(),
  })
)

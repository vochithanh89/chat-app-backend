import vine from '@vinejs/vine'

export const userLoginValidator = vine.compile(
  vine.object({
    email: vine.string().email().optional(),
    identifier: vine.string().optional(),
    password: vine.string(),
    // device_type indicates the kind of client initiating the login.
    // Expected values: web | mobile_android | mobile_ios
    device_type: vine.enum(['web', 'mobile_android', 'mobile_ios'] as const).optional(),
  })
)

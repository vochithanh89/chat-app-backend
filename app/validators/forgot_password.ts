import vine from '@vinejs/vine'

export const forgotPasswordValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
  })
)

export const verifyResetOtpValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    otp: vine.string().fixedLength(6),
  })
)

import vine from '@vinejs/vine'

export const verifyEmailValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
    otp: vine.string().fixedLength(6),
  })
)

export const resendOtpValidator = vine.compile(
  vine.object({
    email: vine.string().email(),
  })
)

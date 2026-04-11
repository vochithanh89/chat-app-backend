import vine from '@vinejs/vine'

export const userRegistrationValidator = vine.compile(
  vine.object({
    email: vine
      .string()
      .email()
      .unique(async (db, value) => {
        const user = await db.from('users').where('email', value).first()
        return !user
      }),
    phone: vine
      .string()
      .trim()
      .regex(/^\+?[0-9\s\-()]{8,20}$/)
      .unique(async (db, value) => {
        const user = await db.from('users').where('phone', value).first()
        return !user
      }),
    password: vine.string().minLength(8).confirmed(),
    name: vine.string().optional(),
  })
)

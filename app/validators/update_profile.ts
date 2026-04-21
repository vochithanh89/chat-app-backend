import vine from '@vinejs/vine'

export const updateProfileValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1).maxLength(100).optional(),
    bio: vine.string().maxLength(500).optional(),
  })
)

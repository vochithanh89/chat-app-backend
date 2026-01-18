import vine from '@vinejs/vine'

export const updateAvatarValidator = vine.compile(
  vine.object({
    avatar: vine.file({
      size: '2mb',
      extnames: ['jpg', 'png', 'jpeg'],
    }),
  })
)
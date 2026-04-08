import vine from '@vinejs/vine'

export const updateUserStatusValidator = vine.compile(
  vine.object({
    status: vine.enum(['active', 'locked'] as const),
  })
)

export const statsRangeValidator = vine.compile(
  vine.object({
    period: vine.enum(['day', 'week', 'month'] as const).optional(),
    days: vine.number().positive().max(365).optional(),
  })
)

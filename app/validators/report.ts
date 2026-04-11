import vine from '@vinejs/vine'

export const createReportValidator = vine.compile(
  vine.object({
    target_type: vine.enum(['user', 'message'] as const),
    // Target UUID (user.uuid or message.uuid).
    target_id: vine.string().uuid(),
    reason: vine.string().trim().minLength(3).maxLength(1000),
  })
)

export const updateReportStatusValidator = vine.compile(
  vine.object({
    status: vine.enum(['pending', 'reviewed', 'resolved', 'dismissed'] as const),
  })
)

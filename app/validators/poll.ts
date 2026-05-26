import vine from '@vinejs/vine'

export const createPollValidator = vine.compile(
  vine.object({
    question: vine.string().trim().minLength(1).maxLength(500),
    options: vine.array(vine.string().trim().minLength(1).maxLength(300)).minLength(2).maxLength(20),
    allow_multiple: vine.boolean().optional(),
  })
)

export const votePollValidator = vine.compile(
  vine.object({
    option_ids: vine.array(vine.string().uuid()).minLength(1).maxLength(20),
  })
)

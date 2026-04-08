import vine from '@vinejs/vine'

export const createDirectConversationValidator = vine.compile(
  vine.object({
    user_id: vine.number().positive(),
  })
)

export const createGroupConversationValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
    member_ids: vine.array(vine.number().positive()).minLength(1).maxLength(200),
  })
)

export const addMembersValidator = vine.compile(
  vine.object({
    user_ids: vine.array(vine.number().positive()).minLength(1).maxLength(200),
  })
)

export const updateMemberRoleValidator = vine.compile(
  vine.object({
    role: vine.enum(['admin', 'member'] as const),
  })
)

export const transferOwnershipValidator = vine.compile(
  vine.object({
    user_id: vine.number().positive(),
  })
)

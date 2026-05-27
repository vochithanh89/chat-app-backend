import vine from '@vinejs/vine'

export const createDirectConversationValidator = vine.compile(
  vine.object({
    // Public user identifier — UUID.
    user_id: vine.string().uuid(),
  })
)

export const createGroupConversationValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
    member_ids: vine.array(vine.string().uuid()).minLength(1).maxLength(200),
    comments_restricted: vine.boolean().optional(),
  })
)

export const updateGroupSettingsValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100).optional(),
    comments_restricted: vine.boolean().optional(),
    approve_members: vine.boolean().optional(),
  })
)

export const joinByCodeValidator = vine.compile(
  vine.object({
    code: vine.string().trim().minLength(4).maxLength(32),
  })
)

export const addMembersValidator = vine.compile(
  vine.object({
    user_ids: vine.array(vine.string().uuid()).minLength(1).maxLength(200),
  })
)

export const updateMemberRoleValidator = vine.compile(
  vine.object({
    role: vine.enum(['admin', 'member'] as const),
  })
)

export const transferOwnershipValidator = vine.compile(
  vine.object({
    user_id: vine.string().uuid(),
  })
)

export const updateMemberNicknameValidator = vine.compile(
  vine.object({
    nickname: vine.string().trim().maxLength(50).nullable().optional(),
  })
)

export const markReadValidator = vine.compile(
  vine.object({
    // Optional — UUID of the latest message the client saw. Lets the
    // server timestamp lastReadAt from that specific moment.
    last_message_id: vine.string().uuid().nullable().optional(),
  })
)

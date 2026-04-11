import vine from '@vinejs/vine'

export const sendMessageValidator = vine.compile(
  vine.object({
    content: vine.string().trim().maxLength(10000).optional(),
    reply_to_message_id: vine.number().positive().optional(),
    attachment_ids: vine.array(vine.number().positive()).maxLength(20).optional(),
  })
)

export const forwardMessageValidator = vine.compile(
  vine.object({
    // Public conversation identifiers are UUIDs.
    conversation_ids: vine.array(vine.string().uuid()).minLength(1).maxLength(20),
  })
)

export const reactMessageValidator = vine.compile(
  vine.object({
    emoji: vine.string().trim().minLength(1).maxLength(16),
  })
)

export const uploadAttachmentValidator = vine.compile(
  vine.object({
    file: vine.file({
      size: '20mb',
      extnames: [
        'jpg',
        'jpeg',
        'png',
        'gif',
        'webp',
        'mp4',
        'mov',
        'webm',
        'mp3',
        'wav',
        'm4a',
        'ogg',
        'pdf',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'txt',
        'zip',
      ],
    }),
  })
)

export const listMessagesValidator = vine.compile(
  vine.object({
    before: vine.number().positive().optional(),
    limit: vine.number().positive().max(100).optional(),
  })
)

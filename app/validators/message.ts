import vine from '@vinejs/vine'

export const sendMessageValidator = vine.compile(
  vine.object({
    content: vine.string().trim().maxLength(10000).optional(),
    reply_to_message_id: vine.string().uuid().optional(),
    attachment_ids: vine.array(vine.string().uuid()).maxLength(20).optional(),
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
        'aac',
        'pdf',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'txt',
        'zip',
      ],
    }),
    // For voice messages — caller may pass the recording duration so the
    // UI can render the waveform/length without probing the file.
    duration_ms: vine.number().positive().max(60 * 60 * 1000).optional(),
    // Optional override when the file extension doesn't match (e.g. a
    // browser-recorded audio/webm should still be classified as audio).
    type: vine.enum(['image', 'video', 'audio', 'document'] as const).optional(),
  })
)

export const listMessagesValidator = vine.compile(
  vine.object({
    // Cursor: UUID of the earliest message already seen on the client.
    // Returns messages strictly older than the anchor.
    before: vine.string().uuid().optional(),
    limit: vine.number().positive().max(100).optional(),
  })
)

import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Message from '#models/message'

export type AttachmentType = 'image' | 'video' | 'document' | 'audio'

export default class MessageAttachment extends BaseModel {
  // Attachment ids stay numeric — auxiliary table. The client only uses
  // them as opaque tokens between upload and send-message.
  @column({ isPrimary: true })
  declare id: number

  @column({ serializeAs: null })
  declare messageId: number | null

  @column({ serializeAs: null })
  declare uploadedBy: number | null

  @column()
  declare url: string

  @column()
  declare type: AttachmentType

  @column()
  declare fileName: string | null

  @column()
  declare mimeType: string | null

  @column()
  declare fileSize: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Message)
  declare message: BelongsTo<typeof Message>
}

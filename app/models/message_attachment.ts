import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Message from '#models/message'

export type AttachmentType = 'image' | 'video' | 'document' | 'audio'

export default class MessageAttachment extends BaseModel {
  // Numeric id is kept for internal FK joins but hidden from responses.
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  // Public identifier — always serialised as `id`.
  @column({ serializeAs: 'id' })
  declare uuid: string

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

  @beforeCreate()
  static assignUuid(attachment: MessageAttachment) {
    if (!attachment.uuid) {
      attachment.uuid = randomUUID()
    }
  }
}

import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Conversation from '#models/conversation'
import MessageAttachment from '#models/message_attachment'
import MessageReaction from '#models/message_reaction'

export default class Message extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare conversationId: number

  @column()
  declare senderId: number

  @column()
  declare content: string | null

  @column()
  declare replyToMessageId: number | null

  @column()
  declare forwardedFromId: number | null

  @column()
  declare isRecalled: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'senderId' })
  declare sender: BelongsTo<typeof User>

  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>

  @belongsTo(() => Message, { foreignKey: 'replyToMessageId' })
  declare replyTo: BelongsTo<typeof Message>

  @hasMany(() => MessageAttachment)
  declare attachments: HasMany<typeof MessageAttachment>

  @hasMany(() => MessageReaction)
  declare reactions: HasMany<typeof MessageReaction>
}

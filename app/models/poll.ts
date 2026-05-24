import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Conversation from '#models/conversation'
import Message from '#models/message'
import PollOption from '#models/poll_option'

export default class Poll extends BaseModel {
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  @column({ serializeAs: 'id' })
  declare uuid: string

  @column({ serializeAs: null })
  declare messageId: number

  @column({ serializeAs: null })
  declare conversationId: number

  @column({ serializeAs: null })
  declare createdBy: number | null

  @column()
  declare question: string

  @column()
  declare allowMultiple: boolean

  @column()
  declare isClosed: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Message)
  declare message: BelongsTo<typeof Message>

  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @hasMany(() => PollOption)
  declare options: HasMany<typeof PollOption>

  @beforeCreate()
  static assignUuid(poll: Poll) {
    if (!poll.uuid) poll.uuid = randomUUID()
  }
}

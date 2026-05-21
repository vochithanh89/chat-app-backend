import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Message from '#models/message'

export default class MessageStar extends BaseModel {
  static table = 'message_stars'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare messageId: number

  @column()
  declare userId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Message)
  declare message: BelongsTo<typeof Message>
}

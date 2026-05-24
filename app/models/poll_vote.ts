import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import PollOption from '#models/poll_option'

export default class PollVote extends BaseModel {
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  @column({ serializeAs: null })
  declare pollOptionId: number

  @column({ serializeAs: null })
  declare userId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => PollOption)
  declare option: BelongsTo<typeof PollOption>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}

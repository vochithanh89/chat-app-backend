import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Poll from '#models/poll'
import PollVote from '#models/poll_vote'

export default class PollOption extends BaseModel {
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  @column({ serializeAs: 'id' })
  declare uuid: string

  @column({ serializeAs: null })
  declare pollId: number

  @column()
  declare text: string

  @column()
  declare position: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Poll)
  declare poll: BelongsTo<typeof Poll>

  @hasMany(() => PollVote)
  declare votes: HasMany<typeof PollVote>

  @beforeCreate()
  static assignUuid(option: PollOption) {
    if (!option.uuid) option.uuid = randomUUID()
  }
}

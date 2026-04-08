import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export type FriendshipStatus = 'pending' | 'accepted'

export default class Friendship extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare requesterId: number

  @column()
  declare addresseeId: number

  @column()
  declare status: FriendshipStatus

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'requesterId' })
  declare requester: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'addresseeId' })
  declare addressee: BelongsTo<typeof User>
}

import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export type FriendshipStatus = 'pending' | 'accepted'

export default class Friendship extends BaseModel {
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  @column({ serializeAs: 'id' })
  declare uuid: string

  @column({ serializeAs: null })
  declare requesterId: number

  @column({ serializeAs: null })
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

  @beforeCreate()
  static assignUuid(friendship: Friendship) {
    if (!friendship.uuid) {
      friendship.uuid = randomUUID()
    }
  }
}

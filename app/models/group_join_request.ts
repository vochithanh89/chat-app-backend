import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Conversation from '#models/conversation'

export default class GroupJoinRequest extends BaseModel {
  public static table = 'group_join_requests'

  @column({ isPrimary: true })
  declare id: number

  @column({ serializeAs: null })
  declare conversationId: number

  @column({ serializeAs: null })
  declare userId: number

  @column()
  declare status: 'pending' | 'approved' | 'rejected'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>
}

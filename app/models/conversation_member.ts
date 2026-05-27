import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Conversation from '#models/conversation'

export type MemberRole = 'owner' | 'admin' | 'member'

export default class ConversationMember extends BaseModel {
  // Pivot row — its own numeric id is internal only.
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  @column({ serializeAs: null })
  declare conversationId: number

  @column({ serializeAs: null })
  declare userId: number

  @column()
  declare role: MemberRole

  @column.dateTime()
  declare joinedAt: DateTime

  @column.dateTime()
  declare lastReadAt: DateTime | null

  @column()
  declare isMuted: boolean

  @column()
  declare isPinned: boolean

  @column()
  declare pinOrder: number | null

  @column()
  declare nickname: string | null

  @column({ columnName: 'chat_background' })
  declare chatBackground: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>
}

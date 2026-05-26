import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import ConversationMember from '#models/conversation_member'
import Message from '#models/message'

export type ConversationType = 'direct' | 'group'

export default class Conversation extends BaseModel {
  // Numeric primary key is kept for internal FKs + joins, but hidden
  // from every API response. Clients only ever see the UUID, exposed
  // as `id` via `serializeAs`.
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  @column({ serializeAs: 'id' })
  declare uuid: string

  @column()
  declare type: ConversationType

  @column()
  declare name: string | null

  @column()
  declare avatarUrl: string | null

  @column({ serializeAs: null })
  declare ownerId: number | null

  @column({ serializeAs: null })
  declare createdBy: number | null

  @column()
  declare commentsRestricted: boolean

  @column()
  declare approveMembers: boolean

  @column()
  declare inviteCode: string | null

  @column.dateTime()
  declare lastMessageAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'ownerId' })
  declare owner: BelongsTo<typeof User>

  @hasMany(() => ConversationMember)
  declare members: HasMany<typeof ConversationMember>

  @hasMany(() => Message)
  declare messages: HasMany<typeof Message>

  @beforeCreate()
  static assignUuid(conversation: Conversation) {
    if (!conversation.uuid) {
      conversation.uuid = randomUUID()
    }
  }

  @beforeCreate()
  static assignInviteCode(conversation: Conversation) {
    // Only groups get an invite code. Format: 8 uppercase alphanumerics.
    if (conversation.type === 'group' && !conversation.inviteCode) {
      conversation.inviteCode = generateInviteCode()
    }
  }
}

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generateInviteCode(length = 8): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)]
  }
  return out
}

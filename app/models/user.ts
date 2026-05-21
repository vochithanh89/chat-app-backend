import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  // Internal numeric primary key — used for FK joins, never exposed.
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  // Public identifier — always serialised as `id` in every response.
  @column({ serializeAs: 'id' })
  declare uuid: string

  @column()
  declare name: string | null

  @column()
  declare email: string

  @column()
  declare phone: string

  @column({ serializeAs: null })
  declare password: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column()
  declare verificationToken: string | undefined

  @column.dateTime()
  declare verifiedAt: DateTime | null

  @column()
  declare status: string

  @column()
  declare avatarUrl: string | null

  @column()
  declare bio: string | null

  @column.dateTime({ columnName: 'accepted_terms_at' })
  declare acceptedTermsAt: DateTime | null

  @column()
  declare isOnline: boolean

  @column.dateTime()
  declare lastSeenAt: DateTime | null

  @column()
  declare isAdmin: boolean

  @column()
  declare accountStatus: 'active' | 'locked'

  static refreshTokens = DbAccessTokensProvider.forModel(User, {
    prefix: 'rt_',
    table: 'jwt_refresh_tokens',
    type: 'jwt_refresh_token',
    tokenSecretLength: 40,
  })

  @beforeCreate()
  static assignUuid(user: User) {
    if (!user.uuid) {
      user.uuid = randomUUID()
    }
  }
}

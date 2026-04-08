import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export type ReportTargetType = 'user' | 'message'
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed'

export default class Report extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reporterId: number

  @column()
  declare targetType: ReportTargetType

  @column()
  declare targetId: number

  @column()
  declare reason: string

  @column()
  declare status: ReportStatus

  @column()
  declare reviewedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'reporterId' })
  declare reporter: BelongsTo<typeof User>
}

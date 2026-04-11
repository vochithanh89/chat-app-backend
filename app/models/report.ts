import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export type ReportTargetType = 'user' | 'message'
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed'

export default class Report extends BaseModel {
  @column({ isPrimary: true, serializeAs: null })
  declare id: number

  @column({ serializeAs: 'id' })
  declare uuid: string

  @column({ serializeAs: null })
  declare reporterId: number

  @column()
  declare targetType: ReportTargetType

  // Numeric FK internally; controllers translate to UUID in responses.
  @column({ serializeAs: null })
  declare targetId: number

  @column()
  declare reason: string

  @column()
  declare status: ReportStatus

  @column({ serializeAs: null })
  declare reviewedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'reporterId' })
  declare reporter: BelongsTo<typeof User>

  @beforeCreate()
  static assignUuid(report: Report) {
    if (!report.uuid) {
      report.uuid = randomUUID()
    }
  }
}

import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Conversation from '#models/conversation'
import Message from '#models/message'
import Report from '#models/report'
import { ApiResponse } from '#utils/api_response'
import {
  updateUserStatusValidator,
  statsRangeValidator,
} from '#validators/admin'
import { updateReportStatusValidator } from '#validators/report'

function rangeStart(period: 'day' | 'week' | 'month', days?: number): { start: DateTime; bucket: string } {
  const now = DateTime.now()
  if (period === 'day') {
    return { start: now.minus({ days: days ?? 30 }).startOf('day'), bucket: '%Y-%m-%d' }
  }
  if (period === 'week') {
    return { start: now.minus({ weeks: days ?? 12 }).startOf('week'), bucket: '%x-%v' }
  }
  return { start: now.minus({ months: days ?? 12 }).startOf('month'), bucket: '%Y-%m' }
}

export default class AdminController {
  /**
   * @overview
   * @operationId adminOverview
   * @description Returns high-level counts (users, groups, conversations, today's messages).
   * @responseBody 200 - {"success": true, "message": "string", "data": {"users": "number", "newUsersToday": "number", "conversations": "number", "groups": "number", "messagesToday": "number"}}
   */
  public async overview({ response }: HttpContext) {
    const startOfDay = DateTime.now().startOf('day').toSQL({ includeOffset: false })
    const [users, newUsersToday, conversations, groups, messagesToday] = await Promise.all([
      User.query().count('* as total'),
      User.query().where('created_at', '>=', startOfDay!).count('* as total'),
      Conversation.query().count('* as total'),
      Conversation.query().where('type', 'group').count('* as total'),
      Message.query().where('created_at', '>=', startOfDay!).count('* as total'),
    ])

    return ApiResponse.ok(response, 'OK', {
      users: Number((users[0] as any).$extras.total),
      newUsersToday: Number((newUsersToday[0] as any).$extras.total),
      conversations: Number((conversations[0] as any).$extras.total),
      groups: Number((groups[0] as any).$extras.total),
      messagesToday: Number((messagesToday[0] as any).$extras.total),
    })
  }

  /**
   * @messageStats
   * @operationId adminMessageStats
   * @description Returns a time-series of message counts grouped by day/week/month.
   * @paramQuery period - day | week | month (default: day).
   * @paramQuery days - number of buckets to look back.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"series": "array"}}
   */
  public async messageStats({ request, response }: HttpContext) {
    const { period = 'day', days } = await request.validateUsing(statsRangeValidator, {
      data: request.qs(),
    })
    const { start, bucket } = rangeStart(period, days)

    const rows = await db
      .from('messages')
      .select(db.raw(`DATE_FORMAT(created_at, '${bucket}') as bucket`))
      .count('* as total')
      .where('created_at', '>=', start.toSQL({ includeOffset: false })!)
      .groupByRaw('bucket')
      .orderByRaw('bucket asc')

    return ApiResponse.ok(response, 'OK', {
      period,
      series: rows.map((r: any) => ({ bucket: r.bucket, total: Number(r.total) })),
    })
  }

  /**
   * @listUsers
   * @operationId adminListUsers
   * @description Lists users with optional search.
   * @paramQuery q - Search keyword (name/email).
   * @paramQuery page - Page number (default 1).
   * @paramQuery limit - Page size (default 20, max 100).
   * @responseBody 200 - {"success": true, "message": "string", "data": {"users": "array", "meta": "object"}}
   */
  public async listUsers({ request, response }: HttpContext) {
    const q = (request.input('q') as string | undefined)?.trim()
    const page = Number(request.input('page', 1))
    const limit = Math.min(Number(request.input('limit', 20)), 100)

    const query = User.query().orderBy('id', 'desc')
    if (q) {
      query.where((sub) => {
        sub.where('name', 'like', `%${q}%`).orWhere('email', 'like', `%${q}%`)
      })
    }
    const result = await query.paginate(page, limit)
    return ApiResponse.ok(response, 'OK', {
      users: result.all(),
      meta: result.getMeta(),
    })
  }

  /**
   * @updateUserStatus
   * @operationId adminUpdateUserStatus
   * @description Locks or unlocks a user account.
   * @paramPath id - User ID.
   * @requestBody {"status": "active | locked"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"user": "object"}}
   */
  public async updateUserStatus({ params, request, response }: HttpContext) {
    const user = await User.findBy('uuid', params.id)
    if (!user) return ApiResponse.error(response, 404, 'User not found.')
    const { status } = await request.validateUsing(updateUserStatusValidator)
    user.accountStatus = status
    await user.save()
    return ApiResponse.ok(response, 'User status updated.', { user })
  }

  /**
   * @listReports
   * @operationId adminListReports
   * @description Lists user reports, optionally filtered by status.
   * @paramQuery status - pending | reviewed | resolved | dismissed.
   * @paramQuery page - Page number (default 1).
   * @paramQuery limit - Page size (default 20, max 100).
   * @responseBody 200 - {"success": true, "message": "string", "data": {"reports": "array", "meta": "object"}}
   */
  public async listReports({ request, response }: HttpContext) {
    const status = request.input('status') as string | undefined
    const page = Number(request.input('page', 1))
    const limit = Math.min(Number(request.input('limit', 20)), 100)

    const query = Report.query().preload('reporter').orderBy('id', 'desc')
    if (status) query.where('status', status)
    const result = await query.paginate(page, limit)
    return ApiResponse.ok(response, 'OK', {
      reports: result.all(),
      meta: result.getMeta(),
    })
  }

  /**
   * @updateReportStatus
   * @operationId adminUpdateReportStatus
   * @description Updates the status of a report.
   * @paramPath id - Report ID.
   * @requestBody {"status": "pending | reviewed | resolved | dismissed"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"report": "object"}}
   */
  public async updateReportStatus({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const report = await Report.findBy('uuid', params.id)
    if (!report) return ApiResponse.error(response, 404, 'Report not found.')
    const { status } = await request.validateUsing(updateReportStatusValidator)
    report.status = status
    report.reviewedBy = me.id
    await report.save()
    return ApiResponse.ok(response, 'Report updated.', { report })
  }
}

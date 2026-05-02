import type { HttpContext } from '@adonisjs/core/http'
import Report from '#models/report'
import User from '#models/user'
import Message from '#models/message'
import { ApiResponse } from '#utils/api_response'
import { createReportValidator } from '#validators/report'

export default class ReportsController {
  /**
   * @create
   * @operationId createReport
   * @description Reports a user or message for moderation review.
   * @requestBody {"target_type": "user | message", "target_id": "string", "reason": "string"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"report": "object"}}
   * @responseBody 404 - {"success": false, "message": "Target not found.", "errors": []}
   */
  public async create({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const {
      target_type: targetType,
      target_id: targetUuid,
      reason,
    } = await request.validateUsing(createReportValidator)

    // Resolve public UUID → internal numeric id for the right table.
    let targetId: number | null = null
    if (targetType === 'user') {
      const u = await User.findBy('uuid', targetUuid)
      targetId = u?.id ?? null
    } else {
      const m = await Message.findBy('uuid', targetUuid)
      targetId = m?.id ?? null
    }
    if (!targetId) {
      return ApiResponse.error(response, 404, 'Target not found.')
    }

    const report = await Report.create({
      reporterId: me.id,
      targetType,
      targetId,
      reason,
      status: 'pending',
    })
    return ApiResponse.created(response, 'Report submitted.', { report })
  }

  /**
   * @mine
   * @operationId listMyReports
   * @description Lists reports submitted by the current user.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"reports": "array"}}
   */
  public async mine({ response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const reports = await Report.query().where('reporter_id', me.id).orderBy('id', 'desc')
    return ApiResponse.ok(response, 'OK', { reports })
  }
}

import type { HttpContext } from '@adonisjs/core/http'
import { ApiResponse } from '#utils/api_response'
import QrLoginService from '#services/qr_login_service'
import RealtimeService from '#services/realtime_service'
import User from '#models/user'
import { DateTime } from 'luxon'

export default class QrLoginController {
  /**
   * @generate
   * @operationId generateQrLogin
   * @description Generates a new QR login session.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"qrContent": "string", "sessionId": "string"}}
   */
  public async generate({ response }: HttpContext) {
    const session = QrLoginService.generateSession()
    // Web client will subscribe to `qr:${session.sessionId}` via RealtimeService
    return ApiResponse.ok(response, 'QR session generated.', {
      qrContent: session.qrContent,
      sessionId: session.sessionId,
    })
  }

  /**
   * @scan
   * @operationId scanQrLogin
   * @description Mobile app scans the QR code.
   * @requestBody {"qrContent": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async scan({ request, response, auth }: HttpContext) {
    const { qrContent } = request.only(['qrContent'])
    const user = auth.getUserOrFail()

    // Find the session by its content
    const session = Array.from(QrLoginService['sessions'].values()).find(s => s.qrContent === qrContent);

    if (!session) {
      return ApiResponse.error(response, 404, 'QR session not found or expired.')
    }

    if (session.status !== 'pending') {
      return ApiResponse.error(response, 400, 'QR session already scanned or expired.')
    }

    QrLoginService.updateSession(session.sessionId, {
      status: 'scanned',
      scannedByUserId: user.id,
    })

    // Emit to web that QR was scanned
    RealtimeService.emitToRoom(`qr:${session.sessionId}`, 'qr:scanned', {
      user: user.serialize(),
    })

    return ApiResponse.ok(response, 'QR code scanned.', { sessionId: session.sessionId })
  }

  /**
   * @confirm
   * @operationId confirmQrLogin
   * @description Mobile app confirms the login.
   * @requestBody {"sessionId": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"accessToken": "string", "refreshToken": "string", "user": "object"}}
   */
  public async confirm({ request, response, auth }: HttpContext) {
    const { sessionId } = request.only(['sessionId'])
    const user = auth.getUserOrFail()
    const session = QrLoginService.getSession(sessionId)

    if (!session) {
      return ApiResponse.error(response, 404, 'QR session not found or expired.')
    }

    if (session.status !== 'scanned') {
      return ApiResponse.error(response, 400, 'QR session must be scanned first.')
    }

    if (session.scannedByUserId !== user.id) {
      return ApiResponse.error(response, 403, 'Unauthorized to confirm this session.')
    }

    if (user.accountStatus === 'locked') {
        return ApiResponse.error(response, 403, 'Your account has been locked. Contact support.')
    }

    // Generate token for Web
    const tokens = await auth.use('jwt').generate(user)
    const refreshToken = await User.refreshTokens.create(user, { name: 'web_qr_login' } as any)

    user.isOnline = true
    user.lastSeenAt = DateTime.now()
    await user.save()

    // Emit tokens to the web client
    RealtimeService.emitToRoom(`qr:${session.sessionId}`, 'qr:confirmed', {
      accessToken: (tokens as any).token,
      refreshToken: refreshToken.value!.release(),
      user: user.serialize(),
    })

    QrLoginService.deleteSession(sessionId)

    return ApiResponse.ok(response, 'Login confirmed.', null)
  }

  /**
   * @reject
   * @operationId rejectQrLogin
   * @description Mobile app rejects the login.
   * @requestBody {"sessionId": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async reject({ request, response, auth }: HttpContext) {
    const { sessionId } = request.only(['sessionId'])
    const user = auth.getUserOrFail()
    const session = QrLoginService.getSession(sessionId)

    if (!session) {
      return ApiResponse.error(response, 404, 'QR session not found or expired.')
    }

    if (session.scannedByUserId !== user.id) {
      return ApiResponse.error(response, 403, 'Unauthorized to reject this session.')
    }

    // Notify web client
    RealtimeService.emitToRoom(`qr:${session.sessionId}`, 'qr:rejected', null)

    // Delete the session
    QrLoginService.deleteSession(sessionId)

    return ApiResponse.ok(response, 'Login rejected.', null)
  }
}

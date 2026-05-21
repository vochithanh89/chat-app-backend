import type { HttpContext } from '@adonisjs/core/http'
import QrSessionService from '#services/qr_session_service'
import realtimeService from '#services/realtime_service'
import User from '#models/user'
import env from '#start/env'

export default class QrLoginController {
  // GET /api/v1/qr-login/generate
  // Web calls this to generate a QR
  public async generate({ response }: HttpContext) {
    const session = QrSessionService.createSession()
    
    // Web will subscribe to `qr:${session.sessionId}` in realtimeService
    return response.ok({
      qrSessionId: session.sessionId,
      qrContent: `mychat://qr-login?session=${session.sessionId}`,
      expiresAt: session.expiresAt
    })
  }

  // POST /api/v1/qr-login/scan
  // Mobile calls this after scanning
  public async scan({ request, response, auth }: HttpContext) {
    const { qrSessionId } = request.only(['qrSessionId'])
    const user = auth.getUserOrFail()

    const session = QrSessionService.getSession(qrSessionId)
    if (!session) {
      return response.badRequest({ message: 'QR session expired or invalid' })
    }

    if (session.status !== 'pending') {
      return response.badRequest({ message: 'QR session already scanned' })
    }

    QrSessionService.updateSession(qrSessionId, { status: 'scanned', userId: user.id })

    // Emit to web that QR was scanned
    realtimeService.io.to(`qr:${qrSessionId}`).emit('qr:scanned', {
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatarUrl
      }
    })

    return response.ok({ message: 'QR scanned successfully' })
  }

  // POST /api/v1/qr-login/confirm
  // Mobile calls this after the user clicks "Confirm"
  public async confirm({ request, response, auth }: HttpContext) {
    const { qrSessionId } = request.only(['qrSessionId'])
    const user = auth.getUserOrFail()

    const session = QrSessionService.getSession(qrSessionId)
    if (!session) {
      return response.badRequest({ message: 'QR session expired or invalid' })
    }

    if (session.status !== 'scanned') {
      return response.badRequest({ message: 'QR session must be scanned first' })
    }

    if (session.userId !== user.id) {
      return response.unauthorized({ message: 'User mismatch' })
    }

    QrSessionService.updateSession(qrSessionId, { status: 'confirmed' })

    // Generate token for Web
    const tokens = await auth.use('jwt').generate(user)
    const refreshTokenRow = await User.refreshTokens.create(user, { name: 'web' })

    realtimeService.io.to(`qr:${qrSessionId}`).emit('qr:confirmed', {
      accessToken: (tokens as any).token,
      refreshToken: refreshTokenRow.value!.release(),
      user: user.serialize()
    })

    QrSessionService.removeSession(qrSessionId)

    return response.ok({ message: 'Login confirmed successfully' })
  }

  // POST /api/v1/qr-login/reject
  // Mobile calls this if user rejects
  public async reject({ request, response, auth }: HttpContext) {
    const { qrSessionId } = request.only(['qrSessionId'])
    
    const session = QrSessionService.getSession(qrSessionId)
    if (!session) {
      return response.badRequest({ message: 'QR session expired or invalid' })
    }

    QrSessionService.updateSession(qrSessionId, { status: 'pending' })
    
    realtimeService.io.to(`qr:${qrSessionId}`).emit('qr:rejected', {})

    return response.ok({ message: 'QR login rejected' })
  }
}

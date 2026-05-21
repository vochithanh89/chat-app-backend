import { randomUUID } from 'node:crypto'

export interface QrSession {
  sessionId: string
  status: 'pending' | 'scanned' | 'confirmed'
  userId?: number
  expiresAt: number
}

class QrSessionService {
  private sessions: Map<string, QrSession> = new Map()
  private readonly TTL = 120 * 1000 // 120 seconds

  public createSession(): QrSession {
    const sessionId = randomUUID()
    const expiresAt = Date.now() + this.TTL

    const session: QrSession = {
      sessionId,
      status: 'pending',
      expiresAt,
    }

    this.sessions.set(sessionId, session)

    // Auto-remove after TTL
    setTimeout(async () => {
      this.sessions.delete(sessionId)
      // dynamically import to prevent circular dependency
      const realtimeService = (await import('#services/realtime_service')).default
      realtimeService.io.to(`qr:${sessionId}`).emit('qr:expired', {})
    }, this.TTL)

    return session
  }

  public getSession(sessionId: string): QrSession | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId)
      return undefined
    }
    return session
  }

  public updateSession(sessionId: string, data: Partial<QrSession>) {
    const session = this.getSession(sessionId)
    if (session) {
      Object.assign(session, data)
      this.sessions.set(sessionId, session)
      return session
    }
    return undefined
  }

  public removeSession(sessionId: string) {
    this.sessions.delete(sessionId)
  }
}

export default new QrSessionService()

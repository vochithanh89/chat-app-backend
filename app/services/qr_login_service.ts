import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

export interface QrSession {
  sessionId: string
  qrContent: string
  status: 'pending' | 'scanned' | 'expired'
  scannedByUserId?: number
  createdAt: DateTime
}

class QrLoginService {
  private sessions = new Map<string, QrSession>()

  constructor() {
    // Cleanup expired sessions every minute
    setInterval(() => {
      this.cleanup()
    }, 60 * 1000)
  }

  generateSession(): QrSession {
    const sessionId = randomUUID()
    const qrContent = randomUUID()
    
    const session: QrSession = {
      sessionId,
      qrContent,
      status: 'pending',
      createdAt: DateTime.now(),
    }
    
    this.sessions.set(sessionId, session)
    return session
  }

  getSession(sessionId: string): QrSession | undefined {
    return this.sessions.get(sessionId)
  }

  updateSession(sessionId: string, data: Partial<QrSession>): QrSession | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    
    const updated = { ...session, ...data }
    this.sessions.set(sessionId, updated)
    return updated
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  private cleanup(): void {
    const now = DateTime.now()
    for (const [sessionId, session] of this.sessions.entries()) {
      // Expire after 5 minutes
      if (now.diff(session.createdAt, 'minutes').minutes > 5) {
        this.sessions.delete(sessionId)
      }
    }
  }
}

export default new QrLoginService()

import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import DeviceToken from '#models/device_token'
import admin from 'firebase-admin'

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, string>
}

/**
 * Notification dispatch service.
 *
 * Initializes firebase-admin lazily on first use, only if all three
 * FIREBASE_* env vars are set. Otherwise it falls back to logging the
 * payload — handy for local dev without Firebase credentials.
 */
class NotificationService {
  private fcmApp: admin.app.App | null = null
  private fcmReady = false

  private getFcmApp(): admin.app.App | null {
    if (this.fcmReady) return this.fcmApp

    this.fcmReady = true
    const projectId = env.get('FIREBASE_PROJECT_ID')
    const clientEmail = env.get('FIREBASE_CLIENT_EMAIL')
    const privateKey = env.get('FIREBASE_PRIVATE_KEY')

    if (!projectId || !clientEmail || !privateKey) {
      logger.warn('FCM disabled — FIREBASE_* env vars not set')
      return null
    }

    try {
      this.fcmApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          // .env stores newlines as literal "\n" — restore them.
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      })
      logger.info('FCM initialized')
    } catch (err) {
      logger.error({ err }, 'FCM initialization failed')
      this.fcmApp = null
    }
    return this.fcmApp
  }

  /** Send a push notification to every device registered for `userId`. */
  async sendToUser(userId: number, payload: PushPayload): Promise<void> {
    const tokens = await DeviceToken.query().where('user_id', userId)
    if (tokens.length === 0) {
      logger.info({ userId, payload }, 'notification: no device tokens, skipping')
      return
    }
    await this.dispatchToTokens(
      tokens.map((t) => t.token),
      payload
    )
  }

  private async dispatchToTokens(tokens: string[], payload: PushPayload): Promise<void> {
    const app = this.getFcmApp()
    if (!app) {
      logger.info(
        { tokenCount: tokens.length, payload },
        'notification: FCM disabled, would send push'
      )
      return
    }

    try {
      const result = await app.messaging().sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
      })

      // Prune tokens FCM tells us are invalid (uninstalled / expired).
      const stale: string[] = []
      result.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code ?? ''
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            stale.push(tokens[i])
          }
        }
      })
      if (stale.length > 0) {
        await DeviceToken.query().whereIn('token', stale).delete()
        logger.info({ removed: stale.length }, 'notification: pruned stale device tokens')
      }
    } catch (err) {
      logger.error({ err }, 'notification: FCM send failed')
    }
  }
}

export default new NotificationService()

import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { DateTime } from 'luxon'

/**
 * Updates `is_online` and `last_seen_at` on every authenticated request.
 * Skipped silently if no user is attached.
 */
export default class TrackPresenceMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth?.user
    if (user) {
      if (!user.isPrivatePresence) {
        user.isOnline = true
        user.lastSeenAt = DateTime.now()
        // Avoid blocking the request — fire and forget.
        user.save().catch(() => {})
      } else if (user.isOnline) {
        user.isOnline = false
        user.save().catch(() => {})
      }
    }
    return next()
  }
}

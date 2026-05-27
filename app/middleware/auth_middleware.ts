import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { ApiResponse } from '#utils/api_response'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  /**
   * The URL to redirect to, when authentication fails
   */
  redirectTo = '/login'

  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })
    const user = ctx.auth.user
    if (user && user.accountStatus === 'locked') {
      return ApiResponse.error(
        ctx.response,
        403,
        'tài khoản của bạn đã bị khóa, hãy liên hệ với hỗ trợ viên để được mở khóa. tài khoản hỗ trợ viên: chatappN7@support.com'
      )
    }
    return next()
  }
}

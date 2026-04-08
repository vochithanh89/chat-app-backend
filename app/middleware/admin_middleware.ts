import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { ApiResponse } from '#utils/api_response'

export default class AdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth?.user
    if (!user || !user.isAdmin) {
      return ApiResponse.error(ctx.response, 403, 'Admin access required.')
    }
    return next()
  }
}

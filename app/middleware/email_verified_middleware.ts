import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class EmailVerifiedMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (!ctx.auth.user || !ctx.auth.user.verifiedAt) {
      return ctx.response.unauthorized({ message: 'Email not verified.' })
    }

    /**
     * Call next method in the pipeline and return its output
     */
    const output = await next()
    return output
  }
}
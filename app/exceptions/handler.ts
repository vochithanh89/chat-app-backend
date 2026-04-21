import app from '@adonisjs/core/services/app'
import { HttpContext, ExceptionHandler, errors as httpErrors } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { errors as vineErrors } from '@vinejs/vine'
import { ApiResponse, ApiErrorItem } from '#utils/api_response'

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    // VineJS validation errors → 422 with field-level errors
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const messages = (error.messages ?? []) as Array<{
        field: string
        message: string
      }>
      const items: ApiErrorItem[] = messages.map((m) => ({
        field: m.field ?? null,
        message: m.message,
      }))
      return ApiResponse.error(ctx.response, 422, 'Validation failed.', items)
    }

    // Auth errors
    if (
      error instanceof authErrors.E_INVALID_CREDENTIALS ||
      error instanceof authErrors.E_UNAUTHORIZED_ACCESS
    ) {
      return ApiResponse.error(ctx.response, 401, error.message ?? 'Unauthorized.')
    }

    // Route not found
    if (error instanceof httpErrors.E_ROUTE_NOT_FOUND) {
      return ApiResponse.error(ctx.response, 404, 'Route not found.')
    }

    // Generic HttpException with status
    const anyErr = error as any
    if (anyErr && typeof anyErr.status === 'number') {
      return ApiResponse.error(ctx.response, anyErr.status, anyErr.message ?? 'Request failed.')
    }

    // Fallback 500
    if (this.debug) {
      return ApiResponse.error(ctx.response, 500, anyErr?.message ?? 'Internal server error.')
    }
    return ApiResponse.error(ctx.response, 500, 'Internal server error.')
  }

  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}

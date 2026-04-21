import type { Response } from '@adonisjs/core/http'

export interface ApiErrorItem {
  field: string | null
  message: string
}

export interface ApiSuccessBody<T = unknown> {
  success: true
  message: string
  data: T
}

export interface ApiErrorBody {
  success: false
  message: string
  errors: ApiErrorItem[]
}

/**
 * Helpers to enforce the standard API response shape.
 *
 * Success: { success: true, message, data }
 * Error:   { success: false, message, errors: [{ field, message }] }
 */
export const ApiResponse = {
  ok<T>(response: Response, message: string, data: T = null as T) {
    return response.ok(<ApiSuccessBody<T>>{ success: true, message, data })
  },

  created<T>(response: Response, message: string, data: T = null as T) {
    return response.created(<ApiSuccessBody<T>>{ success: true, message, data })
  },

  error(response: Response, status: number, message: string, errors: ApiErrorItem[] = []) {
    return response.status(status).send(<ApiErrorBody>{
      success: false,
      message,
      errors,
    })
  },
}

import User from '#models/user'
import { HttpContext } from '@adonisjs/core/http'
import mail from '@adonisjs/mail/services/main'
import VerifyEmailNotification from '#mails/verify_email_notification'
import ForgotPasswordNotification from '#mails/forgot_password_notification'
import { DateTime } from 'luxon'
import { userRegistrationValidator } from '#validators/user_registration'
import { userLoginValidator } from '#validators/user_login'
import { forgotPasswordValidator } from '#validators/forgot_password'
import { resetPasswordValidator } from '#validators/reset_password'
import { verifyEmailValidator, resendOtpValidator } from '#validators/verify_email'
import { changePasswordValidator } from '#validators/change_password'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { randomBytes } from 'node:crypto'
import { ApiResponse } from '#utils/api_response'

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export default class AuthController {
  /**
   * @login
   * @operationId login
   * @description Authenticates a user and returns JWT access + refresh tokens.
   * @requestBody {"email": "string", "password": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"token": "string", "refreshToken": "string", "user": "User"}}
   * @responseBody 401 - {"success": false, "message": "Invalid credentials.", "errors": []}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async login({ request, response, auth }: HttpContext) {
    const { email, password } = await request.validateUsing(userLoginValidator)
    const user = await User.verifyCredentials(email, password)
    if (user.accountStatus === 'locked') {
      return ApiResponse.error(response, 403, 'Your account has been locked. Contact support.')
    }
    const tokens = await auth.use('jwt').generate(user)
    const refreshTokenRow = await User.refreshTokens.create(user)

    user.isOnline = true
    user.lastSeenAt = DateTime.now()
    await user.save()

    return ApiResponse.ok(response, 'Login successful.', {
      token: (tokens as any).token,
      refreshToken: refreshTokenRow.value!.release(),
      user: user.serialize(),
    })
  }

  /**
   * @logout
   * @operationId logout
   * @description Logs the authenticated user out and revokes all of their refresh tokens.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 401 - {"success": false, "message": "Unauthorized.", "errors": []}
   */
  public async logout({ response, auth }: HttpContext) {
    const user = auth.use('jwt').getUserOrFail()

    const all = await User.refreshTokens.all(user)
    for (const t of all) {
      await User.refreshTokens.delete(user, t.identifier)
    }

    user.isOnline = false
    user.lastSeenAt = DateTime.now()
    await user.save()

    return ApiResponse.ok(response, 'Logout successful.', {})
  }

  /**
   * @refresh
   * @operationId refreshToken
   * @description Issues a new JWT access + refresh token. Send the refresh token in the `Authorization: Bearer <refreshToken>` header.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"token": "string", "refreshToken": "string", "user": "User"}}
   * @responseBody 401 - {"success": false, "message": "Invalid refresh token.", "errors": []}
   */
  public async refresh({ response, auth }: HttpContext) {
    // The lib reads the refresh token from the Authorization header and rotates it.
    const user = await auth.use('jwt').authenticateWithRefreshToken()
    const tokens = await auth.use('jwt').generate(user)
    const newRefreshToken = (user as any).currentToken as string | undefined

    return ApiResponse.ok(response, 'Token refreshed.', {
      token: (tokens as any).token,
      refreshToken: newRefreshToken,
      user: user.serialize(),
    })
  }

  /**
   * @register
   * @operationId registerUser
   * @description Registers a new user and emails an OTP for verification.
   * @requestBody {"name": "string", "email": "string", "phone": "string", "password": "string", "password_confirmation": "string"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"user": "User"}}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async register({ request, response }: HttpContext) {
    const payload = await request.validateUsing(userRegistrationValidator)
    const otp = generateOtp()

    const user = await User.create({
      ...payload,
      verificationToken: otp,
    })

    await mail.send(new VerifyEmailNotification(user, otp))

    return ApiResponse.created(
      response,
      'Registration successful. Please check your email for the verification code.',
      { user: user.serialize() }
    )
  }

  /**
   * @verifyEmail
   * @operationId verifyEmail
   * @description Verifies a user's email address using an OTP code.
   * @requestBody {"email": "string", "otp": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 400 - {"success": false, "message": "Invalid OTP code.", "errors": []}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async verifyEmail({ request, response }: HttpContext) {
    const { email, otp } = await request.validateUsing(verifyEmailValidator)

    const user = await User.findBy('email', email)
    if (!user || !user.verificationToken || user.verificationToken !== otp) {
      return ApiResponse.error(response, 400, 'Invalid OTP code.')
    }
    if (user.verifiedAt) {
      return ApiResponse.error(response, 400, 'Email is already verified.')
    }

    user.verifiedAt = DateTime.now()
    user.verificationToken = undefined
    await user.save()

    return ApiResponse.ok(response, 'Email verified successfully.', null)
  }

  /**
   * @resendOtp
   * @operationId resendVerificationOtp
   * @description Re-sends the email verification OTP to the user.
   * @requestBody {"email": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async resendOtp({ request, response }: HttpContext) {
    const { email } = await request.validateUsing(resendOtpValidator)
    const user = await User.findBy('email', email)

    // Always succeed silently to avoid email enumeration.
    if (!user || user.verifiedAt) {
      return ApiResponse.ok(
        response,
        'If the email is registered and unverified, a new code has been sent.',
        null
      )
    }

    const otp = generateOtp()
    user.verificationToken = otp
    await user.save()
    await mail.send(new VerifyEmailNotification(user, otp))

    return ApiResponse.ok(
      response,
      'If the email is registered and unverified, a new code has been sent.',
      null
    )
  }

  /**
   * @forgotPassword
   * @operationId forgotPassword
   * @description Sends a password reset link/token to the user's email.
   * @requestBody {"email": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async forgotPassword({ request, response }: HttpContext) {
    const { email } = await request.validateUsing(forgotPasswordValidator)
    const user = await User.findBy('email', email)

    if (!user) {
      return ApiResponse.ok(
        response,
        'If your email is registered, you will receive a password reset link.',
        null
      )
    }

    const token = randomBytes(32).toString('hex')
    await db.table('password_reset_tokens').insert({
      email: user.email,
      token,
      created_at: DateTime.now().toISO(),
    })

    await mail.send(new ForgotPasswordNotification(user, token))

    return ApiResponse.ok(
      response,
      'If your email is registered, you will receive a password reset link.',
      null
    )
  }

  /**
   * @resetPassword
   * @operationId resetPassword
   * @description Resets the user's password using a valid reset token.
   * @requestBody {"token": "string", "password": "string", "password_confirmation": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 400 - {"success": false, "message": "Invalid or expired token.", "errors": []}
   */
  public async resetPassword({ request, response }: HttpContext) {
    const { token, password } = await request.validateUsing(resetPasswordValidator)

    const resetRequest = await db.from('password_reset_tokens').where('token', token).first()
    if (
      !resetRequest ||
      DateTime.fromISO(resetRequest.created_at).plus({ minutes: 60 }) < DateTime.now()
    ) {
      return ApiResponse.error(response, 400, 'Invalid or expired password reset token.')
    }

    const user = await User.findBy('email', resetRequest.email)
    if (!user) {
      return ApiResponse.error(response, 400, 'User not found.')
    }

    user.password = password
    await user.save()
    await db.from('password_reset_tokens').where('token', token).delete()

    return ApiResponse.ok(response, 'Password has been reset successfully.', null)
  }

  /**
   * @changePassword
   * @operationId changePassword
   * @description Changes the authenticated user's password (requires current password).
   * @requestBody {"current_password": "string", "password": "string", "password_confirmation": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 400 - {"success": false, "message": "Current password is incorrect.", "errors": []}
   */
  public async changePassword({ request, response, auth }: HttpContext) {
    const { current_password: currentPassword, password } =
      await request.validateUsing(changePasswordValidator)

    const user = auth.use('jwt').getUserOrFail()
    const valid = await hash.verify(user.password, currentPassword)
    if (!valid) {
      return ApiResponse.error(response, 400, 'Current password is incorrect.')
    }

    user.password = password
    await user.save()

    return ApiResponse.ok(response, 'Password changed successfully.', null)
  }
}

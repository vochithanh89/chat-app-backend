import User from '#models/user'
import DeviceToken from '#models/device_token'
import { HttpContext } from '@adonisjs/core/http'
import MailService from '#services/mail_service'
import { DateTime } from 'luxon'
import { userRegistrationValidator } from '#validators/user_registration'
import { userLoginValidator } from '#validators/user_login'
import { forgotPasswordValidator, verifyResetOtpValidator } from '#validators/forgot_password'
import { resetPasswordValidator } from '#validators/reset_password'
import { verifyEmailValidator, resendOtpValidator } from '#validators/verify_email'
import { changePasswordValidator } from '#validators/change_password'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { randomBytes } from 'node:crypto'
import { ApiResponse } from '#utils/api_response'
import realtimeService from '#services/realtime_service'

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
    const { email, identifier, password, device_type: deviceType } = await request.validateUsing(
      userLoginValidator
    )

    const loginIdentifier = (email || identifier || '').trim()
    if (!loginIdentifier) {
      return ApiResponse.error(response, 422, 'Email or identifier is required.')
    }

    let user
    const loginEmail = loginIdentifier.includes('@') ? loginIdentifier.toLowerCase() : undefined

    if (loginEmail) {
      try {
        user = await User.verifyCredentials(loginEmail, password)
      } catch {
        return ApiResponse.error(response, 401, 'Invalid credentials.')
      }
    } else {
      user = await User.query().where('phone', loginIdentifier).first()
      if (!user || !(await hash.verify(user.password, password))) {
        return ApiResponse.error(response, 401, 'Invalid credentials.')
      }
    }

    if (user.accountStatus === 'locked') {
      return ApiResponse.error(response, 403, 'tài khoản của bạn đã bị khóa, hãy liên hệ với hỗ trợ viên để được mở khóa. tài khoản hỗ trợ viên: chatappN7@support.com')
    }
    // Determine the device category for session management.
    // mobile_android and mobile_ios are both treated as 'mobile' — only 1 web + 1 mobile allowed.
    const deviceCategory = deviceType ? (deviceType === 'web' ? 'web' : 'mobile') : undefined

    // Revoke any existing refresh tokens for the same device category (single session per category)
    if (deviceCategory) {
      const allRefresh = await User.refreshTokens.all(user)
      for (const t of allRefresh) {
        const tokenName = (t as any).name as string | undefined
        const tokenCategory = tokenName ? (tokenName === 'web' ? 'web' : 'mobile') : undefined
        if (tokenCategory === deviceCategory) {
          await User.refreshTokens.delete(user, (t as any).identifier)
        }
      }
    }

    const tokens = await auth.use('jwt').generate(user)
    // Create refresh token and tag it with device type (if provided)
    const refreshTokenRow = await User.refreshTokens.create(user, { name: deviceType } as any)

    user.isOnline = true
    user.lastSeenAt = DateTime.now()
    await user.save()

    // Notify only sessions of the SAME device category that they are being replaced.
    // This allows 1 web + 1 mobile session to coexist (max 2 different device types).
    if (deviceCategory) {
      // Emit to all mobile sub-types when a mobile device logs in
      if (deviceCategory === 'mobile') {
        realtimeService.emitToUserDeviceType(user.id, 'mobile_android', 'auth:session_replaced', {
          device_type: deviceType,
          message: 'Tài khoản của bạn đã đăng nhập ở thiết bị di động khác. Bạn sẽ bị đăng xuất.',
        })
        realtimeService.emitToUserDeviceType(user.id, 'mobile_ios', 'auth:session_replaced', {
          device_type: deviceType,
          message: 'Tài khoản của bạn đã đăng nhập ở thiết bị di động khác. Bạn sẽ bị đăng xuất.',
        })
      } else {
        realtimeService.emitToUserDeviceType(user.id, deviceCategory, 'auth:session_replaced', {
          device_type: deviceType,
          message: 'Tài khoản của bạn đã đăng nhập ở thiết bị web khác. Bạn sẽ bị đăng xuất.',
        })
      }
    }

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
    if (user.accountStatus === 'locked') {
      return ApiResponse.error(response, 403, 'tài khoản của bạn đã bị khóa, hãy liên hệ với hỗ trợ viên để được mở khóa. tài khoản hỗ trợ viên: chatappN7@support.com')
    }
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

    const userPayload: any = {
      ...payload,
      verificationToken: otp,
    }
    // Record accepted terms timestamp when explicitly accepted
    if ((payload as any).accepted_terms) {
      userPayload.acceptedTermsAt = DateTime.now()
    }

    // Remove non-model properties before DB insertion
    delete userPayload.accepted_terms

    const user = await User.create(userPayload)

    // If registration comes from mobile with a device token, store it
    if (payload.device_token && payload.device_platform) {
      try {
        await DeviceToken.create({
          userId: user.id,
          token: payload.device_token,
          platform: payload.device_platform,
        })
      } catch (e) {
        // ignore duplicate device tokens or other device token errors
      }
    }

    await MailService.sendOTP(user.email, otp)

    return ApiResponse.created(
      response,
      'Registration successful. Please check your email for the verification code.',
      { user: user.serialize() }
    )
  }

  /**
   * Generate a short-lived QR token for web login. Stored server-side and
   * scanned by a mobile client to authenticate the web session.
   */
  public async generateQr({ response }: HttpContext) {
    const qrToken = randomBytes(16).toString('hex')
    const expiresAt = DateTime.now().plus({ minutes: 3 })

    await db.table('qr_tokens').insert({
      token: qrToken,
      created_at: DateTime.now().toISO(),
      expires_at: expiresAt.toISO(),
    })

    return ApiResponse.ok(response, 'QR token generated.', {
      qr_token: qrToken,
      expires_at: expiresAt.toISO(),
    })
  }

  /**
   * Mobile app (authenticated) scans the QR and links the qr_token to the
   * currently authenticated user. The web client will poll status to obtain
   * an access token once the QR has been scanned.
   */
  public async scanQr({ request, response, auth }: HttpContext) {
    const qrToken = request.input('qr_token')
    if (!qrToken) return ApiResponse.error(response, 422, 'qr_token is required.')

    const user = auth.use('jwt').getUserOrFail()
    const record = await db.from('qr_tokens').where('token', qrToken).first()
    if (!record) return ApiResponse.error(response, 404, 'QR token not found or expired.')

    if (DateTime.fromISO(record.expires_at) < DateTime.now()) {
      await db.from('qr_tokens').where('token', qrToken).delete()
      return ApiResponse.error(response, 400, 'QR token expired.')
    }

    await db.from('qr_tokens').where('token', qrToken).update({
      user_id: user.id,
      scanned_at: DateTime.now().toISO(),
    })

    return ApiResponse.ok(response, 'QR scanned and linked to your account.', null)
  }

  /**
   * Web client polls to check if QR was scanned. When scanned, issue tokens
   * for the linked user and delete the QR record.
   */
  public async qrStatus({ request, response, auth }: HttpContext) {
    const qrToken = request.input('qr_token')
    if (!qrToken) return ApiResponse.error(response, 422, 'qr_token is required.')

    const record = await db.from('qr_tokens').where('token', qrToken).first()
    if (!record) return ApiResponse.error(response, 404, 'QR token not found.')

    if (DateTime.fromISO(record.expires_at) < DateTime.now()) {
      await db.from('qr_tokens').where('token', qrToken).delete()
      return ApiResponse.error(response, 400, 'QR token expired.')
    }

    if (!record.user_id) {
      return ApiResponse.ok(response, 'Waiting for QR scan.', { status: 'pending' })
    }

    const user = await User.find(record.user_id)
    if (!user) return ApiResponse.error(response, 404, 'User not found.')

    // Issue tokens for the user (device type = web)
    // Revoke existing web refresh tokens (single session per device category)
    const allRefresh = await User.refreshTokens.all(user)
    for (const t of allRefresh) {
      const tokenName = (t as any).name as string | undefined
      if (tokenName === 'web') {
        await User.refreshTokens.delete(user, (t as any).identifier)
      }
    }

    const tokens = await auth.use('jwt').generate(user)
    const refreshTokenRow = await User.refreshTokens.create(user, { name: 'web' } as any)

    // Notify existing web sessions that they are being replaced
    realtimeService.emitToUserDeviceType(user.id, 'web', 'auth:session_replaced', {
      device_type: 'web',
      message: 'Tài khoản của bạn đã đăng nhập ở thiết bị web khác qua mã QR. Bạn sẽ bị đăng xuất.',
    })

    // Remove the QR record once consumed
    await db.from('qr_tokens').where('token', qrToken).delete()

    return ApiResponse.ok(response, 'QR authenticated.', {
      token: (tokens as any).token,
      refreshToken: refreshTokenRow.value!.release(),
      user: user.serialize(),
    })
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
    await MailService.sendOTP(user.email, otp)

    return ApiResponse.ok(
      response,
      'If the email is registered and unverified, a new code has been sent.',
      null
    )
  }

  /**
   * @forgotPassword
   * @operationId forgotPassword
   * @description Sends a password reset OTP to the user's email via SMTP.
   * @requestBody {"email": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async forgotPassword({ request, response }: HttpContext) {
    const { email } = await request.validateUsing(forgotPasswordValidator)
    const user = await User.findBy('email', email)

    if (!user) {
      return ApiResponse.ok(
        response,
        'Nếu email của bạn tồn tại trên hệ thống, một mã OTP xác thực sẽ được gửi đến hộp thư.',
        null
      )
    }

    const otp = generateOtp()

    // Delete existing reset tokens/OTPs for this email to avoid duplicates
    await db.from('password_reset_tokens').where('email', user.email).delete()

    await db.table('password_reset_tokens').insert({
      email: user.email,
      token: otp,
      created_at: DateTime.now().toISO(),
    })

    await MailService.sendForgotPasswordOTP(user.email, otp)

    return ApiResponse.ok(
      response,
      'Nếu email của bạn tồn tại trên hệ thống, một mã OTP xác thực sẽ được gửi đến hộp thư.',
      null
    )
  }

  /**
   * @verifyResetOtp
   * @operationId verifyResetOtp
   * @description Verifies the password reset OTP and generates a secure reset token.
   * @requestBody {"email": "string", "otp": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"token": "string"}}
   * @responseBody 400 - {"success": false, "message": "string", "errors": []}
   */
  public async verifyResetOtp({ request, response }: HttpContext) {
    const { email, otp } = await request.validateUsing(verifyResetOtpValidator)

    const resetRequest = await db
      .from('password_reset_tokens')
      .where('email', email)
      .where('token', otp)
      .first()

    if (
      !resetRequest ||
      DateTime.fromISO(resetRequest.created_at).plus({ minutes: 5 }) < DateTime.now()
    ) {
      return ApiResponse.error(response, 400, 'Mã xác thực OTP không hợp lệ hoặc đã hết hạn.')
    }

    // OTP is valid! Delete it and generate a secure long-lived token (60 mins) for resetting the password
    await db.from('password_reset_tokens').where('email', email).delete()

    const secureToken = randomBytes(32).toString('hex')
    await db.table('password_reset_tokens').insert({
      email,
      token: secureToken,
      created_at: DateTime.now().toISO(),
    })

    return ApiResponse.ok(response, 'Xác thực mã OTP thành công.', { token: secureToken })
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

    // Revoke all refresh tokens — force logout on all devices
    const allTokens = await User.refreshTokens.all(user)
    for (const t of allTokens) {
      await User.refreshTokens.delete(user, (t as any).identifier)
    }

    // Notify clients that they must re-authenticate
    realtimeService.emitToUser(user.id, 'auth:force_logout', {
      message: 'Mật khẩu đã được thay đổi. Vui lòng đăng nhập lại.',
    })

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
    const {
      current_password: currentPassword,
      password,
      device_type: deviceType,
    } = await request.validateUsing(changePasswordValidator)

    const user = auth.use('jwt').getUserOrFail()
    const valid = await hash.verify(user.password, currentPassword)
    if (!valid) {
      return ApiResponse.error(response, 400, 'Current password is incorrect.')
    }

    user.password = password
    await user.save()

    const deviceCategory = deviceType ? (deviceType === 'web' ? 'web' : 'mobile') : undefined

    const allTokens = await User.refreshTokens.all(user)

    for (const t of allTokens) {
      const tokenName = (t as any).name as string | undefined
      const tokenCategory = tokenName ? (tokenName === 'web' ? 'web' : 'mobile') : undefined

      // If deviceCategory is provided, keep the token for the current category.
      // Otherwise, revoke all tokens.
      if (!deviceCategory || tokenCategory !== deviceCategory) {
        await User.refreshTokens.delete(user, (t as any).identifier)
      }
    }

    if (deviceCategory === 'web') {
      // Current device is web, logout mobile
      realtimeService.emitToUserDeviceType(user.id, 'mobile_android', 'auth:force_logout', {
        message: 'Mật khẩu đã được thay đổi ở thiết bị khác. Vui lòng đăng nhập lại.',
      })
      realtimeService.emitToUserDeviceType(user.id, 'mobile_ios', 'auth:force_logout', {
        message: 'Mật khẩu đã được thay đổi ở thiết bị khác. Vui lòng đăng nhập lại.',
      })
    } else if (deviceCategory === 'mobile') {
      // Current device is mobile, logout web
      realtimeService.emitToUserDeviceType(user.id, 'web', 'auth:force_logout', {
        message: 'Mật khẩu đã được thay đổi ở thiết bị khác. Vui lòng đăng nhập lại.',
      })
    } else {
      // No device category provided, logout all
      realtimeService.emitToUser(user.id, 'auth:force_logout', {
        message: 'Mật khẩu đã được thay đổi. Vui lòng đăng nhập lại.',
      })
    }

    return ApiResponse.ok(response, 'Password changed successfully.', null)
  }
}

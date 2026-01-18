import User from '#models/user'
import { BaseMail } from '@adonisjs/mail'

export default class ForgotPasswordNotification extends BaseMail {
  constructor(
    private user: User,
    private token: string
  ) {
    super()
  }

  from = 'info@example.com'
  subject = 'Reset Your Password'

  /**
   * The "prepare" method is called automatically when
   * the email is sent or queued.
   */
  prepare() {
    // Frontend URL, adjust as needed
    const resetUrl = `http://localhost:3000/reset-password?token=${this.token}`

    this.message.to(this.user.email).html(`
      <h1>Password Reset Request</h1>
      <p>You are receiving this email because we received a password reset request for your account.</p>
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>This password reset link will expire in 60 minutes.</p>
      <p>If you did not request a password reset, no further action is required.</p>
    `)
  }
}
import User from '#models/user'
import { BaseMail } from '@adonisjs/mail'

export default class VerifyEmailNotification extends BaseMail {
  constructor(
    private user: User,
    private otp: string
  ) {
    super()
  }

  from = 'info@example.com'
  subject = 'Verify Your Email Address'

  /**
   * The "prepare" method is called automatically when
   * the email is sent or queued.
   */
  prepare() {
    this.message.to(this.user.email).html(`
      <h1>Welcome to Our Application!</h1>
      <p>Your email verification code is:</p>
      <h2>${this.otp}</h2>
      <p>This code will expire in 10 minutes.</p>
    `)
  }
}

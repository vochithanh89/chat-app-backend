import User from '#models/user'
import { BaseMail } from '@adonisjs/mail'

export default class VerifyEmailNotification extends BaseMail {
  constructor(
    private user: User,
    private token: string
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
    const verificationUrl = `http://localhost:3333/verify-email?token=${this.token}`

    this.message.to(this.user.email).html(`
      <h1>Welcome to Our Application!</h1>
      <p>Please click the link below to verify your email address:</p>
      <a href="${verificationUrl}">Verify Email</a>
    `)
  }
}
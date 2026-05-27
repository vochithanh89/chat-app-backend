import mail from '@adonisjs/mail/services/main'
import env from '#start/env'

const SMTP_HOST = env.get('SMTP_HOST')
const SMTP_USERNAME = env.get('SMTP_USERNAME')

const BREVO_API_KEY = env.get('BREVO_API_KEY') || ''
const BREVO_SENDER_EMAIL = env.get('BREVO_SENDER_EMAIL') || SMTP_USERNAME || 'lenqvinh3010@gmail.com'
const BREVO_SENDER_NAME = env.get('BREVO_SENDER_NAME') || 'ChatApp Support'

class MailService {
  private async sendViaBrevo(email: string, subject: string, htmlContent: string) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            name: BREVO_SENDER_NAME,
            email: BREVO_SENDER_EMAIL,
          },
          to: [
            {
              email: email,
            },
          ],
          subject: subject,
          htmlContent: htmlContent,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Brevo API responded with status ${response.status}: ${errText}`)
      }

      // eslint-disable-next-line no-console
      console.log(`[MailService] Email sent successfully to ${email} via Brevo HTTP API`)
      return true
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[MailService] sendViaBrevo failed', error)
      return false
    }
  }

  async sendOTP(email: string, otp: string) {
    // eslint-disable-next-line no-console
    console.info(`[MailService] OTP code for ${email} is: ${otp}`)

    // 1. If Brevo API is configured, use it (recommended for Render Free Tier)
    if (BREVO_API_KEY) {
      await this.sendViaBrevo(
        email,
        'Xác thực tài khoản ChatApp',
        `
          <h2>Mã xác thực của bạn</h2>
          <h1>${otp}</h1>
          <p>Mã có hiệu lực trong 5 phút</p>
        `
      )
      return
    }

    // 2. If SMTP is configured, use it (recommended for local environment)
    if (SMTP_HOST && SMTP_USERNAME) {
      try {
        await mail.send((message) => {
          message
            .to(email)
            .from(SMTP_USERNAME)
            .subject('Xác thực tài khoản ChatApp')
            .html(`
              <h2>Mã xác thực của bạn</h2>
              <h1>${otp}</h1>
              <p>Mã có hiệu lực trong 5 phút</p>
            `)
        })
        // eslint-disable-next-line no-console
        console.log(`[MailService] OTP sent successfully to ${email} via SMTP`)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[MailService] sendOTP via SMTP failed', error)
      }
      return
    }
  }

  async sendForgotPasswordOTP(email: string, otp: string) {
    // eslint-disable-next-line no-console
    console.info(`[MailService] Forgot Password OTP code for ${email} is: ${otp}`)

    // 1. If Brevo API is configured, use it (recommended for Render Free Tier)
    if (BREVO_API_KEY) {
      await this.sendViaBrevo(
        email,
        'Yêu cầu đặt lại mật khẩu - ChatApp',
        `
          <h2>Mã xác thực đặt lại mật khẩu của bạn</h2>
          <h1>${otp}</h1>
          <p>Mã này có hiệu lực trong 5 phút.</p>
          <p>Vui lòng không chia sẻ mã này với bất kỳ ai.</p>
        `
      )
      return
    }

    // 2. If SMTP is configured, use it (recommended for local environment)
    if (SMTP_HOST && SMTP_USERNAME) {
      try {
        await mail.send((message) => {
          message
            .to(email)
            .from(SMTP_USERNAME)
            .subject('Yêu cầu đặt lại mật khẩu - ChatApp')
            .html(`
              <h2>Mã xác thực đặt lại mật khẩu của bạn</h2>
              <h1>${otp}</h1>
              <p>Mã này có hiệu lực trong 5 phút.</p>
              <p>Vui lòng không chia sẻ mã này với bất kỳ ai.</p>
            `)
        })
        // eslint-disable-next-line no-console
        console.log(`[MailService] Forgot Password OTP sent successfully to ${email} via SMTP`)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[MailService] sendForgotPasswordOTP via SMTP failed', error)
      }
      return
    }
  }
}

export default new MailService()

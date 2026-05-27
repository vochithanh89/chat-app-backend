import mail from '@adonisjs/mail/services/main'
import env from '#start/env'

const SMTP_HOST = env.get('SMTP_HOST')
const SMTP_USERNAME = env.get('SMTP_USERNAME')

class MailService {
  async sendOTP(email: string, otp: string) {
    if (!SMTP_HOST || !SMTP_USERNAME) {
      // eslint-disable-next-line no-console
      console.info(`[MailService] Fallback OTP for ${email}: ${otp}`)
      return
    }

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
      console.error('[MailService] sendOTP failed', error)
    }
  }

  async sendForgotPasswordOTP(email: string, otp: string) {
    if (!SMTP_HOST || !SMTP_USERNAME) {
      // eslint-disable-next-line no-console
      console.info(`[MailService] Fallback Forgot Password OTP for ${email}: ${otp}`)
      return
    }

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
      console.error('[MailService] sendForgotPasswordOTP failed', error)
    }
  }
}

export default new MailService()

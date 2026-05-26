import { Resend } from 'resend'
import env from '#start/env'

const RESEND_API_KEY = env.get('RESEND_API_KEY') || ''
const RESEND_FROM = env.get('RESEND_FROM') || 'onboarding@resend.dev'
let resend: Resend | null = null
if (RESEND_API_KEY) {
  try {
    resend = new Resend(RESEND_API_KEY)
  } catch (e) {
    // If Resend initialization fails, keep resend null and fallback to logging
    // eslint-disable-next-line no-console
    console.warn('Resend client initialization failed, falling back to log-only mailer', e)
    resend = null
  }
}

class MailService {
  async sendOTP(email: string, otp: string) {
    // If Resend is not configured, fallback to logging the OTP to console
    if (!resend) {
      // eslint-disable-next-line no-console
      console.info(`[MailService] OTP for ${email}: ${otp}`)
      return
    }

    try {
      const result = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: 'Xác thực tài khoản ChatApp',
        html: `
          <h2>Mã xác thực của bạn</h2>
          <h1>${otp}</h1>
          <p>Mã có hiệu lực trong 5 phút</p>
        `,
      })

      // eslint-disable-next-line no-console
      console.log(result)
    } catch (error) {
      // Log the error but do not throw — registration/resend flows should not fail because of email delivery issues
      // Provide actionable hint when Resend returns a validation error about sender/recipient
      // eslint-disable-next-line no-console
      console.error('[MailService] sendOTP failed', error)
      if (error && (error as any).data && (error as any).data.error && (error as any).data.error.message) {
        // eslint-disable-next-line no-console
        console.error('[MailService] Resend error message:', (error as any).data.error.message)
      }
    }
  }

  async sendPasswordReset(email: string, token: string) {
    if (!resend) {
      const resetUrl = `${env.get('FRONTEND_URL')}/reset-password?token=${token}`
      // eslint-disable-next-line no-console
      console.info(`[MailService] Password reset for ${email}: ${token} (link: ${resetUrl})`)
      return
    }

    try {
      const resetUrl = `${env.get('FRONTEND_URL')}/reset-password?token=${token}`
      const result = await resend.emails.send({
        from: RESEND_FROM,
        to: email,
        subject: 'Yêu cầu đặt lại mật khẩu - ChatApp',
        html: `
          <h1>Đặt lại mật khẩu</h1>
          <p>Nhấn vào liên kết bên dưới để đặt lại mật khẩu của bạn:</p>
          <a href="${resetUrl}">Đặt lại mật khẩu</a>
          <p>Liên kết này có hiệu lực trong 60 phút.</p>
        `,
      })

      // eslint-disable-next-line no-console
      console.log(result)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[MailService] sendPasswordReset failed', error)
      if (error && (error as any).data && (error as any).data.error && (error as any).data.error.message) {
        // eslint-disable-next-line no-console
        console.error('[MailService] Resend error message:', (error as any).data.error.message)
      }
    }
  }
}

export default new MailService()

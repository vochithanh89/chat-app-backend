import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'

const mailConfig = defineConfig({
  default: 'smtp',

  from: {
    address: 'onboarding@resend.dev', // 🌟 BẮT BUỘC phải điền chính xác chữ này
    name: 'Chat App', // Tên hiển thị khi người dùng nhận được mail (bạn đặt tùy ý)
  },
  /**
   * The mailers object can be used to configure multiple mailers
   * each using a different transport or same transport with different
   * options.
   */
  mailers: {
    smtp: transports.smtp({
      host: env.get('SMTP_HOST'),
      port: env.get('SMTP_PORT'),
      secure: true,
      auth: {
        type: 'login',
        user: env.get('SMTP_USERNAME'),
        pass: env.get('SMTP_PASSWORD'),
      },
      tls: {
        rejectUnauthorized: false,
      },
    }),

    // mailgun: transports.mailgun({
    //     key: env.get('MAILGUN_API_KEY'),
    //     baseUrl: 'https://api.mailgun.net/v3',
    //     domain: env.get('MAILGUN_DOMAIN'),
    // }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}

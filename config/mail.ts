import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'

const mailConfig = defineConfig({
  default: 'smtp',

  /**
   * The mailers object can be used to configure multiple mailers
   * with different drivers and configurations.
   */
  mailers: {
    smtp: transports.smtp({
      host: env.get('SMTP_HOST') || '',
      port: env.get('SMTP_PORT') || '',
      auth: {
        type: 'login',
        user: env.get('SMTP_USERNAME') || '',
        pass: env.get('SMTP_PASSWORD') || '',
      },
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}

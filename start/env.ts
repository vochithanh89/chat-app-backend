/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  FRONTEND_URL: Env.schema.string(),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  JWT_SECRET: Env.schema.string.optional(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the mail package
  |----------------------------------------------------------
  */
  // SMTP config is optional. We use a MailService abstraction (Resend or other)
  // and allow deployments without SMTP credentials.
  SMTP_HOST: Env.schema.string.optional(),
  SMTP_PORT: Env.schema.string.optional(),
  SMTP_USERNAME: Env.schema.string.optional(),
  SMTP_PASSWORD: Env.schema.string.optional(),
  // MAILGUN_API_KEY: Env.schema.string(),
  // MAILGUN_DOMAIN: Env.schema.string()
  RESEND_API_KEY: Env.schema.string.optional(),
  RESEND_FROM: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Firebase Cloud Messaging (push notifications)
  |----------------------------------------------------------
  | Leave empty to disable FCM — NotificationService will fall
  | back to logging payloads instead of sending real pushes.
  | FIREBASE_PRIVATE_KEY: paste the full PEM, escape newlines as \n.
  */
  FIREBASE_PROJECT_ID: Env.schema.string.optional(),
  FIREBASE_CLIENT_EMAIL: Env.schema.string.optional(),
  FIREBASE_PRIVATE_KEY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | AI Chatbot (Google Gemini)
  |----------------------------------------------------------
  | Leave empty to disable AI chat — endpoint will return 503.
  */
  GEMINI_API_KEY: Env.schema.string.optional(),
  GEMINI_MODEL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | AWS S3 Upload Config
  |----------------------------------------------------------
  */
  S3_BUCKET_NAME: Env.schema.string.optional(),
  S3_REGION: Env.schema.string.optional(),
  S3_ACCESS_KEY_ID: Env.schema.string.optional(),
  S3_SECRET_ACCESS_KEY: Env.schema.string.optional(),
})

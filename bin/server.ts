/*
|--------------------------------------------------------------------------
| HTTP server entrypoint
|--------------------------------------------------------------------------
|
| The "server.ts" file is the entrypoint for starting the AdonisJS HTTP
| server. Either you can run this file directly or use the "serve"
| command to run this file and monitor file changes
|
*/

import 'reflect-metadata'
import { Ignitor, prettyPrintError } from '@adonisjs/core'

/**
 * URL to the application root. AdonisJS need it to resolve
 * paths to file and directories for scaffolding commands
 */
const APP_ROOT = new URL('../', import.meta.url)

/**
 * The importer is used to import files in context of the
 * application.
 */
const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

new Ignitor(APP_ROOT, { importer: IMPORTER })
  .tap((app) => {
    app.booting(async () => {
      // Force read GEMINI env from .env file to override OS environment variables
      try {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const fileURLToPath = (await import('node:url')).fileURLToPath
        const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env')
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf-8')
          for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (trimmed.startsWith('GEMINI_API_KEY=') || trimmed.startsWith('GEMINI_MODEL=')) {
              const [key, ...valueParts] = trimmed.split('=')
              const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '')
              process.env[key] = value
            }
          }
        }
      } catch (e) {
        // Ignore errors
      }
      await import('#start/env')
    })
    app.listen('SIGTERM', () => app.terminate())
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate())
  })
  .httpServer()
  .start()
  .catch((error) => {
    process.exitCode = 1
    prettyPrintError(error)
  })

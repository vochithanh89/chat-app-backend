import { defineConfig } from '@adonisjs/cors'

/**
 * Configuration options to tweak the CORS policy. The following
 * options are documented on the official documentation website.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const corsConfig = defineConfig({
  enabled: true,
  origin: [
    'http://localhost:5173', // Port mặc định khi chạy dưới máy local
    'https://chat-app-web-frontend-ten.vercel.app', // Vercel frontend
    'https://storied-churros-be1dd4.netlify.app', // Netlify frontend
  ],
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
  headers: true,
  exposeHeaders: [],
  credentials: true,
  maxAge: 90,
})

export default corsConfig

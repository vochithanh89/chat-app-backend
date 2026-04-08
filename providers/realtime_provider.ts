import type { ApplicationService } from '@adonisjs/core/types'
import server from '@adonisjs/core/services/server'
import realtime from '#services/realtime_service'

export default class RealtimeProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    if (this.app.getEnvironment() !== 'web') return
    const httpServer = server.getNodeServer()
    if (httpServer) realtime.attach(httpServer)
  }
}

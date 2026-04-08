import { Server as IOServer, Socket } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'
import jwt from 'jsonwebtoken'
import env from '#start/env'
import ConversationMember from '#models/conversation_member'

interface AuthedSocket extends Socket {
  data: { userId: number }
}

/**
 * Socket.IO bootstrap.
 *
 * `attach()` is called once from the provider after the AdonisJS HTTP
 * server is ready. Sockets authenticate via JWT in the handshake auth
 * payload, then auto-join personal + conversation rooms.
 */
class RealtimeService {
  private io: IOServer | null = null

  attach(httpServer: HttpServer): void {
    if (this.io) return
    this.io = new IOServer(httpServer, {
      cors: { origin: '*' },
      path: '/socket.io',
    })

    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ??
          (socket.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
        if (!token) return next(new Error('Missing token'))

        const secret = env.get('JWT_SECRET') || env.get('APP_KEY')
        const payload = jwt.verify(token, secret) as any
        const userId = Number(payload?.userId ?? payload?.sub ?? payload?.id)
        if (!userId) return next(new Error('Invalid token payload'))

        ;(socket as AuthedSocket).data.userId = userId
        next()
      } catch (err) {
        next(new Error('Unauthorized'))
      }
    })

    this.io.on('connection', async (socket) => {
      const userId = (socket as AuthedSocket).data.userId
      logger.info({ userId, socketId: socket.id }, 'socket connected')

      socket.join(`user:${userId}`)
      const memberships = await ConversationMember.query().where('user_id', userId)
      for (const m of memberships) socket.join(`conv:${m.conversationId}`)

      socket.on('conversation:join', (conversationId: number) => {
        socket.join(`conv:${conversationId}`)
      })
      socket.on('conversation:leave', (conversationId: number) => {
        socket.leave(`conv:${conversationId}`)
      })

      socket.on('disconnect', () => {
        logger.info({ userId, socketId: socket.id }, 'socket disconnected')
      })
    })

    logger.info('Socket.IO attached at /socket.io')
  }

  emitToConversation(conversationId: number, event: string, payload: unknown): void {
    if (!this.io) return
    this.io.to(`conv:${conversationId}`).emit(event, payload)
  }

  emitToUser(userId: number, event: string, payload: unknown): void {
    if (!this.io) return
    this.io.to(`user:${userId}`).emit(event, payload)
  }
}

export default new RealtimeService()

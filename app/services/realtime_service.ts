import { Server as IOServer, Socket } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'
import jwt from 'jsonwebtoken'
import { DateTime } from 'luxon'
import env from '#start/env'
import Conversation from '#models/conversation'
import ConversationMember from '#models/conversation_member'
import User from '#models/user'

interface AuthedSocket extends Socket {
  data: {
    userId: number
    userUuid?: string
    /** Device type: 'web' | 'mobile' — sent by the client in handshake auth */
    deviceType?: string
    /** Map public conversation UUID → internal numeric id. Populated
     *  on connect so transient events like typing indicators can
     *  resolve the target room without hitting the DB. */
    convUuidToId?: Record<string, number>
  }
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
  /** userId → count of currently open sockets for that user. */
  private connections = new Map<number, number>()

  attach(httpServer: HttpServer): void {
    if (this.io) return
    this.io = new IOServer(httpServer, {
      cors: { origin: '*' },
      path: '/socket.io',
      pingInterval: 10_000,
      pingTimeout: 5_000,
    })

    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ??
          (socket.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
          
        if (!token) {
          (socket as AuthedSocket).data = { userId: 0 }
          return next()
        }

        const secret = env.get('JWT_SECRET') || env.get('APP_KEY')
        const payload = jwt.verify(token, secret) as any
        const userId = Number(payload?.userId ?? payload?.sub ?? payload?.id)
        if (!userId) {
          (socket as AuthedSocket).data = { userId: 0 }
          return next()
        }
        ;(socket as AuthedSocket).data = { userId }
        // Capture device type from handshake auth (sent by client)
        ;(socket as AuthedSocket).data.deviceType = socket.handshake.auth?.device_type || undefined
        next()
      } catch (err) {
        // If token fails verification, allow connection but mark unauthenticated
        (socket as AuthedSocket).data = { userId: 0 }
        next()
      }
    })

    this.io.on('connection', async (socket) => {
      const authedSocket = socket as AuthedSocket
      const userId = authedSocket.data?.userId

      // Both authenticated and unauthenticated sockets can join QR rooms
      socket.on('qr:join', (sessionId: string) => {
        socket.join(`qr:${sessionId}`)
      })

      if (!userId) {
        logger.info({ socketId: socket.id }, 'unauthenticated socket connected')
        return
      }

      logger.info({ userId, socketId: socket.id }, 'socket connected')

      socket.on('disconnect', (reason) => {
        logger.info({ userId, socketId: socket.id, reason }, 'socket disconnected')
        // Note: We don't broadcast a `group-call:leave` here because abrupt
        // disconnects should be handled by the client-side WebRTC connection
        // state listeners (`onconnectionstatechange`). This backend event
        // is for explicit "leave" button clicks.

        const current = this.connections.get(userId) ?? 0
        const next = Math.max(0, current - 1)
        if (next === 0) {
          this.connections.delete(userId)
          void this.markOnline(userId, false)
        } else {
          this.connections.set(userId, next)
        }
      })

      const prevCount = this.connections.get(userId) ?? 0
      this.connections.set(userId, prevCount + 1)
      if (prevCount === 0) {
        void this.markOnline(userId, true)
      }

      // Tag this socket with a device-type room so we can target events
      // to only web or only mobile sockets of a given user.
      const deviceType = authedSocket.data.deviceType
      if (deviceType) {
        socket.join(`user:${userId}:${deviceType}`)
      }

      socket.on('conversation:join', (conversationId: number) => {
        socket.join(`conv:${conversationId}`)
      })
      socket.on('conversation:leave', (conversationId: number) => {
        socket.leave(`conv:${conversationId}`)
      })

      socket.on('typing:start', (data: { conversationId?: string }) => {
        const convUuid = data?.conversationId
        if (!convUuid) return
        const internalId = authedSocket.data.convUuidToId?.[convUuid]
        if (!internalId) return
        socket.to(`conv:${internalId}`).emit('typing:start', {
          conversationId: convUuid,
          userId: authedSocket.data.userUuid,
        })
      })
      socket.on('typing:stop', (data: { conversationId?: string }) => {
        const convUuid = data?.conversationId
        if (!convUuid) return
        const internalId = authedSocket.data.convUuidToId?.[convUuid]
        if (!internalId) return
        socket.to(`conv:${internalId}`).emit('typing:stop', {
          conversationId: convUuid,
          userId: authedSocket.data.userUuid,
        })
      })

      // --- 1-on-1 WebRTC signaling ---
      socket.on('call:request', (payload) => {
        this.emitToUser(payload.to, 'call:incoming', {
          from: authedSocket.data.userUuid,
          ...payload,
        })
      })
      socket.on('call:answer', (payload) => {
        this.emitToUser(payload.to, 'call:accepted', {
          from: authedSocket.data.userUuid,
          ...payload,
        })
      })
      socket.on('call:ice-candidate', (payload) => {
        this.emitToUser(payload.to, 'call:ice-candidate', {
          from: authedSocket.data.userUuid,
          ...payload,
        })
      })
      socket.on('call:reject', (payload) => {
        this.emitToUser(payload.to, 'call:reject', {
          from: authedSocket.data.userUuid,
          ...payload,
        })
      })
      socket.on('call:hangup', (payload) => {
        this.emitToUser(payload.to, 'call:hangup', {
          from: authedSocket.data.userUuid,
          ...payload,
        })
      })

      // --- Group Call Signaling (Broadcast Relay) ---
      const groupCallRelay = (eventName: string) => (payload: { conversationId: string }) => {
        const { conversationId } = payload
        const internalId = authedSocket.data.convUuidToId?.[conversationId]
        if (!internalId) {
          logger.warn({ payload }, `group-call relay: invalid conversationId`)
          return
        }
        // Broadcast to all OTHER members in the room.
        // The frontend will handle signal targeting.
        socket.to(`conv:${internalId}`).emit(eventName, {
          from: authedSocket.data.userUuid,
          ...payload,
        })
      }

      socket.on('group-call:ring', groupCallRelay('group-call:ring'))
      socket.on('group-call:join', groupCallRelay('group-call:join'))
      socket.on('group-call:signal', groupCallRelay('group-call:signal'))
      socket.on('group-call:leave', groupCallRelay('group-call:leave'))
      socket.on('call:camera-toggle', groupCallRelay('call:camera-toggle'))

      // --- Room Setup ---
      socket.join(`user:${userId}`)
      try {
        const user = await User.find(userId)
        if (user?.uuid) {
          authedSocket.data.userUuid = user.uuid
          socket.join(`user:${user.uuid}`)
        }

        const memberships = await ConversationMember.query()
          .where('user_id', userId)
          .preload('conversation', (q) => q.select('id', 'uuid'))

        const convMap: Record<string, number> = {}
        for (const m of memberships) {
          socket.join(`conv:${m.conversationId}`)
          if (m.conversation?.uuid) convMap[m.conversation.uuid] = m.conversationId
        }
        authedSocket.data.convUuidToId = convMap
      } catch (err) {
        logger.warn({ err, userId }, 'failed to load memberships on connect')
      }
    })

    logger.info('Socket.IO attached at /socket.io')
  }

  emitToConversation(conversationId: number, event: string, payload: unknown): void {
    if (!this.io) return
    this.io.to(`conv:${conversationId}`).emit(event, payload)
  }

  emitToUser(userId: number | string, event: string, payload: unknown): void {
    if (!this.io) return
    this.io.to(`user:${userId}`).emit(event, payload)
  }

  /**
   * Emit an event to only sockets of a specific device type for a user.
   * deviceType should be 'web' or 'mobile'.
   */
  emitToUserDeviceType(userId: number, deviceType: string, event: string, payload: unknown): void {
    if (!this.io) return
    this.io.to(`user:${userId}:${deviceType}`).emit(event, payload)
  }

  async joinUserToConversation(userId: number, conversation: Conversation): Promise<void> {
    if (!this.io) return
    try {
      const sockets = await this.io.in(`user:${userId}`).fetchSockets()
      for (const s of sockets) {
        s.join(`conv:${conversation.id}`)
        const data = s.data as AuthedSocket['data']
        if (data.convUuidToId) {
          data.convUuidToId[conversation.uuid] = conversation.id
        }
      }
    } catch (err) {
      logger.warn({ err, userId, conversationId: conversation.id }, 'joinUserToConversation failed')
    }
  }

  async leaveUserFromConversation(userId: number, conversationId: number): Promise<void> {
    if (!this.io) return
    try {
      const sockets = await this.io.in(`user:${userId}`).fetchSockets()
      for (const s of sockets) {
        s.leave(`conv:${conversationId}`)
        const data = s.data as AuthedSocket['data']
        if (data.convUuidToId) {
          for (const key of Object.keys(data.convUuidToId)) {
            if (data.convUuidToId[key] === conversationId) {
              delete data.convUuidToId[key]
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, userId, conversationId }, 'leaveUserFromConversation failed')
    }
  }

  private async markOnline(userId: number, online: boolean): Promise<void> {
    try {
      const user = await User.find(userId)
      if (!user) return
      user.isOnline = online
      user.lastSeenAt = DateTime.now()
      await user.save()

      if (this.io) {
        this.io.emit('presence:changed', {
          userId: user.uuid,
          isOnline: online,
          lastSeenAt: user.lastSeenAt,
        })
      }
    } catch (err) {
      logger.warn({ err, userId, online }, 'markOnline failed')
    }
  }
}

export default new RealtimeService()

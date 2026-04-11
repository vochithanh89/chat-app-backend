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
      // Tighter heartbeats so abrupt disconnects (network drop, tab crash,
      // laptop sleep) are detected in ~12s instead of the default ~45s.
      // Clean tab closes are detected immediately via the WebSocket close
      // frame and do not wait for the heartbeat.
      pingInterval: 10_000,
      pingTimeout: 5_000,
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

      // --- Register the disconnect listener FIRST, before any await, so
      // we never lose a disconnect event if the socket drops while we are
      // still doing initial setup (e.g. loading memberships from DB).
      socket.on('disconnect', (reason) => {
        logger.info({ userId, socketId: socket.id, reason }, 'socket disconnected')

        const current = this.connections.get(userId) ?? 0
        const next = Math.max(0, current - 1)
        if (next === 0) {
          this.connections.delete(userId)
          void this.markOnline(userId, false)
        } else {
          this.connections.set(userId, next)
        }
      })

      // --- Presence counter — also before any await so we never miss an
      // increment that would leave the user stuck in the wrong state.
      const prevCount = this.connections.get(userId) ?? 0
      this.connections.set(userId, prevCount + 1)
      if (prevCount === 0) {
        void this.markOnline(userId, true)
      }

      // Client-driven join/leave (pure sync, safe before the await).
      socket.on('conversation:join', (conversationId: number) => {
        socket.join(`conv:${conversationId}`)
      })
      socket.on('conversation:leave', (conversationId: number) => {
        socket.leave(`conv:${conversationId}`)
      })

      // Typing indicators — broadcast to other members of the
      // conversation room, excluding the sender. Payload:
      //   { conversationId: "uuid" }
      // The server resolves the UUID via the pre-cached map so we
      // don't touch the DB on every keystroke.
      socket.on('typing:start', (data: { conversationId?: string }) => {
        const convUuid = data?.conversationId
        if (!convUuid) return
        const authed = socket as AuthedSocket
        const internalId = authed.data.convUuidToId?.[convUuid]
        if (!internalId) return
        socket.to(`conv:${internalId}`).emit('typing:start', {
          conversationId: convUuid,
          userId: authed.data.userUuid,
        })
      })
      socket.on('typing:stop', (data: { conversationId?: string }) => {
        const convUuid = data?.conversationId
        if (!convUuid) return
        const authed = socket as AuthedSocket
        const internalId = authed.data.convUuidToId?.[convUuid]
        if (!internalId) return
        socket.to(`conv:${internalId}`).emit('typing:stop', {
          conversationId: convUuid,
          userId: authed.data.userUuid,
        })
      })

      // Personal + conversation rooms.
      socket.join(`user:${userId}`)
      try {
        // Load the user's UUID + all memberships (with conversation
        // UUIDs) once per connection. These feed the transient-event
        // cache described above.
        const user = await User.find(userId)
        ;(socket as AuthedSocket).data.userUuid = user?.uuid

        const memberships = await ConversationMember.query()
          .where('user_id', userId)
          .preload('conversation', (q) => q.select('id', 'uuid'))

        const convMap: Record<string, number> = {}
        for (const m of memberships) {
          socket.join(`conv:${m.conversationId}`)
          if (m.conversation?.uuid) convMap[m.conversation.uuid] = m.conversationId
        }
        ;(socket as AuthedSocket).data.convUuidToId = convMap
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

  emitToUser(userId: number, event: string, payload: unknown): void {
    if (!this.io) return
    this.io.to(`user:${userId}`).emit(event, payload)
  }

  /**
   * Make every currently-connected socket for `userId` join the
   * conversation's socket.io room and remember its public UUID in the
   * per-socket cache used by transient events (typing, etc.).
   *
   * Call this right after a user gains membership to a conversation so
   * they start receiving `message:new` / `conversation:read` / typing
   * events without having to reconnect.
   */
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
      logger.warn(
        { err, userId, conversationId: conversation.id },
        'joinUserToConversation failed'
      )
    }
  }

  /**
   * Reverse of joinUserToConversation — remove every socket for
   * `userId` from the conversation room and clear the cache entry.
   */
  async leaveUserFromConversation(
    userId: number,
    conversationId: number
  ): Promise<void> {
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
      logger.warn(
        { err, userId, conversationId },
        'leaveUserFromConversation failed'
      )
    }
  }

  /**
   * Persist an online/offline flip to the DB and fan out a
   * `presence:changed` event so friends can update their UIs.
   */
  private async markOnline(userId: number, online: boolean): Promise<void> {
    try {
      const user = await User.find(userId)
      if (!user) return
      user.isOnline = online
      user.lastSeenAt = DateTime.now()
      await user.save()

      // Let interested clients know. Broadcast globally for now — it's a
      // single room lookup per subscriber. If this becomes noisy we can
      // narrow it down to the friends of the user only.
      if (this.io) {
        this.io.emit('presence:changed', {
          userId,
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

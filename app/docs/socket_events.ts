/**
 * Socket.IO event catalogue.
 *
 * OpenAPI/Swagger is HTTP-oriented and has no native notion of WebSocket
 * events, so we document them here as structured data and render them as
 * a Markdown section inside `info.description`. Swagger UI renders the
 * Markdown which gives us a single documentation page for both REST and
 * real-time APIs.
 *
 * Keep this file in sync with any `realtimeService.emit*(...)` call.
 */

export type SocketDirection =
  | 'server→client'
  | 'client→server'

export type SocketTarget =
  | 'user room'
  | 'conversation room'
  | 'broadcast'
  | 'own socket'

export interface SocketEventDoc {
  event: string
  direction: SocketDirection
  target: SocketTarget
  description: string
  payload?: Record<string, string>
  emittedFrom?: string
}

export interface SocketEventGroup {
  name: string
  description: string
  events: SocketEventDoc[]
}

export const socketEventGroups: SocketEventGroup[] = [
  {
    name: 'Connection & auth',
    description:
      'Sockets authenticate via JWT. Pass the access token either in the handshake auth payload or as a `Bearer` token in the `Authorization` header of the handshake. On connect the server auto-joins the socket to `user:{userId}` and to every `conv:{conversationId}` the user is a member of.',
    events: [
      {
        event: 'conversation:join',
        direction: 'client→server',
        target: 'own socket',
        description:
          'Ask the server to join this socket to a conversation room (e.g. after creating a new conversation).',
        payload: { conversationId: 'number' },
        emittedFrom: 'client',
      },
      {
        event: 'conversation:leave',
        direction: 'client→server',
        target: 'own socket',
        description: 'Leave a previously joined conversation room.',
        payload: { conversationId: 'number' },
        emittedFrom: 'client',
      },
    ],
  },
  {
    name: 'Presence',
    description:
      'Presence is driven by the Socket.IO connection state — the user is considered online while at least one of their sockets is connected.',
    events: [
      {
        event: 'presence:changed',
        direction: 'server→client',
        target: 'broadcast',
        description:
          'Fired whenever a user goes online or offline. Broadcast to every connected socket so any UI showing that user can update in place.',
        payload: {
          userId: 'number',
          isOnline: 'boolean',
          lastSeenAt: 'ISO datetime',
        },
        emittedFrom: 'realtime_service.markOnline',
      },
    ],
  },
  {
    name: 'Friendships',
    description:
      'All friendship events are emitted to the `user:{userId}` room of the interested party so both sides of a mutation see the change immediately.',
    events: [
      {
        event: 'friend:request:received',
        direction: 'server→client',
        target: 'user room',
        description:
          'Someone sent the current user a friend request. Delivered to the addressee.',
        payload: {
          friendshipId: 'number',
          from: '{ id: number, name: string, avatarUrl: string | null }',
          createdAt: 'ISO datetime',
        },
        emittedFrom: 'FriendsController.sendRequest',
      },
      {
        event: 'friend:request:sent',
        direction: 'server→client',
        target: 'user room',
        description:
          'Echo to the requester after their friend request was created. Useful when the requester has multiple tabs open.',
        payload: {
          friendshipId: 'number',
          to: '{ id: number, name: string, avatarUrl: string | null }',
          createdAt: 'ISO datetime',
        },
        emittedFrom: 'FriendsController.sendRequest',
      },
      {
        event: 'friend:request:accepted',
        direction: 'server→client',
        target: 'user room',
        description:
          'The original requester is told their friend request was accepted.',
        payload: {
          friendshipId: 'number',
          by: '{ id: number, name: string, avatarUrl: string | null }',
        },
        emittedFrom: 'FriendsController.accept',
      },
      {
        event: 'friend:added',
        direction: 'server→client',
        target: 'user room',
        description:
          'Echo to the user who accepted a request. Mainly a signal for tabs other than the one where the click happened.',
        payload: {
          friendshipId: 'number',
          userId: 'number',
        },
        emittedFrom: 'FriendsController.accept',
      },
      {
        event: 'friend:request:rejected',
        direction: 'server→client',
        target: 'user room',
        description: 'The requester is told their pending request was rejected.',
        payload: {
          friendshipId: 'number',
          by: '{ id: number }',
        },
        emittedFrom: 'FriendsController.reject',
      },
      {
        event: 'friend:request:cancelled',
        direction: 'server→client',
        target: 'user room',
        description:
          'The addressee is told the requester has cancelled the pending request.',
        payload: {
          friendshipId: 'number',
          by: '{ id: number }',
        },
        emittedFrom: 'FriendsController.cancel',
      },
      {
        event: 'friend:unfriended',
        direction: 'server→client',
        target: 'user room',
        description:
          'An accepted friendship was removed. Emitted to BOTH parties so each side can drop the other from their friends list.',
        payload: { userId: 'number' },
        emittedFrom: 'FriendsController.unfriend',
      },
    ],
  },
  {
    name: 'Blocking',
    description:
      'Blocking cascades — it deletes any existing friendship/request between the two users. The UI on both sides should drop the other user from every list.',
    events: [
      {
        event: 'friend:blocked',
        direction: 'server→client',
        target: 'user room',
        description:
          'Echo to the blocker so other tabs can prune the blocked user from their lists.',
        payload: { userId: 'number' },
        emittedFrom: 'BlocksController.block',
      },
      {
        event: 'friend:blocked-by',
        direction: 'server→client',
        target: 'user room',
        description:
          'Delivered to the user who just got blocked. The client should drop the blocker from friends/search/pending lists.',
        payload: { userId: 'number' },
        emittedFrom: 'BlocksController.block',
      },
      {
        event: 'friend:unblocked',
        direction: 'server→client',
        target: 'user room',
        description:
          'Echo to the user who removed the block. The blocked user is NOT notified by design.',
        payload: { userId: 'number' },
        emittedFrom: 'BlocksController.unblock',
      },
    ],
  },
  {
    name: 'Messages',
    description:
      'Message events are scoped to `conv:{conversationId}` rooms. Every member of a conversation is automatically joined to its room on connect.',
    events: [
      {
        event: 'message:new',
        direction: 'server→client',
        target: 'conversation room',
        description:
          'A new message was posted to the conversation. Payload is the fully serialised message (same shape as `GET /conversations/:id/messages`).',
        payload: { message: 'Message' },
        emittedFrom: 'MessageService.send / MessageService.forward',
      },
      {
        event: 'message:recalled',
        direction: 'server→client',
        target: 'conversation room',
        description: 'A message was recalled by its sender.',
        payload: { id: 'number' },
        emittedFrom: 'MessageService.recall',
      },
      {
        event: 'message:reaction:added',
        direction: 'server→client',
        target: 'conversation room',
        description: 'A reaction was added to a message.',
        payload: {
          messageId: 'number',
          userId: 'number',
          emoji: 'string',
        },
        emittedFrom: 'MessagesController.react',
      },
      {
        event: 'message:reaction:removed',
        direction: 'server→client',
        target: 'conversation room',
        description: 'A reaction was removed from a message.',
        payload: {
          messageId: 'number',
          userId: 'number',
          emoji: 'string',
        },
        emittedFrom: 'MessagesController.unreact',
      },
    ],
  },
]

function renderPayload(payload?: Record<string, string>): string {
  if (!payload || Object.keys(payload).length === 0) return '_(no payload)_'
  const lines = Object.entries(payload).map(
    ([k, v]) => `  - \`${k}\`: ${v}`
  )
  return lines.join('\n')
}

function renderEvent(e: SocketEventDoc): string {
  return [
    `**\`${e.event}\`** — _${e.direction}_ · _${e.target}_`,
    '',
    e.description,
    '',
    'Payload:',
    renderPayload(e.payload),
    e.emittedFrom ? `\nEmitted from: \`${e.emittedFrom}\`` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSocketEventsMarkdown(): string {
  const lines: string[] = [
    '## Real-time API (Socket.IO)',
    '',
    `Socket.IO endpoint: \`/socket.io\` (served on the same host as the REST API).`,
    '',
    '### Authenticating',
    '',
    "Pass the JWT access token when creating the client:",
    '',
    '```js',
    "import { io } from 'socket.io-client'",
    '',
    "const socket = io('http://localhost:3333', {",
    "  path: '/socket.io',",
    "  transports: ['websocket'],",
    "  auth: { token: '<JWT_ACCESS_TOKEN>' },",
    '})',
    '```',
    '',
    'On successful handshake the server auto-joins the socket to room `user:{userId}` (used for 1-to-1 notifications) and to every `conv:{conversationId}` the user is a member of.',
    '',
  ]

  for (const group of socketEventGroups) {
    lines.push(`### ${group.name}`, '', group.description, '')
    for (const event of group.events) {
      lines.push(renderEvent(event), '', '---', '')
    }
  }

  return lines.join('\n')
}

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

export type SocketDirection = 'server→client' | 'client→server' | 'client↔server'

export type SocketTarget = 'user room' | 'conversation room' | 'broadcast' | 'own socket'

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
      'Sockets authenticate via JWT. Pass the access token either in the handshake auth payload or as a `Bearer` token in the `Authorization` header of the handshake. On connect the server auto-joins the socket to `user:{userId}` and to every `conv:{internalConversationId}` the user is already a member of, and caches the UUID→internal-id map on the socket for transient events (typing, etc.). Room names use an internal numeric id that is NEVER exposed in payloads — all public identifiers are UUIDs.',
    events: [
      {
        event: 'conversation:join',
        direction: 'client→server',
        target: 'own socket',
        description:
          '_(legacy)_ Ask the server to join this socket to a conversation room. The client normally does not need to call this — membership mutations (`conversation:joined` on the server) already take care of joining the right room.',
        payload: { conversationId: 'string (uuid)' },
        emittedFrom: 'client',
      },
      {
        event: 'conversation:leave',
        direction: 'client→server',
        target: 'own socket',
        description: '_(legacy)_ Leave a previously joined conversation room.',
        payload: { conversationId: 'string (uuid)' },
        emittedFrom: 'client',
      },
    ],
  },
  {
    name: 'Presence',
    description:
      'Presence is driven by the Socket.IO connection state — the user is considered online while at least one of their sockets is connected. On the first connect / last disconnect the server writes `isOnline` + `lastSeenAt` to the DB and broadcasts to every connected client.',
    events: [
      {
        event: 'presence:changed',
        direction: 'server→client',
        target: 'broadcast',
        description:
          'Fired whenever a user goes online or offline. Broadcast to every connected socket so any UI showing that user can update in place.',
        payload: {
          userId: 'string (uuid)',
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
      'All friendship events are emitted to the `user:{userId}` room of the interested party so both sides of a mutation see the change immediately. Every id in the payload is a public UUID.',
    events: [
      {
        event: 'friend:request:received',
        direction: 'server→client',
        target: 'user room',
        description: 'Someone sent the current user a friend request. Delivered to the addressee.',
        payload: {
          friendshipId: 'string (uuid)',
          from: '{ id: string (uuid), name: string, avatarUrl: string | null }',
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
          friendshipId: 'string (uuid)',
          to: '{ id: string (uuid), name: string, avatarUrl: string | null }',
          createdAt: 'ISO datetime',
        },
        emittedFrom: 'FriendsController.sendRequest',
      },
      {
        event: 'friend:request:accepted',
        direction: 'server→client',
        target: 'user room',
        description: 'The original requester is told their friend request was accepted.',
        payload: {
          friendshipId: 'string (uuid)',
          by: '{ id: string (uuid), name: string, avatarUrl: string | null }',
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
          friendshipId: 'string (uuid)',
          userId: 'string (uuid) | null',
        },
        emittedFrom: 'FriendsController.accept',
      },
      {
        event: 'friend:request:rejected',
        direction: 'server→client',
        target: 'user room',
        description: 'The requester is told their pending request was rejected.',
        payload: {
          friendshipId: 'string (uuid)',
          by: '{ id: string (uuid) }',
        },
        emittedFrom: 'FriendsController.reject',
      },
      {
        event: 'friend:request:cancelled',
        direction: 'server→client',
        target: 'user room',
        description: 'The addressee is told the requester has cancelled the pending request.',
        payload: {
          friendshipId: 'string (uuid)',
          by: '{ id: string (uuid) }',
        },
        emittedFrom: 'FriendsController.cancel',
      },
      {
        event: 'friend:unfriended',
        direction: 'server→client',
        target: 'user room',
        description:
          'An accepted friendship was removed. Emitted to BOTH parties so each side can drop the other from their friends list.',
        payload: { userId: 'string (uuid)' },
        emittedFrom: 'FriendsController.unfriend',
      },
    ],
  },
  {
    name: 'Blocking',
    description:
      'Blocking cascades — it deletes any existing friendship/request between the two users. The UI on both sides should drop the other user from every list and show a block notice in any existing direct conversation.',
    events: [
      {
        event: 'friend:blocked',
        direction: 'server→client',
        target: 'user room',
        description:
          'Echo to the blocker so other tabs can prune the blocked user from their lists and flip the open chat into "blocked" mode.',
        payload: { userId: 'string (uuid)' },
        emittedFrom: 'BlocksController.block',
      },
      {
        event: 'friend:blocked-by',
        direction: 'server→client',
        target: 'user room',
        description:
          'Delivered to the user who just got blocked. The client should drop the blocker from friends/search/pending lists and disable the composer in any existing direct conversation.',
        payload: { userId: 'string (uuid)' },
        emittedFrom: 'BlocksController.block',
      },
      {
        event: 'friend:unblocked',
        direction: 'server→client',
        target: 'user room',
        description:
          'Echo to the user who removed the block so their open chat composer can be re-enabled.',
        payload: { userId: 'string (uuid)' },
        emittedFrom: 'BlocksController.unblock',
      },
      {
        event: 'friend:unblocked-by',
        direction: 'server→client',
        target: 'user room',
        description:
          'Delivered to the user who was just unblocked, so both sides leave "blocked" mode symmetrically.',
        payload: { userId: 'string (uuid)' },
        emittedFrom: 'BlocksController.unblock',
      },
    ],
  },
  {
    name: 'VoIP & Video Call',
    description:
      'WebRTC signaling for 1-on-1 calls. The server acts as a simple relay. The flow is: Client A sends `call:request` with an offer → Server forwards a `call:incoming` to Client B → Client B sends `call:answer` → Server forwards `call:accepted` to Client A → Both clients exchange ICE candidates via `call:ice-candidate` until a peer-to-peer connection is established.',
    events: [
      {
        event: 'call:request',
        direction: 'client→server',
        target: 'user room',
        description: 'Initiate a call by sending an offer to another user.',
        payload: {
          to: 'string (userId)',
          offer: 'RTCSessionDescriptionInit',
          type: "'video' | 'audio'",
          conversationId: 'string (uuid)',
        },
        emittedFrom: 'client',
      },
      {
        event: 'call:incoming',
        direction: 'server→client',
        target: 'user room',
        description: 'Forwarded from a `call:request`, notifying the user of an incoming call.',
        payload: {
          from: 'string (userId)',
          offer: 'RTCSessionDescriptionInit',
          type: "'video' | 'audio'",
          conversationId: 'string (uuid)',
        },
        emittedFrom: 'realtime_service call listener',
      },
      {
        event: 'call:answer',
        direction: 'client→server',
        target: 'user room',
        description: 'Answer a call by sending an answer back to the original caller.',
        payload: {
          to: 'string (userId)',
          answer: 'RTCSessionDescriptionInit',
          conversationId: 'string (uuid)',
        },
        emittedFrom: 'client',
      },
      {
        event: 'call:accepted',
        direction: 'server→client',
        target: 'user room',
        description: "Forwarded from a `call:answer`, notifying the caller their offer was accepted.",
        payload: {
          from: 'string (userId)',
          answer: 'RTCSessionDescriptionInit',
        },
        emittedFrom: 'realtime_service call listener',
      },
      {
        event: 'call:ice-candidate',
        direction: 'client↔server',
        target: 'user room',
        description: 'Exchange ICE candidates to establish the peer-to-peer connection.',
        payload: {
          to: 'string (userId)',
          candidate: 'RTCIceCandidateInit',
          conversationId: 'string (uuid)',
        },
        emittedFrom: 'client / realtime_service call listener',
      },
      {
        event: 'call:reject',
        direction: 'client↔server',
        target: 'user room',
        description: 'The recipient rejected the call. Relayed to the caller.',
        payload: {
          to: 'string (userId)',
          conversationId: 'string (uuid)',
        },
        emittedFrom: 'client / realtime_service call listener',
      },
      {
        event: 'call:hangup',
        direction: 'client↔server',
        target: 'user room',
        description: 'One of the parties ended the call. Relayed to the other party.',
        payload: {
          to: 'string (userId)',
          conversationId: 'string (uuid)',
        },
        emittedFrom: 'client / realtime_service call listener',
      },
    ],
  },
  {
    name: 'Conversation membership',
    description:
      'Lifecycle events for conversation rooms. When a user is added to a conversation the server automatically joins every socket of that user to the room AND updates the per-socket UUID→internal-id cache, so subsequent `message:new` / `typing` / `conversation:read` events reach the new member without reconnecting.',
    events: [
      {
        event: 'conversation:joined',
        direction: 'server→client',
        target: 'user room',
        description:
          'The user has been granted membership (someone added them to a group, or they just created one on another tab). Clients should fetch the full conversation via `GET /conversations/:id` and insert it at the top of the sidebar.',
        payload: { conversationId: 'string (uuid)' },
        emittedFrom: 'ConversationsController.createGroup / addMembers',
      },
      {
        event: 'conversation:removed',
        direction: 'server→client',
        target: 'user room',
        description:
          'The user is no longer a member (kicked, they left, or the group was disbanded). Clients drop the conversation from the sidebar; any open chat on this conversation navigates back to `/chat`.',
        payload: { conversationId: 'string (uuid)' },
        emittedFrom: 'ConversationsController.removeMember / leave / disband',
      },
      {
        event: 'conversation:members-changed',
        direction: 'server→client',
        target: 'conversation room',
        description:
          "A member was added, removed, or left. Remaining members should refetch the conversation so the open GroupInfoDialog's member list is in sync.",
        payload: { conversationId: 'string (uuid)' },
        emittedFrom: 'ConversationsController.addMembers / removeMember / leave',
      },
      {
        event: 'conversation:read',
        direction: 'server→client',
        target: 'conversation room',
        description:
          'A member has marked the conversation as read up to `lastMessageId`. Clients use this to render read receipts (mini avatars under the latest own message the reader has seen).',
        payload: {
          conversationId: 'string (uuid)',
          userId: 'string (uuid)',
          lastReadAt: 'ISO datetime',
          lastMessageId: 'string (uuid) | null',
        },
        emittedFrom: 'ConversationsController.markRead',
      },
    ],
  },
  {
    name: 'Typing indicators',
    description:
      'Client emits `typing:start` / `typing:stop` as the user edits the composer. The server resolves the conversation UUID via the per-socket cache and rebroadcasts to the conversation room (excluding the sender), so other members can show / hide a "is typing…" indicator. Clients are expected to throttle `start` to ~once every 3s and always send `stop` on send / blur / unmount, plus auto-expire stale indicators on the receiver after 6s.',
    events: [
      {
        event: 'typing:start',
        direction: 'client→server',
        target: 'own socket',
        description:
          'The local user started typing in a conversation. No response; the server rebroadcasts to other members.',
        payload: { conversationId: 'string (uuid)' },
        emittedFrom: 'client',
      },
      {
        event: 'typing:stop',
        direction: 'client→server',
        target: 'own socket',
        description:
          'The local user stopped typing (pause, blur, send, unmount). The server rebroadcasts to other members.',
        payload: { conversationId: 'string (uuid)' },
        emittedFrom: 'client',
      },
      {
        event: 'typing:start',
        direction: 'server→client',
        target: 'conversation room',
        description:
          'Rebroadcast of a client `typing:start` to every other member of the conversation.',
        payload: {
          conversationId: 'string (uuid)',
          userId: 'string (uuid)',
        },
        emittedFrom: 'realtime_service typing listener',
      },
      {
        event: 'typing:stop',
        direction: 'server→client',
        target: 'conversation room',
        description:
          'Rebroadcast of a client `typing:stop` to every other member of the conversation.',
        payload: {
          conversationId: 'string (uuid)',
          userId: 'string (uuid)',
        },
        emittedFrom: 'realtime_service typing listener',
      },
    ],
  },
  {
    name: 'Messages',
    description:
      'Message events are scoped to `conv:{internalId}` rooms. Every id in the payload is a public UUID — the numeric primary keys never leak to clients.',
    events: [
      {
        event: 'message:new',
        direction: 'server→client',
        target: 'conversation room',
        description:
          'A new message was posted to the conversation. Payload is the fully serialised message (same shape as the items returned by `GET /conversations/:id/messages`).',
        payload: { message: 'Message' },
        emittedFrom: 'MessageService.send / MessageService.forward',
      },
      {
        event: 'message:recalled',
        direction: 'server→client',
        target: 'conversation room',
        description:
          'A message was recalled by its sender. Clients replace its content with "[Message recalled]" and should also drop its reactions + attachments.',
        payload: { id: 'string (uuid)' },
        emittedFrom: 'MessageService.recall',
      },
      {
        event: 'message:reaction:added',
        direction: 'server→client',
        target: 'conversation room',
        description: 'A reaction was added to a message.',
        payload: {
          messageId: 'string (uuid)',
          userId: 'string (uuid)',
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
          messageId: 'string (uuid)',
          userId: 'string (uuid)',
          emoji: 'string',
        },
        emittedFrom: 'MessagesController.unreact',
      },
    ],
  },
]

function renderPayload(payload?: Record<string, string>): string {
  if (!payload || Object.keys(payload).length === 0) return '_(no payload)_'
  const lines = Object.entries(payload).map(([k, v]) => `  - \`${k}\`: ${v}`)
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
    'Pass the JWT access token when creating the client:',
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

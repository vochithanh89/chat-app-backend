/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
*/

import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'
import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'

const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const FriendsController = () => import('#controllers/friends_controller')
const BlocksController = () => import('#controllers/blocks_controller')
const ConversationsController = () => import('#controllers/conversations_controller')
const MessagesController = () => import('#controllers/messages_controller')
const AiController = () => import('#controllers/ai_controller')
const ReportsController = () => import('#controllers/reports_controller')
const AdminController = () => import('#controllers/admin_controller')

// Swagger spec + UI
router.get('/swagger', async () => {
  return AutoSwagger.default.docs(router.toJSON(), swagger)
})
router.get('/docs', async () => {
  return AutoSwagger.default.ui('/swagger', swagger)
})

router
  .group(() => {
    // Public auth routes
    router.post('/auth/login', [AuthController, 'login']).as('auth.login')
    router.post('/auth/qr/generate', [AuthController, 'generateQr']).as('auth.qr.generate')
    router.post('/auth/qr/scan', [AuthController, 'scanQr']).as('auth.qr.scan')
    router.get('/auth/qr/status', [AuthController, 'qrStatus']).as('auth.qr.status')
    router.post('/auth/register', [AuthController, 'register']).as('auth.register')
    router.post('/auth/refresh', [AuthController, 'refresh']).as('auth.refresh')
    router.post('/auth/verify-email', [AuthController, 'verifyEmail']).as('auth.verifyEmail')
    router.post('/auth/resend-otp', [AuthController, 'resendOtp']).as('auth.resendOtp')
    router
      .post('/auth/forgot-password', [AuthController, 'forgotPassword'])
      .as('auth.forgotPassword')
    router.post('/auth/reset-password', [AuthController, 'resetPassword']).as('auth.resetPassword')

    // WebSockets based QR Login
    const QrLoginController = () => import('#controllers/qr_login_controller')
    router.post('/qr-login/generate', [QrLoginController, 'generate']).as('qrLogin.generate')

    // Auth-only (JWT)
    router
      .group(() => {
        router.post('/auth/logout', [AuthController, 'logout']).as('auth.logout')
        router
          .post('/auth/change-password', [AuthController, 'changePassword'])
          .as('auth.changePassword')
          
        router.post('/qr-login/scan', [QrLoginController, 'scan']).as('qrLogin.scan')
        router.post('/qr-login/confirm', [QrLoginController, 'confirm']).as('qrLogin.confirm')
        router.post('/qr-login/reject', [QrLoginController, 'reject']).as('qrLogin.reject')
      })
      .use(middleware.auth({ guards: ['jwt'] }))

    // Authenticated + email verified
    router
      .group(() => {
        router.get('/user/me', [UsersController, 'me']).as('users.me')
        router.put('/user/profile', [UsersController, 'updateProfile']).as('users.updateProfile')
        router.put('/user/avatar', [UsersController, 'updateAvatar']).as('users.updateAvatar')
        router.post('/user/heartbeat', [UsersController, 'heartbeat']).as('users.heartbeat')
        router.post('/user/offline', [UsersController, 'goOffline']).as('users.offline')
        router
          .post('/user/device-tokens', [UsersController, 'registerDeviceToken'])
          .as('users.registerDeviceToken')
        router
          .delete('/user/device-tokens', [UsersController, 'unregisterDeviceToken'])
          .as('users.unregisterDeviceToken')
        router.get('/users/search', [UsersController, 'search']).as('users.search')
        router.get('/users/:id', [UsersController, 'show']).as('users.show')

        // Friendship
        router.get('/friends', [FriendsController, 'list']).as('friends.list')
        router
          .get('/friends/requests/received', [FriendsController, 'receivedRequests'])
          .as('friends.requests.received')
        router
          .get('/friends/requests/sent', [FriendsController, 'sentRequests'])
          .as('friends.requests.sent')
        router
          .post('/friends/requests', [FriendsController, 'sendRequest'])
          .as('friends.requests.send')
        router
          .post('/friends/requests/:id/accept', [FriendsController, 'accept'])
          .as('friends.requests.accept')
        router
          .post('/friends/requests/:id/reject', [FriendsController, 'reject'])
          .as('friends.requests.reject')
        router
          .delete('/friends/requests/:id', [FriendsController, 'cancel'])
          .as('friends.requests.cancel')
        router.delete('/friends/:userId', [FriendsController, 'unfriend']).as('friends.unfriend')

        // Blocking
        router.get('/blocks', [BlocksController, 'list']).as('blocks.list')
        router.post('/blocks', [BlocksController, 'block']).as('blocks.block')
        router.delete('/blocks/:userId', [BlocksController, 'unblock']).as('blocks.unblock')

        // Conversations
        router
          .post('/conversations/direct', [ConversationsController, 'createDirect'])
          .as('conversations.createDirect')
        router
          .post('/conversations/group', [ConversationsController, 'createGroup'])
          .as('conversations.createGroup')
        router.get('/conversations', [ConversationsController, 'list']).as('conversations.list')
        router.get('/conversations/:id', [ConversationsController, 'show']).as('conversations.show')
        router
          .post('/conversations/:id/members', [ConversationsController, 'addMembers'])
          .as('conversations.addMembers')
        router
          .delete('/conversations/:id/members/:userId', [ConversationsController, 'removeMember'])
          .as('conversations.removeMember')
        router
          .post('/conversations/:id/leave', [ConversationsController, 'leave'])
          .as('conversations.leave')
        router
          .post('/conversations/:id/archive', [ConversationsController, 'archive'])
          .as('conversations.archive')
        router
          .put('/conversations/:id/members/:userId/role', [
            ConversationsController,
            'updateMemberRole',
          ])
          .as('conversations.updateMemberRole')
        router
          .post('/conversations/:id/transfer', [ConversationsController, 'transferOwnership'])
          .as('conversations.transferOwnership')
        router
          .delete('/conversations/:id', [ConversationsController, 'disband'])
          .as('conversations.disband')
        router
          .post('/conversations/:id/read', [ConversationsController, 'markRead'])
          .as('conversations.markRead')
        router
          .put('/conversations/:id/avatar', [ConversationsController, 'updateAvatar'])
          .as('conversations.updateAvatar')
        router
          .post('/conversations/:id/mute', [ConversationsController, 'toggleMute'])
          .as('conversations.toggleMute')
        router
          .post('/conversations/:id/pin', [ConversationsController, 'togglePin'])
          .as('conversations.togglePin')

        // Messages
        router
          .get('/conversations/:conversationId/messages', [MessagesController, 'list'])
          .as('messages.list')
        router
          .post('/conversations/:conversationId/messages', [MessagesController, 'send'])
          .as('messages.send')
        router
          .post('/messages/upload', [MessagesController, 'uploadAttachment'])
          .as('messages.upload')
        router.post('/messages/:id/recall', [MessagesController, 'recall']).as('messages.recall')
        router
          .post('/messages/:id/delete', [MessagesController, 'deleteForMe'])
          .as('messages.deleteForMe')
        router.post('/messages/:id/forward', [MessagesController, 'forward']).as('messages.forward')
        router.post('/messages/:id/reactions', [MessagesController, 'react']).as('messages.react')
        router
          .delete('/messages/:id/reactions/:emoji', [MessagesController, 'unreact'])
          .as('messages.unreact')
        router.post('/messages/:id/pin', [MessagesController, 'pin']).as('messages.pin')
        router.delete('/messages/:id/pin', [MessagesController, 'unpin']).as('messages.unpin')
        router.post('/messages/:id/star', [MessagesController, 'star']).as('messages.star')
        router.delete('/messages/:id/star', [MessagesController, 'unstar']).as('messages.unstar')
        router.get('/messages/starred', [MessagesController, 'listStarred']).as('messages.starred')
        router.get('/messages/:id/detail', [MessagesController, 'detail']).as('messages.detail')

        // AI Chatbot
        router
          .post('/ai/conversations', [AiController, 'startConversation'])
          .as('ai.startConversation')
        router.post('/ai/conversations/new', [AiController, 'startNewConversation']).as(
          'ai.startNewConversation'
        )
        router.post('/ai/chat', [AiController, 'chat']).as('ai.chat')

        // Reports (user side)
        router.post('/reports', [ReportsController, 'create']).as('reports.create')
        router.get('/reports/mine', [ReportsController, 'mine']).as('reports.mine')

        // Admin
        router
          .group(() => {
            router.get('/admin/overview', [AdminController, 'overview']).as('admin.overview')
            router
              .get('/admin/stats/messages', [AdminController, 'messageStats'])
              .as('admin.stats.messages')
            router.get('/admin/users', [AdminController, 'listUsers']).as('admin.users.list')
            router
              .put('/admin/users/:id/status', [AdminController, 'updateUserStatus'])
              .as('admin.users.updateStatus')
            router.get('/admin/reports', [AdminController, 'listReports']).as('admin.reports.list')
            router
              .put('/admin/reports/:id', [AdminController, 'updateReportStatus'])
              .as('admin.reports.update')
          })
          .use(middleware.admin())
      })
      .use(middleware.auth({ guards: ['jwt'] }))
      .use(middleware.emailVerified())
      .use(middleware.trackPresence())
  })
  .prefix('/api/v1')

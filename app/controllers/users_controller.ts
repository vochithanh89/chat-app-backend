import User from '#models/user'
import DeviceToken from '#models/device_token'
import { updateProfileValidator } from '#validators/update_profile'
import { updateAvatarValidator } from '#validators/update_avatar'
import { searchUsersValidator, registerDeviceTokenValidator } from '#validators/friendship'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import { ApiResponse } from '#utils/api_response'

export default class UsersController {
  /**
   * @me
   * @operationId getCurrentUser
   * @description Returns the authenticated user's profile.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"user": "User"}}
   * @responseBody 401 - {"success": false, "message": "Unauthorized.", "errors": []}
   */
  public async me({ auth, response }: HttpContext) {
    const user = auth.use('jwt').getUserOrFail()
    return ApiResponse.ok(response, 'OK', { user: user.serialize() })
  }

  /**
   * @show
   * @operationId getUserById
   * @description Returns a public user profile by ID.
   * @paramPath id - The ID of the user to retrieve.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"user": "User"}}
   * @responseBody 404 - {"success": false, "message": "User not found.", "errors": []}
   */
  public async show({ params, response }: HttpContext) {
    const user = await User.findBy('uuid', params.id)
    if (!user) {
      return ApiResponse.error(response, 404, 'User not found.')
    }
    return ApiResponse.ok(response, 'OK', {
      user: {
        id: user.uuid,
        name: user.name,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        isOnline: user.isOnline,
        lastSeenAt: user.lastSeenAt,
      },
    })
  }

  /**
   * @updateProfile
   * @operationId updateUserProfile
   * @description Updates the authenticated user's profile (name, bio).
   * @requestBody {"name": "string", "bio": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"user": "User"}}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async updateProfile({ request, response, auth }: HttpContext) {
    const user = auth.use('jwt').getUserOrFail()
    const payload = await request.validateUsing(updateProfileValidator)
    user.merge(payload)
    await user.save()

    return ApiResponse.ok(response, 'Profile updated.', { user: user.serialize() })
  }

  /**
   * @updateAvatar
   * @operationId updateUserAvatar
   * @description Uploads and updates the authenticated user's avatar image.
   * @requestBody {"avatar": "file"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"user": "User", "avatarUrl": "string"}}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async updateAvatar({ request, response, auth }: HttpContext) {
    const user = auth.use('jwt').getUserOrFail()
    const { avatar } = await request.validateUsing(updateAvatarValidator)

    const fileName = `${user.id}_${Date.now()}.${avatar.extname}`
    await avatar.move(app.makePath('public/uploads/avatars'), {
      name: fileName,
      overwrite: true,
    })

    const publicPath = `/uploads/avatars/${fileName}`
    const baseUrl = `${request.protocol()}://${request.host()}`
    user.avatarUrl = `${baseUrl}${publicPath}`
    await user.save()

    return ApiResponse.ok(response, 'Avatar updated.', {
      user: user.serialize(),
      avatarUrl: user.avatarUrl,
    })
  }

  /**
   * @heartbeat
   * @operationId presenceHeartbeat
   * @description Marks the authenticated user as online and refreshes last_seen_at.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"isOnline": true, "lastSeenAt": "string"}}
   */
  public async heartbeat({ response, auth }: HttpContext) {
    const user = auth.use('jwt').getUserOrFail()
    user.isOnline = true
    user.lastSeenAt = DateTime.now()
    await user.save()
    return ApiResponse.ok(response, 'OK', {
      isOnline: user.isOnline,
      lastSeenAt: user.lastSeenAt,
    })
  }

  /**
   * @goOffline
   * @operationId presenceGoOffline
   * @description Marks the authenticated user as offline.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async goOffline({ response, auth }: HttpContext) {
    const user = auth.use('jwt').getUserOrFail()
    user.isOnline = false
    user.lastSeenAt = DateTime.now()
    await user.save()
    return ApiResponse.ok(response, 'OK', null)
  }

  /**
   * @search
   * @operationId searchUsers
   * @description Searches users by name, email, or phone. Excludes the current user.
   * @paramQuery q - Search keyword (min 2 chars).
   * @paramQuery type - Field to search: name | email | phone | auto (default: auto).
   * @paramQuery page - Page number (default 1).
   * @paramQuery limit - Page size (default 20, max 50).
   * @responseBody 200 - {"success": true, "message": "string", "data": {"users": "array", "meta": "object"}}
   */
  public async search({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const {
      q,
      type = 'auto',
      page = 1,
      limit = 20,
    } = await request.validateUsing(searchUsersValidator, { data: request.qs() })

    const query = User.query()
      .whereNot('id', me.id)
      // Exclude users I've blocked
      .whereNotExists((sub) => {
        sub
          .from('user_blocks')
          .whereRaw('user_blocks.blocked_id = users.id')
          .andWhere('user_blocks.blocker_id', me.id)
      })
      // Exclude users who have blocked me
      .whereNotExists((sub) => {
        sub
          .from('user_blocks')
          .whereRaw('user_blocks.blocker_id = users.id')
          .andWhere('user_blocks.blocked_id', me.id)
      })

    // Email and phone require an EXACT match (privacy — partial matches
    // would let someone enumerate users by prefix). Name still uses a
    // case-insensitive LIKE so users are discoverable by partial name.
    if (type === 'email') {
      query.where('email', q)
    } else if (type === 'phone') {
      query.where('phone', q)
    } else if (type === 'name') {
      query.where('name', 'like', `%${q}%`)
    } else {
      query.where((sub) => {
        sub.where('name', 'like', `%${q}%`).orWhere('email', q).orWhere('phone', q)
      })
    }

    // Email/phone are intentionally omitted from the result — they are
    // still searchable (see WHERE clauses above) but must not leak back
    // in the response payload. `uuid` is selected so the model serialises
    // it as `id` (see User model `serializeAs: 'id'`).
    const result = await query
      .select('id', 'uuid', 'name', 'avatar_url', 'bio', 'is_online', 'last_seen_at')
      .orderBy('id', 'desc')
      .paginate(page, limit)

    return ApiResponse.ok(response, 'OK', {
      users: result.all(),
      meta: result.getMeta(),
    })
  }

  /**
   * @registerDeviceToken
   * @operationId registerDeviceToken
   * @description Registers (or refreshes) a push notification device token for the current user.
   * @requestBody {"token": "string", "platform": "android | ios | web"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"deviceToken": "object"}}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async registerDeviceToken({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { token, platform } = await request.validateUsing(registerDeviceTokenValidator)

    const existing = await DeviceToken.findBy('token', token)
    if (existing) {
      existing.userId = me.id
      existing.platform = platform
      await existing.save()
      return ApiResponse.ok(response, 'Device token refreshed.', { deviceToken: existing })
    }

    const created = await DeviceToken.create({ userId: me.id, token, platform })
    return ApiResponse.created(response, 'Device token registered.', { deviceToken: created })
  }

  /**
   * @unregisterDeviceToken
   * @operationId unregisterDeviceToken
   * @description Removes a previously registered push notification device token.
   * @requestBody {"token": "string"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   */
  public async unregisterDeviceToken({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const token = request.input('token')
    if (token) {
      await DeviceToken.query().where('user_id', me.id).andWhere('token', token).delete()
    }
    return ApiResponse.ok(response, 'Device token unregistered.', null)
  }
}

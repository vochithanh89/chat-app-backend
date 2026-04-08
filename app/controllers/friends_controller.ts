import type { HttpContext } from '@adonisjs/core/http'
import Friendship from '#models/friendship'
import User from '#models/user'
import { ApiResponse } from '#utils/api_response'
import { sendFriendRequestValidator } from '#validators/friendship'
import notificationService from '#services/notification_service'

/**
 * Friendship lifecycle:
 *  - requester creates a row with status=pending
 *  - addressee accepts → status=accepted
 *  - addressee rejects → row deleted
 *  - either side unfriends → row deleted (only if accepted)
 */
export default class FriendsController {
  /**
   * @sendRequest
   * @operationId sendFriendRequest
   * @description Sends a friend request to another user.
   * @requestBody {"addressee_id": "number"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"friendship": "object"}}
   * @responseBody 400 - {"success": false, "message": "Cannot send request.", "errors": []}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async sendRequest({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { addressee_id: addresseeId } = await request.validateUsing(sendFriendRequestValidator)

    if (addresseeId === me.id) {
      return ApiResponse.error(response, 400, 'You cannot send a friend request to yourself.')
    }

    const target = await User.find(addresseeId)
    if (!target) {
      return ApiResponse.error(response, 404, 'User not found.')
    }

    const existing = await Friendship.query()
      .where((q) => {
        q.where({ requesterId: me.id, addresseeId }).orWhere({
          requesterId: addresseeId,
          addresseeId: me.id,
        })
      })
      .first()

    if (existing) {
      const msg =
        existing.status === 'accepted'
          ? 'You are already friends with this user.'
          : 'A pending friend request already exists.'
      return ApiResponse.error(response, 400, msg)
    }

    const friendship = await Friendship.create({
      requesterId: me.id,
      addresseeId,
      status: 'pending',
    })

    notificationService
      .sendToUser(addresseeId, {
        title: 'New friend request',
        body: `${me.name ?? 'Someone'} sent you a friend request.`,
        data: { type: 'friend_request', friendshipId: String(friendship.id) },
      })
      .catch(() => {})

    return ApiResponse.created(response, 'Friend request sent.', { friendship })
  }

  /**
   * @accept
   * @operationId acceptFriendRequest
   * @description Accepts a pending friend request addressed to the current user.
   * @paramPath id - The friendship request ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"friendship": "object"}}
   * @responseBody 404 - {"success": false, "message": "Friend request not found.", "errors": []}
   */
  public async accept({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const friendship = await Friendship.query()
      .where('id', params.id)
      .andWhere('addressee_id', me.id)
      .andWhere('status', 'pending')
      .first()

    if (!friendship) {
      return ApiResponse.error(response, 404, 'Friend request not found.')
    }

    friendship.status = 'accepted'
    await friendship.save()

    notificationService
      .sendToUser(friendship.requesterId, {
        title: 'Friend request accepted',
        body: `${me.name ?? 'Someone'} accepted your friend request.`,
        data: { type: 'friend_accepted', friendshipId: String(friendship.id) },
      })
      .catch(() => {})

    return ApiResponse.ok(response, 'Friend request accepted.', { friendship })
  }

  /**
   * @reject
   * @operationId rejectFriendRequest
   * @description Rejects a pending friend request addressed to the current user.
   * @paramPath id - The friendship request ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 404 - {"success": false, "message": "Friend request not found.", "errors": []}
   */
  public async reject({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const friendship = await Friendship.query()
      .where('id', params.id)
      .andWhere('addressee_id', me.id)
      .andWhere('status', 'pending')
      .first()

    if (!friendship) {
      return ApiResponse.error(response, 404, 'Friend request not found.')
    }

    await friendship.delete()
    return ApiResponse.ok(response, 'Friend request rejected.', null)
  }

  /**
   * @cancel
   * @operationId cancelFriendRequest
   * @description Cancels a pending friend request previously sent by the current user.
   * @paramPath id - The friendship request ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 404 - {"success": false, "message": "Friend request not found.", "errors": []}
   */
  public async cancel({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const friendship = await Friendship.query()
      .where('id', params.id)
      .andWhere('requester_id', me.id)
      .andWhere('status', 'pending')
      .first()

    if (!friendship) {
      return ApiResponse.error(response, 404, 'Friend request not found.')
    }

    await friendship.delete()
    return ApiResponse.ok(response, 'Friend request cancelled.', null)
  }

  /**
   * @list
   * @operationId listFriends
   * @description Lists the current user's friends (accepted relationships).
   * @responseBody 200 - {"success": true, "message": "string", "data": {"friends": "array"}}
   */
  public async list({ response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const rows = await Friendship.query()
      .where('status', 'accepted')
      .andWhere((q) => {
        q.where('requester_id', me.id).orWhere('addressee_id', me.id)
      })
      .preload('requester')
      .preload('addressee')

    const friends = rows.map((r) => {
      const other = r.requesterId === me.id ? r.addressee : r.requester
      return {
        friendshipId: r.id,
        id: other.id,
        name: other.name,
        avatarUrl: other.avatarUrl,
        bio: other.bio,
        isOnline: other.isOnline,
        lastSeenAt: other.lastSeenAt,
        since: r.updatedAt ?? r.createdAt,
      }
    })

    return ApiResponse.ok(response, 'OK', { friends })
  }

  /**
   * @receivedRequests
   * @operationId listReceivedFriendRequests
   * @description Lists pending friend requests addressed to the current user.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"requests": "array"}}
   */
  public async receivedRequests({ response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const rows = await Friendship.query()
      .where('addressee_id', me.id)
      .andWhere('status', 'pending')
      .preload('requester')
      .orderBy('created_at', 'desc')

    const requests = rows.map((r) => ({
      friendshipId: r.id,
      from: {
        id: r.requester.id,
        name: r.requester.name,
        avatarUrl: r.requester.avatarUrl,
      },
      createdAt: r.createdAt,
    }))

    return ApiResponse.ok(response, 'OK', { requests })
  }

  /**
   * @sentRequests
   * @operationId listSentFriendRequests
   * @description Lists pending friend requests sent by the current user.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"requests": "array"}}
   */
  public async sentRequests({ response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const rows = await Friendship.query()
      .where('requester_id', me.id)
      .andWhere('status', 'pending')
      .preload('addressee')
      .orderBy('created_at', 'desc')

    const requests = rows.map((r) => ({
      friendshipId: r.id,
      to: {
        id: r.addressee.id,
        name: r.addressee.name,
        avatarUrl: r.addressee.avatarUrl,
      },
      createdAt: r.createdAt,
    }))

    return ApiResponse.ok(response, 'OK', { requests })
  }

  /**
   * @unfriend
   * @operationId unfriend
   * @description Removes an accepted friendship with the given user.
   * @paramPath userId - The user ID to unfriend.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 404 - {"success": false, "message": "Friendship not found.", "errors": []}
   */
  public async unfriend({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const otherId = Number(params.userId)

    const friendship = await Friendship.query()
      .where('status', 'accepted')
      .andWhere((q) => {
        q.where({ requesterId: me.id, addresseeId: otherId }).orWhere({
          requesterId: otherId,
          addresseeId: me.id,
        })
      })
      .first()

    if (!friendship) {
      return ApiResponse.error(response, 404, 'Friendship not found.')
    }

    await friendship.delete()
    return ApiResponse.ok(response, 'Unfriended.', null)
  }
}

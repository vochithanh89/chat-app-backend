import type { HttpContext } from '@adonisjs/core/http'
import Friendship from '#models/friendship'
import User from '#models/user'
import UserBlock from '#models/user_block'
import { ApiResponse } from '#utils/api_response'
import { sendFriendRequestValidator } from '#validators/friendship'
import notificationService from '#services/notification_service'
import realtimeService from '#services/realtime_service'

/** Look up a user by public UUID. */
async function resolveUser(uuid: string) {
  return User.findBy('uuid', uuid)
}

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
   * @requestBody {"addressee_id": "string"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"friendship": "object"}}
   * @responseBody 400 - {"success": false, "message": "Cannot send request.", "errors": []}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async sendRequest({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { addressee_id: addresseeUuid } =
      await request.validateUsing(sendFriendRequestValidator)

    const target = await resolveUser(addresseeUuid)
    if (!target) {
      return ApiResponse.error(response, 404, 'User not found.')
    }
    const addresseeId = target.id

    if (addresseeId === me.id) {
      return ApiResponse.error(response, 400, 'You cannot send a friend request to yourself.')
    }

    // Refuse if either side has blocked the other.
    const block = await UserBlock.query()
      .where((q) => {
        q.where({ blockerId: me.id, blockedId: addresseeId }).orWhere({
          blockerId: addresseeId,
          blockedId: me.id,
        })
      })
      .first()
    if (block) {
      return ApiResponse.error(response, 400, 'You cannot send a request to this user.')
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
        data: { type: 'friend_request', friendshipId: friendship.uuid },
      })
      .catch(() => {})

    // Realtime fanout to both parties so UI updates instantly. Payloads
    // carry UUIDs only — no internal numeric ids are ever emitted.
    realtimeService.emitToUser(addresseeId, 'friend:request:received', {
      friendshipId: friendship.uuid,
      from: { id: me.uuid, name: me.name, avatarUrl: me.avatarUrl },
      createdAt: friendship.createdAt,
    })
    realtimeService.emitToUser(me.id, 'friend:request:sent', {
      friendshipId: friendship.uuid,
      to: { id: target.uuid, name: target.name, avatarUrl: target.avatarUrl },
      createdAt: friendship.createdAt,
    })

    return ApiResponse.created(response, 'Friend request sent.', { friendship })
  }

  /**
   * @accept
   * @operationId acceptFriendRequest
   * @description Accepts a pending friend request addressed to the current user.
   * @paramPath id - The friendship ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"friendship": "object"}}
   * @responseBody 404 - {"success": false, "message": "Friend request not found.", "errors": []}
   */
  public async accept({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const friendship = await Friendship.query()
      .where('uuid', params.id)
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
        data: { type: 'friend_accepted', friendshipId: friendship.uuid },
      })
      .catch(() => {})

    // Lookup the requester to get their UUID for the broadcast payload.
    const requester = await User.find(friendship.requesterId)

    realtimeService.emitToUser(friendship.requesterId, 'friend:request:accepted', {
      friendshipId: friendship.uuid,
      by: { id: me.uuid, name: me.name, avatarUrl: me.avatarUrl },
    })
    realtimeService.emitToUser(me.id, 'friend:added', {
      friendshipId: friendship.uuid,
      userId: requester?.uuid ?? null,
    })

    return ApiResponse.ok(response, 'Friend request accepted.', { friendship })
  }

  /**
   * @reject
   * @operationId rejectFriendRequest
   * @description Rejects a pending friend request addressed to the current user.
   * @paramPath id - The friendship ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 404 - {"success": false, "message": "Friend request not found.", "errors": []}
   */
  public async reject({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const friendship = await Friendship.query()
      .where('uuid', params.id)
      .andWhere('addressee_id', me.id)
      .andWhere('status', 'pending')
      .first()

    if (!friendship) {
      return ApiResponse.error(response, 404, 'Friend request not found.')
    }

    const requesterId = friendship.requesterId
    const friendshipUuid = friendship.uuid
    await friendship.delete()

    realtimeService.emitToUser(requesterId, 'friend:request:rejected', {
      friendshipId: friendshipUuid,
      by: { id: me.uuid },
    })

    return ApiResponse.ok(response, 'Friend request rejected.', null)
  }

  /**
   * @cancel
   * @operationId cancelFriendRequest
   * @description Cancels a pending friend request previously sent by the current user.
   * @paramPath id - The friendship ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 404 - {"success": false, "message": "Friend request not found.", "errors": []}
   */
  public async cancel({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const friendship = await Friendship.query()
      .where('uuid', params.id)
      .andWhere('requester_id', me.id)
      .andWhere('status', 'pending')
      .first()

    if (!friendship) {
      return ApiResponse.error(response, 404, 'Friend request not found.')
    }

    const addresseeId = friendship.addresseeId
    const friendshipUuid = friendship.uuid
    await friendship.delete()

    realtimeService.emitToUser(addresseeId, 'friend:request:cancelled', {
      friendshipId: friendshipUuid,
      by: { id: me.uuid },
    })

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
        friendshipId: r.uuid,
        id: other.uuid,
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
      friendshipId: r.uuid,
      from: {
        id: r.requester.uuid,
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
      friendshipId: r.uuid,
      to: {
        id: r.addressee.uuid,
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
   * @paramPath userId - The ID of the user to unfriend.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 404 - {"success": false, "message": "Friendship not found.", "errors": []}
   */
  public async unfriend({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const other = await resolveUser(params.userId)
    if (!other) return ApiResponse.error(response, 404, 'User not found.')
    const otherId = other.id

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

    realtimeService.emitToUser(otherId, 'friend:unfriended', { userId: me.uuid })
    realtimeService.emitToUser(me.id, 'friend:unfriended', { userId: other.uuid })

    return ApiResponse.ok(response, 'Unfriended.', null)
  }
}

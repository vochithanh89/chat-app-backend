import type { HttpContext } from '@adonisjs/core/http'
import UserBlock from '#models/user_block'
import User from '#models/user'
import Friendship from '#models/friendship'
import { ApiResponse } from '#utils/api_response'
import { blockUserValidator } from '#validators/user_block'
import realtimeService from '#services/realtime_service'

export default class BlocksController {
  /**
   * @block
   * @operationId blockUser
   * @description Blocks another user. Also deletes any existing friendship or pending request between the two users so neither side can see the other.
   * @requestBody {"user_id": "string"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"block": "object"}}
   * @responseBody 400 - {"success": false, "message": "Cannot block this user.", "errors": []}
   * @responseBody 404 - {"success": false, "message": "User not found.", "errors": []}
   * @responseBody 422 - {"success": false, "message": "Validation failed.", "errors": [{"field": "string", "message": "string"}]}
   */
  public async block({ request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const { user_id: userUuid } = await request.validateUsing(blockUserValidator)

    const target = await User.findBy('uuid', userUuid)
    if (!target) {
      return ApiResponse.error(response, 404, 'User not found.')
    }
    const userId = target.id

    if (userId === me.id) {
      return ApiResponse.error(response, 400, 'You cannot block yourself.')
    }

    const existing = await UserBlock.query()
      .where('blocker_id', me.id)
      .andWhere('blocked_id', userId)
      .first()

    if (existing) {
      return ApiResponse.error(response, 400, 'You have already blocked this user.')
    }

    // Delete any existing friendship (pending or accepted) in either direction.
    await Friendship.query()
      .where((q) => {
        q.where({ requesterId: me.id, addresseeId: userId }).orWhere({
          requesterId: userId,
          addresseeId: me.id,
        })
      })
      .delete()

    const block = await UserBlock.create({
      blockerId: me.id,
      blockedId: userId,
    })

    // Both sides should wipe the other from any in-memory lists. Payloads
    // carry UUIDs only.
    realtimeService.emitToUser(me.id, 'friend:blocked', { userId: target.uuid })
    realtimeService.emitToUser(userId, 'friend:blocked-by', { userId: me.uuid })

    return ApiResponse.created(response, 'User blocked.', { block })
  }

  /**
   * @unblock
   * @operationId unblockUser
   * @description Unblocks a previously blocked user.
   * @paramPath userId - The ID of the user to unblock.
   * @responseBody 200 - {"success": true, "message": "string", "data": {}}
   * @responseBody 404 - {"success": false, "message": "Block not found.", "errors": []}
   */
  public async unblock({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()

    const target = await User.findBy('uuid', params.userId)
    if (!target) return ApiResponse.error(response, 404, 'User not found.')
    const otherId = target.id

    const block = await UserBlock.query()
      .where('blocker_id', me.id)
      .andWhere('blocked_id', otherId)
      .first()

    if (!block) {
      return ApiResponse.error(response, 404, 'Block not found.')
    }

    await block.delete()

    // Tell the unblocker (their other tabs too) and the formerly-blocked
    // user so both sides can refresh their conversation state.
    realtimeService.emitToUser(me.id, 'friend:unblocked', { userId: target.uuid })
    realtimeService.emitToUser(otherId, 'friend:unblocked-by', { userId: me.uuid })

    return ApiResponse.ok(response, 'User unblocked.', null)
  }

  /**
   * @list
   * @operationId listBlockedUsers
   * @description Lists users blocked by the current user.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"blocked": "array"}}
   */
  public async list({ response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const rows = await UserBlock.query()
      .where('blocker_id', me.id)
      .preload('blocked')
      .orderBy('created_at', 'desc')

    const blocked = rows.map((r) => ({
      // No blockId — the pivot row id is internal. Clients identify a
      // blocked user by the user's own UUID.
      id: r.blocked.uuid,
      name: r.blocked.name,
      avatarUrl: r.blocked.avatarUrl,
      bio: r.blocked.bio,
      blockedAt: r.createdAt,
    }))

    return ApiResponse.ok(response, 'OK', { blocked })
  }
}

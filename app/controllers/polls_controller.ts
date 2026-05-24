import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Conversation from '#models/conversation'
import Message from '#models/message'
import Poll from '#models/poll'
import PollOption from '#models/poll_option'
import PollVote from '#models/poll_vote'
import { ApiResponse } from '#utils/api_response'
import { createPollValidator, votePollValidator } from '#validators/poll'
import messageService from '#services/message_service'
import realtime from '#services/realtime_service'

async function resolveConversationByUuid(uuid: string) {
  return Conversation.query().where('uuid', uuid).first()
}

async function resolvePollByUuid(uuid: string) {
  return Poll.query().where('uuid', uuid).first()
}

/** Build the public poll payload with vote counts and the viewer's own selections. */
async function serializePoll(poll: Poll, viewerUserId: number): Promise<Record<string, unknown>> {
  await poll.load((l) => {
    l.load('options', (q) => q.orderBy('position', 'asc').preload('votes'))
    l.load('creator')
  })

  const optionIds = poll.options.map((o) => o.id)
  const myVotes = optionIds.length
    ? await PollVote.query()
        .whereIn('poll_option_id', optionIds)
        .andWhere('user_id', viewerUserId)
    : []
  const mySet = new Set(myVotes.map((v) => v.pollOptionId))

  return {
    id: poll.uuid,
    question: poll.question,
    allowMultiple: poll.allowMultiple,
    isClosed: poll.isClosed,
    createdAt: poll.createdAt,
    createdBy: poll.creator
      ? { id: poll.creator.uuid, name: poll.creator.name, avatarUrl: poll.creator.avatarUrl }
      : null,
    options: poll.options.map((o) => ({
      id: o.uuid,
      text: o.text,
      voteCount: (o as any).votes?.length ?? 0,
      votedByMe: mySet.has(o.id),
    })),
    totalVotes: poll.options.reduce((sum, o) => sum + ((o as any).votes?.length ?? 0), 0),
  }
}

export default class PollsController {
  /**
   * @create
   * @operationId createPoll
   * @description Creates a new poll inside a group conversation. The poll is delivered as a regular message with an attached poll payload.
   * @paramPath conversationId - Conversation ID.
   * @requestBody {"question": "string", "options": "string[]", "allow_multiple": "boolean"}
   * @responseBody 201 - {"success": true, "message": "string", "data": {"poll": "object", "message": "object"}}
   * @responseBody 403 - {"success": false, "message": "Forbidden.", "errors": []}
   */
  public async create({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const conv = await resolveConversationByUuid(params.conversationId)
    if (!conv) return ApiResponse.error(response, 404, 'Conversation not found.')

    const member = await messageService.assertMember(conv.id, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    // Respect comment-restricted groups — a poll is a message too.
    if (
      conv.type === 'group' &&
      conv.commentsRestricted &&
      member.role !== 'owner' &&
      member.role !== 'admin'
    ) {
      return ApiResponse.error(
        response,
        403,
        'Only group owner or admin can post in this group.'
      )
    }

    const {
      question,
      options,
      allow_multiple: allowMultiple,
    } = await request.validateUsing(createPollValidator)

    const { message, poll } = await db.transaction(async (trx) => {
      const m = await Message.create(
        {
          conversationId: conv.id,
          senderId: me.id,
          content: question,
          isRecalled: false,
        },
        { client: trx }
      )
      const p = await Poll.create(
        {
          messageId: m.id,
          conversationId: conv.id,
          createdBy: me.id,
          question,
          allowMultiple: allowMultiple ?? false,
          isClosed: false,
        },
        { client: trx }
      )
      await PollOption.createMany(
        options.map((text, idx) => ({ pollId: p.id, text, position: idx })),
        { client: trx }
      )
      await Conversation.query({ client: trx })
        .where('id', conv.id)
        .update({ lastMessageAt: DateTime.now().toSQL({ includeOffset: false }) })
      return { message: m, poll: p }
    })

    await message.load((l) => l.load('sender').load('attachments').load('reactions'))
    const serializedMsg = await messageService.serialize(message, me.id)
    const serializedPoll = await serializePoll(poll, me.id)

    realtime.emitToConversation(conv.id, 'message:new', {
      ...serializedMsg,
      poll: serializedPoll,
    })

    return ApiResponse.created(response, 'Poll created.', {
      poll: serializedPoll,
      message: serializedMsg,
    })
  }

  /**
   * @show
   * @operationId getPoll
   * @description Returns a poll with options, vote counts and the viewer's own selections.
   * @paramPath id - Poll ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"poll": "object"}}
   */
  public async show({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const poll = await resolvePollByUuid(params.id)
    if (!poll) return ApiResponse.error(response, 404, 'Poll not found.')

    const member = await messageService.assertMember(poll.conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    return ApiResponse.ok(response, 'OK', { poll: await serializePoll(poll, me.id) })
  }

  /**
   * @vote
   * @operationId votePoll
   * @description Casts the current user's vote(s) for a poll. Replaces previous selections (so a single call is idempotent).
   * @paramPath id - Poll ID.
   * @requestBody {"option_ids": "string[]"}
   * @responseBody 200 - {"success": true, "message": "string", "data": {"poll": "object"}}
   */
  public async vote({ params, request, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const poll = await resolvePollByUuid(params.id)
    if (!poll) return ApiResponse.error(response, 404, 'Poll not found.')
    if (poll.isClosed) return ApiResponse.error(response, 400, 'Poll is closed.')

    const member = await messageService.assertMember(poll.conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    const { option_ids: optionUuids } = await request.validateUsing(votePollValidator)

    const options = await PollOption.query()
      .where('poll_id', poll.id)
      .whereIn('uuid', optionUuids)
    if (options.length === 0) {
      return ApiResponse.error(response, 400, 'No valid options.')
    }
    if (!poll.allowMultiple && options.length > 1) {
      return ApiResponse.error(response, 400, 'This poll allows a single choice only.')
    }

    await db.transaction(async (trx) => {
      // Replace the user's prior selections — keeps "vote" idempotent
      // regardless of whether the option is new or already chosen.
      const optionIds = (
        await PollOption.query({ client: trx }).where('poll_id', poll.id).select('id')
      ).map((o) => o.id)
      if (optionIds.length > 0) {
        await PollVote.query({ client: trx })
          .whereIn('poll_option_id', optionIds)
          .andWhere('user_id', me.id)
          .delete()
      }
      await PollVote.createMany(
        options.map((o) => ({ pollOptionId: o.id, userId: me.id })),
        { client: trx }
      )
    })

    const payload = await serializePoll(poll, me.id)
    realtime.emitToConversation(poll.conversationId, 'poll:updated', payload)
    return ApiResponse.ok(response, 'Vote recorded.', { poll: payload })
  }

  /**
   * @unvote
   * @operationId unvotePoll
   * @description Removes all of the current user's votes on a poll.
   * @paramPath id - Poll ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"poll": "object"}}
   */
  public async unvote({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const poll = await resolvePollByUuid(params.id)
    if (!poll) return ApiResponse.error(response, 404, 'Poll not found.')

    const member = await messageService.assertMember(poll.conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    const optionIds = (await PollOption.query().where('poll_id', poll.id).select('id')).map(
      (o) => o.id
    )
    if (optionIds.length > 0) {
      await PollVote.query()
        .whereIn('poll_option_id', optionIds)
        .andWhere('user_id', me.id)
        .delete()
    }

    const payload = await serializePoll(poll, me.id)
    realtime.emitToConversation(poll.conversationId, 'poll:updated', payload)
    return ApiResponse.ok(response, 'Votes cleared.', { poll: payload })
  }

  /**
   * @close
   * @operationId closePoll
   * @description Closes a poll so no more votes are accepted. Creator, owner or admin only.
   * @paramPath id - Poll ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"poll": "object"}}
   */
  public async close({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const poll = await resolvePollByUuid(params.id)
    if (!poll) return ApiResponse.error(response, 404, 'Poll not found.')

    const member = await messageService.assertMember(poll.conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    const isPrivileged = member.role === 'owner' || member.role === 'admin'
    if (!isPrivileged && poll.createdBy !== me.id) {
      return ApiResponse.error(response, 403, 'Only the creator or a group admin can close a poll.')
    }

    poll.isClosed = true
    await poll.save()

    const payload = await serializePoll(poll, me.id)
    realtime.emitToConversation(poll.conversationId, 'poll:updated', payload)
    return ApiResponse.ok(response, 'Poll closed.', { poll: payload })
  }

  /**
   * @voters
   * @operationId listPollVoters
   * @description Lists users who voted for each option of a poll.
   * @paramPath id - Poll ID.
   * @responseBody 200 - {"success": true, "message": "string", "data": {"options": "array"}}
   */
  public async voters({ params, response, auth }: HttpContext) {
    const me = auth.use('jwt').getUserOrFail()
    const poll = await resolvePollByUuid(params.id)
    if (!poll) return ApiResponse.error(response, 404, 'Poll not found.')

    const member = await messageService.assertMember(poll.conversationId, me.id)
    if (!member) return ApiResponse.error(response, 403, 'Not a member.')

    const options = await PollOption.query()
      .where('poll_id', poll.id)
      .orderBy('position', 'asc')
      .preload('votes', (q) => q.preload('user'))

    const out = options.map((o) => ({
      id: o.uuid,
      text: o.text,
      voters: o.votes.map((v) => ({
        id: (v as any).user?.uuid ?? null,
        name: (v as any).user?.name ?? null,
        avatarUrl: (v as any).user?.avatarUrl ?? null,
        votedAt: v.createdAt,
      })),
    }))

    return ApiResponse.ok(response, 'OK', { options: out })
  }
}

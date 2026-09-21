import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { userErrorHandler } from '../userErrorHandler'
import { followUserParamsSchema } from '../userSchemas'
import { withdrawNotification } from '../../notification/notify'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

// Unfollow, or cancel a pending follow request. Idempotent.
// The Follow row is deleted rather than soft-removed: readers such as
// getUserById only check isPending / isBlocked, so a leftover row would
// keep granting access to private profiles.
const unfollowRoute: FastifyPluginAsync = async (fastify) => {
  fastify.delete(
    '/follow/:userId',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const me = req.user

      try {
        const result = followUserParamsSchema.safeParse(req.params)
        if (!result.success) throw result.error
        const { userId: targetId } = result.data

        await fastify.prisma.$transaction(async (tx) => {
          const now = new Date()
          const unfollowed = await tx.follow.deleteMany({
            where: { followerId: me.id, followingId: targetId },
          })
          const cancelled = await tx.followRequest.updateMany({
            where: {
              senderId: me.id,
              receiverId: targetId,
              status: 'PENDING',
            },
            data: { status: 'CANCELLED', isCancelled: true, cancelledAt: now },
          })

          const actions = [
            ...(unfollowed.count ? (['UNFOLLOW'] as const) : []),
            ...(cancelled.count ? (['FOLLOW_REQUEST_CANCELLED'] as const) : []),
          ]
          if (actions.length) {
            await tx.userActivityLog.createMany({
              data: actions.map((action) => ({
                userId: me.id,
                action,
                metadata: { targetUserId: targetId },
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] ?? null,
              })),
            })
          }
        })

        req.log.info({ userId: me.id, targetId }, 'Unfollowed')
        await withdrawNotification(fastify, {
          recipientId: targetId,
          actorId: me.id,
          type: 'follow_request',
        })
        return reply.send({ success: true, data: { status: 'none' } })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'unfollow',
          userId: me.id,
        })
      }
    },
  )
}

export default unfollowRoute

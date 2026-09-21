import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { userErrorHandler } from '../userErrorHandler'
import { followRequestParamsSchema } from '../userSchemas'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

const notPending = {
  statusCode: 409,
  code: 'conflictError',
  message: 'Follow request is no longer pending',
}

// POST /follow-requests/:requestId/accept | /reject (receiver only)
const respondToFollowRequestRoute: FastifyPluginAsync = async (fastify) => {
  for (const action of ['accept', 'reject'] as const) {
    fastify.post(
      `/follow-requests/:requestId/${action}`,
      { preHandler: fastify.authenticate },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const req = request as AuthenticatedRequest
        const me = req.user

        try {
          const result = followRequestParamsSchema.safeParse(req.params)
          if (!result.success) throw result.error
          const { requestId } = result.data

          const followRequest = await fastify.prisma.followRequest.findUnique({
            where: { id: requestId },
          })
          // Someone else's request is reported as missing, not forbidden
          if (!followRequest || followRequest.receiverId !== me.id) {
            throw {
              statusCode: 404,
              code: 'notFoundError',
              message: 'Follow request not found',
            }
          }
          if (followRequest.status !== 'PENDING') throw notPending

          await fastify.prisma.$transaction(async (tx) => {
            const now = new Date()
            // Conditional update: of two simultaneous responses, only one wins
            const { count } = await tx.followRequest.updateMany({
              where: { id: requestId, status: 'PENDING' },
              data:
                action === 'accept'
                  ? { status: 'ACCEPTED', isAccepted: true, respondedAt: now }
                  : { status: 'REJECTED', isRejected: true, respondedAt: now },
            })
            if (!count) throw notPending

            if (action === 'accept') {
              const pair = {
                followerId: followRequest.senderId,
                followingId: me.id,
              }
              await tx.follow.upsert({
                where: { followerId_followingId: pair },
                create: {
                  ...pair,
                  followerUsername: followRequest.senderUsername,
                  followerFullName: followRequest.senderFullName,
                  followerImage: followRequest.senderImage,
                },
                update: {},
              })
            }

            await tx.userActivityLog.create({
              data: {
                userId: me.id,
                action:
                  action === 'accept'
                    ? 'FOLLOW_REQUEST_ACCEPTED'
                    : 'FOLLOW_REQUEST_DECLINED',
                metadata: { requestId, senderId: followRequest.senderId },
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] ?? null,
              },
            })
          })

          req.log.info(
            { userId: me.id, requestId },
            `Follow request ${action}ed`,
          )
          return reply.send({
            success: true,
            data: { status: action === 'accept' ? 'accepted' : 'rejected' },
          })
        } catch (err) {
          return userErrorHandler(req, reply, err, {
            action: `${action}FollowRequest`,
            userId: me.id,
          })
        }
      },
    )
  }
}

export default respondToFollowRequestRoute

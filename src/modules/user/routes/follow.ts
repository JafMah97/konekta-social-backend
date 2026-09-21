import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { Prisma } from '@prisma/client'
import { userErrorHandler } from '../userErrorHandler'
import { followUserParamsSchema } from '../userSchemas'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

// Two identical requests at the same moment both pass the "already
// following?" check; the loser hits the unique constraint. Its caller wanted
// exactly what the winner created, so that is a success, not an error.
async function ignoreDuplicate(write: Promise<unknown>): Promise<void> {
  try {
    await write
  } catch (err) {
    const duplicate =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    if (!duplicate) throw err
  }
}

// Public account → follow immediately. Private account → follow request.
// Idempotent: repeating the call returns the current status.
const followRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/follow/:userId',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const me = req.user

      try {
        const result = followUserParamsSchema.safeParse(req.params)
        if (!result.success) throw result.error
        const { userId: targetId } = result.data

        if (targetId === me.id) {
          throw {
            statusCode: 400,
            code: 'invalidAction',
            message: 'You cannot follow yourself',
          }
        }

        const target = await fastify.prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true, isPrivate: true, isActive: true, isBanned: true },
        })
        if (!target || !target.isActive || target.isBanned) {
          throw {
            statusCode: 404,
            code: 'notFoundError',
            message: 'User not found',
          }
        }

        const pair = { followerId: me.id, followingId: targetId }
        const existing = await fastify.prisma.follow.findUnique({
          where: { followerId_followingId: pair },
          select: { id: true },
        })
        if (existing) {
          return reply.send({ success: true, data: { status: 'following' } })
        }

        const activity = (
          action: 'FOLLOW' | 'FOLLOW_REQUEST_SENT',
        ): Prisma.UserActivityLogCreateArgs => ({
          data: {
            userId: me.id,
            action,
            metadata: { targetUserId: targetId },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        })

        if (target.isPrivate) {
          const pendingPair = { senderId: me.id, receiverId: targetId }
          const pending = await fastify.prisma.followRequest.findUnique({
            where: { senderId_receiverId: pendingPair },
            select: { status: true },
          })
          if (pending?.status === 'PENDING') {
            return reply.send({ success: true, data: { status: 'requested' } })
          }

          // A rejected / cancelled request can be sent again
          const sender = {
            senderUsername: me.username,
            senderFullName: me.fullName,
            senderImage: me.profileImage,
          }
          await ignoreDuplicate(
            fastify.prisma.$transaction([
              fastify.prisma.followRequest.upsert({
                where: { senderId_receiverId: pendingPair },
                create: { ...pendingPair, ...sender },
                update: {
                  ...sender,
                  status: 'PENDING',
                  sentAt: new Date(),
                  respondedAt: null,
                  isAccepted: false,
                  isRejected: false,
                  isCancelled: false,
                  cancelledAt: null,
                },
              }),
              fastify.prisma.userActivityLog.create(
                activity('FOLLOW_REQUEST_SENT'),
              ),
            ]),
          )

          req.log.info({ userId: me.id, targetId }, 'Follow request sent')
          return reply.send({ success: true, data: { status: 'requested' } })
        }

        await ignoreDuplicate(
          fastify.prisma.$transaction([
            fastify.prisma.follow.upsert({
              where: { followerId_followingId: pair },
              create: {
                ...pair,
                followerUsername: me.username,
                followerFullName: me.fullName,
                followerImage: me.profileImage,
              },
              update: {},
            }),
            fastify.prisma.userActivityLog.create(activity('FOLLOW')),
          ]),
        )

        req.log.info({ userId: me.id, targetId }, 'User followed')
        return reply.send({ success: true, data: { status: 'following' } })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'follow',
          userId: me.id,
        })
      }
    },
  )
}

export default followRoute

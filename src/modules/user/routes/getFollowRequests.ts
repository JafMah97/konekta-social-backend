import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { userErrorHandler } from '../userErrorHandler'
import { listFollowRequestsSchema } from '../userSchemas'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

// Pending follow requests sent to the current user, newest first
const getFollowRequestsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/follow-requests',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const me = req.user

      try {
        const result = listFollowRequestsSchema.safeParse(req.query)
        if (!result.success) throw result.error
        const { page, limit } = result.data

        const where = { receiverId: me.id, status: 'PENDING' as const }
        const [requests, total] = await Promise.all([
          fastify.prisma.followRequest.findMany({
            where,
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
            select: {
              id: true,
              sentAt: true,
              sender: {
                select: {
                  id: true,
                  username: true,
                  fullName: true,
                  profileImage: true,
                  bio: true,
                },
              },
            },
          }),
          fastify.prisma.followRequest.count({ where }),
        ])

        return reply.send({
          success: true,
          data: {
            requests,
            pagination: {
              page,
              limit,
              total,
              pages: Math.ceil(total / limit),
            },
          },
        })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'getFollowRequests',
          userId: me.id,
        })
      }
    },
  )
}

export default getFollowRequestsRoute

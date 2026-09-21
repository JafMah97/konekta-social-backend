import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { userErrorHandler } from '../../user/userErrorHandler'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

// Cheap badge count, e.g. polled on app start before the socket connects
const unreadCountRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/unread-count',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const userId = req.user.id

      try {
        const unreadCount = await fastify.prisma.notification.count({
          where: { userId, isDeleted: false, isRead: false },
        })
        return reply.send({ success: true, data: { unreadCount } })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'unreadNotificationCount',
          userId,
        })
      }
    },
  )
}

export default unreadCountRoute

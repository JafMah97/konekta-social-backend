import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { userErrorHandler } from '../../user/userErrorHandler'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

const markAllReadRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/read-all',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const userId = req.user.id

      try {
        const { count } = await fastify.prisma.notification.updateMany({
          where: { userId, isDeleted: false, isRead: false },
          data: { isRead: true, readAt: new Date() },
        })
        return reply.send({ success: true, data: { marked: count } })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'markAllNotificationsRead',
          userId,
        })
      }
    },
  )
}

export default markAllReadRoute

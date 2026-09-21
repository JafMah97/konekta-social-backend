import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { userErrorHandler } from '../../user/userErrorHandler'
import { notificationParamsSchema } from '../notificationSchemas'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

const markReadRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/:notificationId/read',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const userId = req.user.id

      try {
        const result = notificationParamsSchema.safeParse(req.params)
        if (!result.success) throw result.error
        const { notificationId } = result.data

        // Scoped to the owner: someone else's notification is "not found"
        const owned = { id: notificationId, userId, isDeleted: false }
        const { count } = await fastify.prisma.notification.updateMany({
          where: { ...owned, isRead: false },
          data: { isRead: true, readAt: new Date() },
        })
        if (!count) {
          const exists = await fastify.prisma.notification.count({
            where: owned,
          })
          if (!exists) {
            throw {
              statusCode: 404,
              code: 'notFoundError',
              message: 'Notification not found',
            }
          }
        }

        return reply.send({ success: true, data: { isRead: true } })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'markNotificationRead',
          userId,
        })
      }
    },
  )
}

export default markReadRoute

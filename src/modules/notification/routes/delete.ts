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

const deleteNotificationRoute: FastifyPluginAsync = async (fastify) => {
  fastify.delete(
    '/:notificationId',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const userId = req.user.id

      try {
        const result = notificationParamsSchema.safeParse(req.params)
        if (!result.success) throw result.error
        const { notificationId } = result.data

        const { count } = await fastify.prisma.notification.updateMany({
          where: { id: notificationId, userId, isDeleted: false },
          data: { isDeleted: true, deletedAt: new Date() },
        })
        if (!count) {
          throw {
            statusCode: 404,
            code: 'notFoundError',
            message: 'Notification not found',
          }
        }

        return reply.send({ success: true, data: { deleted: true } })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'deleteNotification',
          userId,
        })
      }
    },
  )
}

export default deleteNotificationRoute

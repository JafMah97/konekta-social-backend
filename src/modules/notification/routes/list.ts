import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { userErrorHandler } from '../../user/userErrorHandler'
import { listNotificationsSchema } from '../notificationSchemas'
import { notificationSelect } from '../notify'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

const listNotificationsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/',
    { preHandler: fastify.authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const userId = req.user.id

      try {
        const result = listNotificationsSchema.safeParse(req.query)
        if (!result.success) throw result.error
        const { page, limit, unreadOnly } = result.data

        const visible = { userId, isDeleted: false }
        const where = unreadOnly ? { ...visible, isRead: false } : visible

        const [notifications, total, unreadCount] = await Promise.all([
          fastify.prisma.notification.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
            select: notificationSelect,
          }),
          fastify.prisma.notification.count({ where }),
          fastify.prisma.notification.count({
            where: { ...visible, isRead: false },
          }),
        ])

        return reply.send({
          success: true,
          data: {
            notifications,
            unreadCount,
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
          action: 'listNotifications',
          userId,
        })
      }
    },
  )
}

export default listNotificationsRoute

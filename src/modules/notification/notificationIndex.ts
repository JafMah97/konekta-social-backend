import { type FastifyPluginAsync } from 'fastify'
import listNotificationsRoute from './routes/list'
import unreadCountRoute from './routes/unreadCount'
import markReadRoute from './routes/markRead'
import markAllReadRoute from './routes/markAllRead'
import deleteNotificationRoute from './routes/delete'

const notificationIndex: FastifyPluginAsync = async (fastify) => {
  fastify.register(listNotificationsRoute, { prefix: '/notifications' })
  fastify.register(unreadCountRoute, { prefix: '/notifications' })
  fastify.register(markReadRoute, { prefix: '/notifications' })
  fastify.register(markAllReadRoute, { prefix: '/notifications' })
  fastify.register(deleteNotificationRoute, { prefix: '/notifications' })
}

export default notificationIndex

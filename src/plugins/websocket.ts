/* eslint-disable no-unused-vars */
import fp from 'fastify-plugin'
import { Server, type Socket } from 'socket.io'
import { type FastifyInstance } from 'fastify'
import chalk from 'chalk'

declare module 'fastify' {
  interface FastifyInstance {
    io: Server
    sendNotification: (userId: string, payload: object) => void
    disconnectSession: (sessionId: string) => void
    disconnectUser: (userId: string, exceptSessionId?: string) => void
  }
}

interface SocketData {
  userId: string
  sessionId: string
}

// A user can have several tabs/devices open, so sockets are addressed
// through rooms rather than a single socket per user.
const userRoom = (userId: string) => `user:${userId}`
const sessionRoom = (sessionId: string) => `session:${sessionId}`

// Browsers send the httpOnly `token` cookie with the handshake;
// non-browser clients can pass it as `io(url, { auth: { token } })`.
function getHandshakeToken(
  fastify: FastifyInstance,
  socket: Socket,
): string | undefined {
  const authToken = socket.handshake.auth?.token
  if (typeof authToken === 'string' && authToken) return authToken

  const cookieHeader = socket.handshake.headers.cookie
  return cookieHeader ? fastify.parseCookie(cookieHeader).token : undefined
}

export default fp(
  async (fastify: FastifyInstance) => {
    // Decide which origin to allow based on NODE_ENV
    const NODE_ENV = process.env.NODE_ENV || 'development'
    const allowedOrigin =
      NODE_ENV === 'production'
        ? process.env.PROD_ORIGIN
        : process.env.DEV_ORIGIN || 'http://localhost:3000'

    const io = new Server(fastify.server, {
      cors: {
        origin: allowedOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
      },
    })

    fastify.decorate('io', io)

    // Reject the handshake unless it carries a token with a live session,
    // exactly like the HTTP `authenticate` hook.
    io.use(async (socket, next) => {
      const token = getHandshakeToken(fastify, socket)
      if (!token) {
        return next(new Error('Authentication token missing'))
      }

      try {
        const { user, sessionId } = await fastify.verifySession(token)
        socket.data = { userId: user.id, sessionId } satisfies SocketData
        next()
      } catch (err) {
        next(new Error((err as Error).message || 'Unauthorized'))
      }
    })

    fastify.decorate('sendNotification', (userId: string, payload: object) => {
      io.to(userRoom(userId)).emit('notification', payload)
      fastify.log.info(chalk.green(`Notification emitted to user ${userId}`))
    })

    fastify.decorate('disconnectSession', (sessionId: string) => {
      io.in(sessionRoom(sessionId)).disconnectSockets(true)
    })

    fastify.decorate(
      'disconnectUser',
      (userId: string, exceptSessionId?: string) => {
        const target = exceptSessionId
          ? io.in(userRoom(userId)).except(sessionRoom(exceptSessionId))
          : io.in(userRoom(userId))
        target.disconnectSockets(true)
      },
    )

    io.on('connection', (socket: Socket) => {
      const { userId, sessionId } = socket.data as SocketData

      socket.join([userRoom(userId), sessionRoom(sessionId)])

      fastify.log.info(
        chalk.green(`Socket.IO connection opened for user ${userId}`),
      )

      socket.on('disconnect', () => {
        fastify.log.info(
          chalk.blue(`Socket.IO connection closed for user ${userId}`),
        )
      })
    })

    fastify.log.info(chalk.cyan('Socket.IO plugin registered'))
  },
  { name: 'websocket', dependencies: ['@fastify/cookie', 'authenticate'] },
)

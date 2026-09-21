// authenticate.ts
import fp from 'fastify-plugin'
import { type FastifyPluginAsync } from 'fastify'
import jwt from 'jsonwebtoken'
import chalk from 'chalk'

interface JwtPayload {
  id: string
  iat: number
  exp: number
}

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_backup'

const authenticate: FastifyPluginAsync = async (fastify) => {
  // Shared by HTTP requests and Socket.IO handshakes
  fastify.decorate('verifySession', async (token: string) => {
    let payload: JwtPayload
    try {
      payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    } catch (err) {
      fastify.log.warn(
        chalk.yellow(`Token verification failed: ${(err as Error).message}`),
      )
      throw fastify.httpErrors.unauthorized('Token is invalid or expired')
    }

    // A valid signature is not enough: the token must still have a live
    // session row, so logout / password changes can revoke it immediately.
    const session = await fastify.prisma.session.findUnique({
      where: { token },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            profileImage: true,
            fullName: true,
            isPrivate: true,
            isProfileComplete: true,
            emailVerified: true,
            createdAt: true,
            updatedAt: true,
            isActive: true,
          },
        },
      },
    })

    if (!session || session.userId !== payload.id) {
      throw fastify.httpErrors.unauthorized('Session has been revoked')
    }

    if (session.expiresAt <= new Date()) {
      throw fastify.httpErrors.unauthorized('Session has expired')
    }

    return {
      sessionId: session.id,
      user: { ...session.user, iat: payload.iat, exp: payload.exp },
    }
  })

  fastify.decorate('authenticate', async (req) => {
    const token =
      req.cookies?.token || req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      throw fastify.httpErrors.unauthorized('Authentication token missing')
    }

    const { sessionId, user } = await fastify.verifySession(token)

    req.user = user
    req.sessionId = sessionId

    req.log.info(chalk.green(`Authenticated user ${user.username}`))
  })

  fastify.decorate('authenticateOptional', async (req, rep) => {
    try {
      await fastify.authenticate(req, rep)
    } catch {
      // Silent fallback for guest access
      req.user = undefined
    }
  })

  fastify.log.info(chalk.cyan('JWT authentication plugin registered'))
}

export default fp(authenticate, { name: 'authenticate' })

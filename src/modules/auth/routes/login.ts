import bcrypt from 'bcrypt'
import { prisma } from '../../../plugins/client'
import { loginSchema } from '../authSchemas'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { comparePassword } from '../../../utils/hash'
import { startSession } from '../../../utils/session'
import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'

// Unknown emails still run one bcrypt comparison, so response time doesn't
// reveal which addresses have accounts
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

// An unverified email does not block login; the client can show a
// "verify your email" prompt based on `emailVerified`.
const loginRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/login',
    { config: { rateLimit: authRateLimits.login } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const context = { action: 'login', field: 'email' }

      try {
        const result = loginSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const { email, password } = result.data

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            username: true,
            email: true,
            passwordHash: true,
            emailVerified: true,
          },
        })

        const valid = await comparePassword(
          password,
          user?.passwordHash ?? DUMMY_HASH,
        )
        if (!user || !valid) {
          throw fastify.httpErrors.unauthorized('Invalid email or password.')
        }

        await startSession(prisma, request, reply, user)

        return reply.send({
          id: user.id,
          username: user.username,
          emailVerified: user.emailVerified,
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, context)
      }
    },
  )
}

export default loginRoute

import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { registerSchema } from '../authSchemas'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { hashPassword } from '../../../utils/hash'
import { prisma } from '../../../plugins/client'
import { issueSecret } from '../../../utils/tokens'
import { startSession } from '../../../utils/session'
import { sendVerificationEmail } from '../../../utils/mailer'

// Creates the account and signs the user in straight away. A verification
// email (code + link) is sent, but an unverified email does not block login.
const registerRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/register',
    { config: { rateLimit: authRateLimits.register } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = registerSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const { username, email, password, fullName } = result.data

        const userByUsername = await prisma.user.findFirst({
          where: { username },
          select: { username: true },
        })
        if (userByUsername) {
          throw {
            statusCode: 409,
            code: 'conflictError',
            message: 'Username already taken',
            details: [{ field: 'username', message: 'Already exists' }],
          }
        }

        const userByEmail = await prisma.user.findFirst({
          where: { email },
          select: { email: true },
        })
        if (userByEmail) {
          throw {
            statusCode: 409,
            code: 'conflictError',
            message: 'Email already registered',
            details: [{ field: 'email', message: 'Already exists' }],
          }
        }

        const user = await prisma.user.create({
          data: {
            username,
            email,
            fullName,
            passwordHash: await hashPassword(password),
            emailVerified: false,
            isPrivate: false,
          },
          select: { id: true, username: true, email: true },
        })

        const secret = await issueSecret(prisma, user.id, 'EMAIL', {
          withCode: true,
        })
        await startSession(prisma, request, reply, user)

        // Best-effort: a mail outage must not fail a registration that worked
        const verificationEmailSent = await sendVerificationEmail(email, {
          token: secret.token,
          code: secret.code!,
        })

        return reply.status(201).send({
          message: 'User registered and logged in successfully.',
          id: user.id,
          username: user.username,
          email: user.email,
          emailVerified: false,
          verificationEmailSent,
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'register',
          field: 'username or email',
        })
      }
    },
  )
}

export default registerRoute

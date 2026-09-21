import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { prisma } from '../../../plugins/client'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { forgotPasswordSchema } from '../authSchemas'
import { issueSecret } from '../../../utils/tokens'
import { sendPasswordResetEmail } from '../../../utils/mailer'

// Always the same answer, and the email is sent without awaiting, so neither
// the response nor its timing (nor a mail outage) reveals whether the address
// has an account. A new request replaces any earlier reset link.
const forgotPasswordRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/forgot-password',
    { config: { rateLimit: authRateLimits.sendEmail } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = forgotPasswordSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const user = await prisma.user.findUnique({
          where: { email: result.data.email },
          select: { id: true, email: true },
        })

        if (user) {
          const { token } = await issueSecret(prisma, user.id, 'PASSWORD_RESET')
          void sendPasswordResetEmail(user.email, token)
        }

        return reply.send({
          message:
            'If a user with that email exists, a password reset link has been sent.',
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'request_password_reset',
          field: 'email',
        })
      }
    },
  )
}

export default forgotPasswordRoute

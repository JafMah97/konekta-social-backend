import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { prisma } from '../../../plugins/client'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { resendVerificationSchema } from '../authSchemas'
import { issueSecret } from '../../../utils/tokens'
import { sendVerificationEmail } from '../../../utils/mailer'

// Same answer whether or not the account exists or is already verified, and
// the email is sent without awaiting so response time doesn't tell either.
// The new code and link replace the previous ones.
const resendVerificationEmailRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/resend-verification',
    { config: { rateLimit: authRateLimits.sendEmail } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = resendVerificationSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const { email } = result.data
        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, emailVerified: true },
        })

        if (user && !user.emailVerified) {
          const secret = await issueSecret(prisma, user.id, 'EMAIL', {
            withCode: true,
          })
          void sendVerificationEmail(email, {
            token: secret.token,
            code: secret.code!,
          })
        }

        return reply.send({
          message:
            'If that account exists and is not verified yet, a new verification email has been sent.',
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'resend_verification_email',
          field: 'email',
        })
      }
    },
  )
}

export default resendVerificationEmailRoute

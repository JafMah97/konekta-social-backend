import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { prisma } from '../../../plugins/client'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { verifyEmailWithLinkSchema } from '../authSchemas'
import { consumeToken } from '../../../utils/tokens'
import { startSession } from '../../../utils/session'

const verifyEmailWithLink: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/verify-email-with-link',
    { config: { rateLimit: authRateLimits.verifyEmail } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = verifyEmailWithLinkSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const userId = await consumeToken(prisma, 'EMAIL', result.data.token)
        if (!userId) {
          throw {
            statusCode: 400,
            code: 'invalidToken',
            message: 'Invalid or expired verification link.',
            details: [{ field: 'token', message: 'Invalid or expired' }],
          }
        }

        const user = await prisma.user.update({
          where: { id: userId },
          data: { emailVerified: true },
          select: { id: true, email: true, username: true },
        })
        await startSession(prisma, request, reply, user)

        request.log.info({ userId }, '[VerifyEmailWithLink] verified')
        return reply.send({
          message: 'Email verified and logged in successfully.',
          user,
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'verify_email_with_link',
          field: 'token',
        })
      }
    },
  )
}

export default verifyEmailWithLink

import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { prisma } from '../../../plugins/client'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { magicLinkRequestSchema, magicLinkVerifySchema } from '../authSchemas'
import { consumeToken, issueSecret } from '../../../utils/tokens'
import { startSession } from '../../../utils/session'
import { sendMagicLinkEmail } from '../../../utils/mailer'

// Passwordless sign-in: request a link by email, then redeem it once.
const magicLinkRoutes: FastifyPluginAsync = async (fastify) => {
  // Same answer (and no awaited send) whether or not the account exists
  fastify.post(
    '/magic-link',
    { config: { rateLimit: authRateLimits.sendEmail } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = magicLinkRequestSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const user = await prisma.user.findUnique({
          where: { email: result.data.email },
          select: { id: true, email: true, isActive: true, isBanned: true },
        })

        if (user && user.isActive && !user.isBanned) {
          const { token } = await issueSecret(prisma, user.id, 'MAGIC_LINK')
          void sendMagicLinkEmail(user.email, token)
        }

        return reply.send({
          message:
            'If an account exists for that email, a sign-in link has been sent.',
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'request_magic_link',
          field: 'email',
        })
      }
    },
  )

  fastify.post(
    '/magic-link/verify',
    { config: { rateLimit: authRateLimits.verifyEmail } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = magicLinkVerifySchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const invalid = {
          statusCode: 400,
          code: 'invalidToken',
          message: 'Invalid or expired sign-in link.',
          details: [{ field: 'token', message: 'Invalid or expired' }],
        }

        const userId = await consumeToken(
          prisma,
          'MAGIC_LINK',
          result.data.token,
        )
        if (!userId) throw invalid

        // Opening the emailed link also proves the address
        const user = await prisma.user.update({
          where: { id: userId },
          data: { emailVerified: true },
          select: {
            id: true,
            email: true,
            username: true,
            isActive: true,
            isBanned: true,
          },
        })
        if (!user.isActive || user.isBanned) throw invalid

        await startSession(prisma, request, reply, user)

        request.log.info({ userId }, '[MagicLink] signed in')
        return reply.send({
          message: 'Signed in successfully.',
          id: user.id,
          username: user.username,
          email: user.email,
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'verify_magic_link',
          field: 'token',
        })
      }
    },
  )
}

export default magicLinkRoutes

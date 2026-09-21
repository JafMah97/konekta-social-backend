import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { prisma } from '../../../plugins/client'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { verifyEmailWithCodeSchema } from '../authSchemas'
import { consumeCode } from '../../../utils/tokens'
import { startSession } from '../../../utils/session'

// One generic error for unknown email, wrong code, expired code or an already
// verified account: the response must not reveal which accounts exist.
const invalidCode = {
  statusCode: 400,
  code: 'invalidCode',
  message: 'Invalid or expired verification code.',
  details: [{ field: 'code', message: 'Invalid or expired' }],
}

const verifyEmailWithCode: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/verify-email-with-code',
    { config: { rateLimit: authRateLimits.verifyEmail } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = verifyEmailWithCodeSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const { email, code } = result.data

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, username: true, email: true },
        })
        if (!user || !(await consumeCode(prisma, user.id, 'EMAIL', code))) {
          throw invalidCode
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        })
        await startSession(prisma, request, reply, user)

        request.log.info({ userId: user.id }, '[VerifyEmailWithCode] verified')
        return reply.send({
          message: 'Email verified and logged in successfully.',
          id: user.id,
          username: user.username,
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'verify_email_with_code',
          field: 'email or code',
        })
      }
    },
  )
}

export default verifyEmailWithCode

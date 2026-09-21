import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { prisma } from '../../../plugins/client'
import { authErrorHandler } from '../authErrorHandler'
import { authRateLimits } from '../authRateLimits'
import { resetPasswordSchema } from '../authSchemas'
import { hashPassword } from '../../../utils/hash'
import { consumeToken } from '../../../utils/tokens'
import { sendPasswordChangedEmail } from '../../../utils/mailer'

const resetPasswordRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/reset-password',
    { config: { rateLimit: authRateLimits.resetPassword } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = resetPasswordSchema.safeParse(request.body)
        if (!result.success) {
          throw result.error
        }

        const { token, newPassword } = result.data
        const passwordHash = await hashPassword(newPassword)

        const userId = await consumeToken(prisma, 'PASSWORD_RESET', token)
        if (!userId) {
          throw {
            statusCode: 401,
            code: 'invalidToken',
            message: 'Password reset token is invalid or has expired.',
            details: [{ field: 'token', message: 'Invalid or expired token' }],
          }
        }

        // Reset implies the account may be compromised: sign out every
        // device. Following the emailed link also proves the address.
        const [user] = await prisma.$transaction([
          prisma.user.update({
            where: { id: userId },
            data: { passwordHash, emailVerified: true },
            select: { email: true },
          }),
          prisma.session.deleteMany({ where: { userId } }),
        ])
        fastify.disconnectUser(userId)
        void sendPasswordChangedEmail(user.email, { viaReset: true })

        request.log.info({ userId }, '[ResetPassword] password reset')
        return reply.send({
          message: 'Password has been reset successfully.',
        })
      } catch (err) {
        return authErrorHandler(request, reply, err, {
          action: 'reset_password',
          field: 'token or password',
        })
      }
    },
  )
}

export default resetPasswordRoute

import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import type { Prisma } from '@prisma/client'
import { changeEmailSchema } from '../userSchemas'
import { userErrorHandler } from '../userErrorHandler'
import { comparePassword } from '../../../utils/hash'
import { issueSecret } from '../../../utils/tokens'
import { sendEmailChangeVerification } from '../../../utils/mailer'
import { forbidDemoAccount } from '../../../utils/demoAccount'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

// The new address is only *pending* until confirmed (POST /user/verify-new-Email).
// The current email keeps working meanwhile, so a typo or an unreachable
// inbox can no longer lock the user out.
const changeEmailRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/change-email',
    { preHandler: [fastify.authenticate, forbidDemoAccount] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const userId = req.user.id
      try {
        const parseResult = changeEmailSchema.safeParse(req.body)
        if (!parseResult.success) throw parseResult.error
        const { newEmail, password } = parseResult.data

        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, passwordHash: true },
        })
        if (!user) {
          throw {
            statusCode: 404,
            code: 'notFoundError',
            message: 'User not found',
          }
        }

        if (!(await comparePassword(password, user.passwordHash))) {
          throw {
            statusCode: 400,
            code: 'validationError',
            message: 'Password is incorrect',
            details: [{ field: 'password', message: 'Incorrect password' }],
          }
        }

        if (newEmail.toLowerCase() === user.email.toLowerCase()) {
          throw {
            statusCode: 400,
            code: 'validationError',
            message: 'That is already your email address',
            details: [{ field: 'newEmail', message: 'Same as current email' }],
          }
        }

        const existingUser = await fastify.prisma.user.findFirst({
          where: { email: newEmail, id: { not: userId } },
          select: { id: true },
        })
        if (existingUser) {
          throw {
            statusCode: 409,
            code: 'conflictError',
            message: 'Email already in use',
            details: [
              { field: 'newEmail', message: 'Email is already registered' },
            ],
          }
        }

        const secret = await fastify.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: userId },
            data: { pendingEmail: newEmail },
          })
          await tx.userActivityLog.create({
            data: {
              userId,
              action: 'EMAIL_VERIFICATION',
              metadata: {
                step: 'requested',
                newEmail,
              } as Prisma.InputJsonValue,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'] ?? null,
            },
          })
          return issueSecret(tx, userId, 'EMAIL_CHANGE', { withCode: true })
        })

        const verificationSent = await sendEmailChangeVerification(newEmail, {
          token: secret.token,
          code: secret.code!,
        })

        return reply.send({
          success: true,
          message:
            'Confirm the new address to finish. Your current email stays active until then.',
          data: {
            email: user.email,
            pendingEmail: newEmail,
            verificationSent,
          },
        })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'changeEmail',
          userId,
        })
      }
    },
  )
}

export default changeEmailRoute

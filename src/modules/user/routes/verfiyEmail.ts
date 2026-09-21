import {
  type FastifyPluginAsync,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import type { Prisma } from '@prisma/client'
import { userErrorHandler } from '../userErrorHandler'
import { verifyEmailSchema } from '../userSchemas'
import { consumeCode, consumeToken } from '../../../utils/tokens'
import { sendEmailChangedNotice } from '../../../utils/mailer'
import { forbidDemoAccount } from '../../../utils/demoAccount'

interface AuthenticatedRequest extends FastifyRequest {
  user: NonNullable<FastifyRequest['user']>
}

// Confirms a pending email change (see change-email) with the emailed link
// token or code. Only the signed-in user's own secret is accepted.
const verifyEmailRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/verify-new-Email',
    { preHandler: [fastify.authenticate, forbidDemoAccount] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as AuthenticatedRequest
      const userId = req.user.id
      try {
        const parseResult = verifyEmailSchema.safeParse(req.body)
        if (!parseResult.success) throw parseResult.error
        const { token, code } = parseResult.data

        if (!token && !code) {
          throw {
            statusCode: 400,
            code: 'validationError',
            message: 'Either token or code is required',
            details: [
              { field: 'token|code', message: 'Provide token or code' },
            ],
          }
        }

        const valid = token
          ? (await consumeToken(
              fastify.prisma,
              'EMAIL_CHANGE',
              token,
              userId,
            )) !== null
          : await consumeCode(fastify.prisma, userId, 'EMAIL_CHANGE', code!)
        if (!valid) {
          throw {
            statusCode: 400,
            code: 'invalidToken',
            message: 'Invalid or expired confirmation',
          }
        }

        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, pendingEmail: true },
        })
        if (!user?.pendingEmail) {
          throw {
            statusCode: 400,
            code: 'invalidToken',
            message: 'There is no pending email change',
          }
        }

        // Someone may have registered the address since the request
        const taken = await fastify.prisma.user.findFirst({
          where: { email: user.pendingEmail, id: { not: userId } },
          select: { id: true },
        })
        if (taken) {
          await fastify.prisma.user.update({
            where: { id: userId },
            data: { pendingEmail: null },
          })
          throw {
            statusCode: 409,
            code: 'conflictError',
            message: 'That email address is now in use by another account',
          }
        }

        const oldEmail = user.email
        const newEmail = user.pendingEmail
        await fastify.prisma.$transaction([
          fastify.prisma.user.update({
            where: { id: userId },
            data: { email: newEmail, pendingEmail: null, emailVerified: true },
          }),
          fastify.prisma.userActivityLog.create({
            data: {
              userId,
              action: 'EMAIL_VERIFICATION',
              metadata: {
                step: 'confirmed',
                method: token ? 'token' : 'code',
              } as Prisma.InputJsonValue,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'] ?? null,
            },
          }),
        ])

        // Warn the previous address, in case this wasn't the owner
        void sendEmailChangedNotice(oldEmail, newEmail)

        return reply.send({
          success: true,
          message: 'Email changed successfully',
          data: { email: newEmail },
        })
      } catch (err) {
        return userErrorHandler(req, reply, err, {
          action: 'verifyEmail',
          userId,
        })
      }
    },
  )
}

export default verifyEmailRoute

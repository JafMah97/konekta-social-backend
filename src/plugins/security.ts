import fp from 'fastify-plugin'
import { type FastifyPluginAsync } from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import chalk from 'chalk'

/**
 * Security headers + rate limiting.
 * Must be registered before any routes so per-route limits apply.
 */
const securityPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(helmet, {
    // The frontend runs on another origin and loads images from /uploads
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })

  // Baseline limit for every route (per IP); sensitive routes override it
  // with `config.rateLimit` (see modules/auth/authRateLimits.ts)
  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // Thrown into the global error handler, so 429s use the same
    // { success, error: { code, message } } envelope as every other error
    errorResponseBuilder: (_req, context) => ({
      statusCode: context.statusCode,
      code: 'RATE_LIMITED',
      message: `Too many requests, please retry in ${context.after}.`,
    }),
  })

  fastify.log.info(
    chalk.cyan('Security plugin registered (helmet, rate limit)'),
  )
}

export default fp(securityPlugin, { name: 'security' })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import path from 'path'
import { fileURLToPath } from 'url'

import prismaPlugin from '../plugins/prisma'
import sensiblePlugin from '../plugins/sensible'
import authenticatePlugin from '../plugins/authenticate'
import socketPlugin from '../plugins/websocket'
import errorHandlerPlugin from '../plugins/errorHandler'
import securityPlugin from '../plugins/security'
import docsPlugin from '../plugins/docs'

import authIndex from '../modules/auth/authIndex'
import postIndex from '../modules/post/postIndex'
import userIndex from '../modules/user/userIndex'
import commentIndex from '../modules/comment/commentIndex'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function buildApp() {
  const app = Fastify({
    pluginTimeout: 60000,
    // Railway/Render sit behind a proxy: without this every request has the
    // proxy's IP, so all users would share one rate-limit bucket (and
    // lastIp / session IPs would be wrong). Off in dev so the header can't
    // be spoofed.
    trustProxy: process.env.NODE_ENV === 'production',
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          levelFirst: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    },
  })

  // Read allowed origins from environment variables
  const devOrigin = process.env.DEV_ORIGIN
  const prodOrigin = process.env.PROD_ORIGIN
  const allowedOrigins = [devOrigin, prodOrigin]

  await app.register(cors, {
    // Decided per request so the API's own origin is allowed as well:
    // browsers send Origin on same-origin POSTs from Swagger UI (/docs)
    delegator: (req, cb) => {
      const origin = req.headers.origin
      const selfOrigin = `${req.protocol}://${req.host}`
      if (!origin || origin === selfOrigin || allowedOrigins.includes(origin)) {
        cb(null, {
          origin: true,
          methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
          credentials: true,
        })
      } else {
        cb(
          Object.assign(new Error('Origin not allowed by CORS'), {
            statusCode: 403,
            code: 'CORS_NOT_ALLOWED',
          }),
        )
      }
    },
  })

  // Docs first: it collects routes via onRoute, and Helmet's CSP needs
  // the Swagger UI hashes it provides
  await app.register(docsPlugin)
  await app.register(securityPlugin)

  app.register(sensiblePlugin)
  app.register(cookie, { secret: process.env.COOKIE_SECRET || 'dev_secret' })
  app.register(formbody)
  app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
    attachFieldsToBody: false,
  })
  app.register(fastifyStatic, {
    root: path.join(__dirname, '..', '..', 'uploads'),
    prefix: '/uploads/',
  })
  app.register(prismaPlugin)
  app.register(authenticatePlugin)
  app.register(socketPlugin)
  app.register(errorHandlerPlugin)

  app.register(authIndex)
  app.register(postIndex)
  app.register(userIndex)
  app.register(commentIndex)

  app.get('/ping', async () => {
    return { status: 'ok' }
  })

  return app
}

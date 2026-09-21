import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { type FastifyPluginAsync, type RouteOptions } from 'fastify'
import { z } from 'zod'
import chalk from 'chalk'
import { routeDocs, type RouteDoc } from '../docs/routeDocs'

type JsonSchema = Record<string, unknown>

const TAGS: Record<string, string> = {
  auth: 'Auth',
  user: 'Users',
  posts: 'Posts',
  comments: 'Comments',
  notifications: 'Notifications',
}

// What the client sends (`io: 'input'`), so `.transform()`ed query params
// are documented as the strings they arrive as
function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema
  delete json.$schema
  return json
}

function usesHook(route: RouteOptions, hook: unknown): boolean {
  const handlers = route.preHandler
  return Array.isArray(handlers)
    ? (handlers as unknown[]).includes(hook)
    : handlers === hook
}

const errorResponse = (description: string) => ({
  description,
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
})

function requestSchema(doc: RouteDoc): JsonSchema {
  if (!doc.files) return doc.body ? { body: toJsonSchema(doc.body) } : {}

  // multipart/form-data: text fields from the Zod schema + binary file fields
  const body = doc.body
    ? toJsonSchema(doc.body)
    : { type: 'object', properties: {} }
  const properties = { ...(body.properties as JsonSchema) }
  for (const field of doc.files) {
    properties[field] = { type: 'string', format: 'binary' }
  }
  return {
    consumes: ['multipart/form-data'],
    body: { ...body, properties },
  }
}

/**
 * OpenAPI spec + Swagger UI at /docs, built from src/docs/routeDocs.ts.
 * Must be registered before the routes (it collects them via onRoute) and
 * before the security plugin (Helmet's CSP needs `swaggerCSP`).
 */
const docsPlugin: FastifyPluginAsync = async (fastify) => {
  const undocumented = new Set<string>()
  const documented = new Set<string>()

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Social Backend API',
        version: process.env.npm_package_version ?? '1.0.0',
        description:
          'REST + Socket.IO backend for a social network: auth with email ' +
          'verification and revocable sessions, profiles, posts, comments, ' +
          'likes and bookmarks.\n\n' +
          '**Trying it out:** call `POST /auth/login` first. It sets an ' +
          'httpOnly `token` cookie on this origin, which the browser then ' +
          'sends with every request from this page. Routes with a lock ' +
          'require it.\n\n' +
          'Errors always use `{ success: false, error: { code, message, details? } }`. ' +
          'Rate-limited requests return `429 RATE_LIMITED` with `retry-after`.',
      },
      tags: [
        { name: 'Auth', description: 'Sign-up, login, sessions, passwords' },
        { name: 'Users', description: 'Profiles, settings, social graph' },
        { name: 'Posts', description: 'Feed, posts, likes, bookmarks' },
        { name: 'Comments', description: 'Comments and comment likes' },
        {
          name: 'Notifications',
          description:
            'Likes, comments, follows. Also pushed live over Socket.IO as a ' +
            '`notification` event (same shape as the list items).',
        },
        { name: 'System', description: 'Health' },
      ],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token' },
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },

    transform: ({ schema, url, route }) => {
      if (schema?.hide) return { schema, url }

      const method = Array.isArray(route.method)
        ? route.method[0]
        : route.method
      if (method === 'HEAD') return { schema: { ...schema, hide: true }, url }

      const key = `${method} ${url}`
      const doc = routeDocs[key]
      if (doc) documented.add(key)
      else undocumented.add(key)

      const pathParams = [...url.matchAll(/:(\w+)/g)].map((m) => m[1] as string)
      const requiresAuth = usesHook(route, fastify.authenticate)
      const optionalAuth = usesHook(route, fastify.authenticateOptional)
      const auth = [{ cookieAuth: [] }, { bearerAuth: [] }]

      const response: JsonSchema = {
        200: {
          description: 'Success',
          type: 'object',
          additionalProperties: true,
        },
      }
      if (doc?.body || doc?.querystring || pathParams.length) {
        response[400] = errorResponse('Validation error')
      }
      if (requiresAuth) {
        response[401] = errorResponse('Missing, invalid or revoked session')
      }
      response[429] = errorResponse('Rate limit exceeded')

      return {
        url,
        schema: {
          ...schema,
          tags: [TAGS[url.split('/')[1] ?? ''] ?? 'System'],
          summary: doc?.summary ?? key,
          ...(doc?.description && { description: doc.description }),
          ...(requiresAuth && { security: auth }),
          ...(optionalAuth && { security: [{}, ...auth] }),
          ...(pathParams.length && {
            params: {
              type: 'object',
              properties: Object.fromEntries(
                pathParams.map((p) => [p, { type: 'string' }]),
              ),
              required: pathParams,
            },
          }),
          ...(doc?.querystring && {
            querystring: toJsonSchema(doc.querystring),
          }),
          ...(doc && requestSchema(doc)),
          response,
        },
      }
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      // Don't send the spec to the public swagger.io validator
      validatorUrl: null,
    },
  })

  // Build the spec at startup: fails fast on a broken schema, and flags
  // routes and docs entries that have drifted apart
  fastify.addHook('onReady', async () => {
    fastify.swagger()

    for (const key of undocumented) {
      fastify.log.warn(chalk.yellow(`[docs] Undocumented route: ${key}`))
    }
    for (const key of Object.keys(routeDocs)) {
      if (!documented.has(key)) {
        fastify.log.warn(chalk.yellow(`[docs] No route matches entry: ${key}`))
      }
    }
    fastify.log.info(
      chalk.cyan(`API docs: ${documented.size} routes documented at /docs`),
    )
  })
}

export default fp(docsPlugin, { name: 'docs' })

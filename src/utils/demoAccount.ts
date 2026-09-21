import type { FastifyRequest } from 'fastify'

// The seeded demo accounts (scripts/seedDemo.ts) all use the reserved
// example.com domain, which no real user can own. Their password is public,
// so account-level changes are blocked: otherwise one visitor could lock
// every later visitor out of the demo.
export const isDemoAccount = (email: string) => /@example\.com$/i.test(email)

/** preHandler for routes that must not run on a demo account (after authenticate) */
export async function forbidDemoAccount(request: FastifyRequest) {
  if (request.user && isDemoAccount(request.user.email)) {
    throw Object.assign(
      new Error('This action is disabled for the demo account.'),
      { statusCode: 403, code: 'demoAccountReadOnly' },
    )
  }
}

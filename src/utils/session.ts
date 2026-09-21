import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

// One definition for every login path. Cross-site cookies (frontend on
// Vercel, API on Render) need SameSite=None, which browsers only accept with
// Secure; plain-http local dev must use Lax instead or the cookie is dropped.
export function authCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ('none' as const) : ('lax' as const),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}

/** Signs a token, stores its session row and sets the auth cookie. */
export async function startSession(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  user: { id: string; email: string; username: string },
): Promise<void> {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')

  const token = jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    secret,
    // Unique per token: same-second logins would otherwise sign identical
    // JWTs and collide on the unique Session.token
    { expiresIn: SESSION_TTL_SECONDS, jwtid: randomUUID() },
  )

  await db.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    },
  })
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastIp: request.ip ?? null },
  })

  reply.setCookie('token', token, authCookieOptions())
}

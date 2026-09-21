import { createHash, randomBytes, randomInt } from 'crypto'
import type { Prisma, PrismaClient, VerificationType } from '@prisma/client'

// Every emailed secret (verify link/code, password reset, magic link, email
// change) lives in VerificationToken as a SHA-256 hash: a database leak does
// not hand out working links. One outstanding secret per user and type;
// issuing a new one deletes the old, and redeeming deletes it (single use).

type Db = PrismaClient | Prisma.TransactionClient

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/** How long an emailed link stays valid, per purpose */
export const TOKEN_TTL_MS: Record<VerificationType, number> = {
  EMAIL: 24 * HOUR,
  EMAIL_CHANGE: 24 * HOUR,
  PASSWORD_RESET: 1 * HOUR,
  MAGIC_LINK: 15 * MINUTE,
  TWO_FACTOR: 10 * MINUTE,
}

/** 6-digit codes are guessable, so they expire much sooner than links */
export const CODE_TTL_MS = 30 * MINUTE

export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex')

// Only a million possible codes: bind each to its user before hashing so a
// code is useless for any other account
const codeHash = (userId: string, code: string) =>
  hashToken(`code:${userId}:${code}`)

export interface IssuedSecret {
  token: string
  code?: string
}

export async function issueSecret(
  db: Db,
  userId: string,
  type: VerificationType,
  { withCode = false }: { withCode?: boolean } = {},
): Promise<IssuedSecret> {
  await db.verificationToken.deleteMany({ where: { userId, type } })

  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const rows: Prisma.VerificationTokenCreateManyInput[] = [
    {
      userId,
      type,
      token: hashToken(token),
      expiresAt: new Date(now + TOKEN_TTL_MS[type]),
    },
  ]

  let code: string | undefined
  if (withCode) {
    code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    rows.push({
      userId,
      type,
      token: codeHash(userId, code),
      expiresAt: new Date(now + CODE_TTL_MS),
    })
  }

  await db.verificationToken.createMany({ data: rows })
  return code ? { token, code } : { token }
}

// Deleting by id is the claim: of two simultaneous redemptions only one
// deletes the row, so a link can never be used twice
async function redeem(
  db: Db,
  where: Prisma.VerificationTokenWhereInput,
): Promise<string | null> {
  const row = await db.verificationToken.findFirst({
    where: { ...where, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, type: true },
  })
  if (!row) return null

  const { count } = await db.verificationToken.deleteMany({
    where: { id: row.id },
  })
  if (!count) return null

  // The link and the code are two ways to do the same thing: spend both
  await db.verificationToken.deleteMany({
    where: { userId: row.userId, type: row.type },
  })
  return row.userId
}

/**
 * Redeems an emailed link token. Returns the owner's id, or null.
 * Pass userId when the caller is already known: someone else's token is then
 * rejected without being spent.
 */
export const consumeToken = (
  db: Db,
  type: VerificationType,
  token: string,
  userId?: string,
) => redeem(db, { type, token: hashToken(token), ...(userId && { userId }) })

/** Redeems a 6-digit code for a known user. */
export async function consumeCode(
  db: Db,
  userId: string,
  type: VerificationType,
  code: string,
): Promise<boolean> {
  return (
    (await redeem(db, { type, userId, token: codeHash(userId, code) })) !== null
  )
}

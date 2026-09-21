# Engineering notes

Decisions, bugs and measurements behind this codebase. Each entry follows the same shape: the problem, the fix, and how it was verified. Numbers come from runs against real PostgreSQL databases (throwaway Docker containers, or the live deployment where noted).

1. [Feed N+1: 112 → 12 queries per page](#1-feed-n1-112--12-queries-per-page)
2. [Latency is geography: 407 ms → 15 ms](#2-latency-is-geography-407-ms--15-ms)
3. [Revocable sessions on top of JWT](#3-revocable-sessions-on-top-of-jwt)
4. [Authenticated WebSockets](#4-authenticated-websockets)
5. [An inverted relation found by seeding](#5-an-inverted-relation-found-by-seeding)
6. [Email flows without enumeration or lockout](#6-email-flows-without-enumeration-or-lockout)
7. [Race-safe follow requests](#7-race-safe-follow-requests)
8. [Small bugs with big effects](#8-small-bugs-with-big-effects)
9. [Documentation that can't drift](#9-documentation-that-cant-drift)
10. [Operations: rate limits, health checks, CI](#10-operations-rate-limits-health-checks-ci)

---

## 1. Feed N+1: 112 → 12 queries per page

**Problem.** The feed loaded a page of posts, then ran two queries per post to check whether the viewer had liked or saved it. A 50-post page issued **112 SQL statements**.

**Fix.** One batched query per flag (`WHERE postId IN (…)`), run in parallel with the like/comment counts, turned into sets in memory.

**Verification.** Same data before and after, counted with `pg_stat_statements`. Latency was simulated with a TCP proxy that delays every packet by 10 ms each way, as between an app and a database on different hosts:

| Endpoint (50 posts) | SQL statements | Local | ~20 ms database latency |
|---|---|---|---|
| `GET /posts/list` | 112 → **12** | 84 → 61 ms | 1135 → **448 ms** |
| `GET /posts/saved` | 55 → **12** | 73 → 74 ms | 883 → **422 ms** |

The full JSON responses were **byte-identical** before and after. The local numbers barely move: N+1 problems hide on a laptop and show up in production.

## 2. Latency is geography: 407 ms → 15 ms

**Problem.** After deployment, the live `/health` endpoint reported **~407 ms** for a single `SELECT 1`. The API was on Render in Ohio; the database was on Supabase in Ireland. Every query crossed the Atlantic, several round trips each, and the feed runs ~7 queries.

**Fix.** Recreated the database in the API's region (Supabase `us-east-2`), applied the migrations, reseeded, and switched the connection strings. Neither platform can move a service between regions; moving the database kept the public API URL unchanged.

**Verification.** Live `/health`: **407 ms → 13–23 ms** per query, with the smoke test passing on the new setup.

## 3. Revocable sessions on top of JWT

**Problem.** Logout deleted a session row, but authentication only checked the JWT signature. A copied token kept working for its full 7 days after logout.

**Fix.** Every request now requires a matching, unexpired session row. The session and user load in **one query**, so the check adds no extra round trip. Changing the password revokes every other session; a password reset revokes all of them. Each JWT carries a random `jti`: without it, two logins in the same second produced identical tokens and collided on the unique `Session.token` column (a 500 error on double-clicks).

**Verification.** After logout, reusing the old token returns `401 Session has been revoked`. After a password change, the current device keeps working and the other device gets a 401.

## 4. Authenticated WebSockets

**Problem.** The Socket.IO server trusted `?userId=` from the client. Anyone could connect as anyone and receive their notifications. Separately, a `userId → socket` map kept one socket per user, so a second browser tab silently broke notifications for the first.

**Fix.** The handshake goes through the same session check as HTTP (cookie or `auth.token`). Sockets join two rooms, `user:<id>` and `session:<id>`. Notifications go to the user room (every tab), and revoking a session disconnects exactly that session's sockets.

**Verification.** A raw Engine.IO handshake run against the old and new code:

| Attempt | Before | After |
|---|---|---|
| `?userId=victim`, no token | **connected as the victim** | rejected |
| forged token | connected | rejected |
| valid session, then logout | stayed connected | disconnected |

## 5. An inverted relation found by seeding

**Problem.** Writing realistic demo data exposed that `User.followers` in the Prisma schema was wired to the *follower* side of the `Follow` table: it held the people a user follows. Every query written with the intuitive meaning was wrong:

| Symptom | Expected | Actual |
|---|---|---|
| Followers-only post of an account you follow | visible | hidden |
| A profile's follower / following counts | 3 / 2 | 2 / 3 |
| Follow suggestions | accounts not yet followed | included accounts already followed |

**Fix.** A four-line schema change swapping the relation names. Relation fields are virtual in Prisma, so `migrate diff` confirmed **no database migration was needed**. Every query became correct at once.

**Lesson.** Type checks can't catch a relation that is consistently wrong. Realistic seed data plus assertions on known answers did.

## 6. Email flows without enumeration or lockout

**Problems found in an audit of the email flows:**
- Changing email replaced the address immediately and marked it unverified, and login required a verified email: **one typo locked the user out permanently**.
- Password reset answered generically, but returned a 500 only for existing accounts when the email failed to send, which revealed which addresses had accounts.
- Resend-verification answered `404 userNotFound` / `409 alreadyVerified`.
- Codes came from `Math.random()`; tokens were stored in plain text, logged, and never invalidated when a new one was issued.
- Two verification routes set `SameSite=None` without `Secure` in development, so browsers dropped the cookie.

**Fix.**
- All emailed secrets live in one table as **SHA-256 hashes**. Six-digit codes are hashed together with the user's id, so a code is useless for any other account. There's one outstanding secret per purpose; issuing a new one deletes the old, and redeeming deletes it. The redemption itself is a conditional delete, so of two simultaneous uses only one succeeds.
- Endpoints that take an email address give **identical responses** for known and unknown addresses. They send the email without awaiting it (so timing doesn't reveal anything), and login runs a bcrypt comparison even for unknown emails.
- Email changes are stored as `pendingEmail` until confirmed. The old address keeps working and receives a notice once the change completes.
- Sending is best-effort and never fails the request. Emails have HTML and plain-text versions, and security notices go out for password changes, email changes and account deletion. Reserved domains such as `example.com` are never mailed.
- New: passwordless sign-in with a single-use magic link.

**Verification.** 46 end-to-end checks with outgoing emails captured, including: old codes and links rejected after a resend; identical responses for unknown, unverified and verified addresses; two simultaneous uses of one magic link giving exactly one 200 and one 400; the old email still logging in while a change is pending; another user's confirmation token rejected without being spent; and no emailed token appearing anywhere in the database.

## 7. Race-safe follow requests

**Problem.** Following is a check-then-write operation, and double-clicks and retries arrive concurrently.

**Fix.**
- Identical follow requests are idempotent. The unique `(followerId, followingId)` constraint is the final arbiter, and the losing request's unique violation is treated as success, since the row it wanted exists.
- Accepting or rejecting a request is a conditional update on `status = 'PENDING'`, so of two simultaneous responses exactly one wins.
- Unfollow deletes the row instead of setting a soft-delete flag, because one reader ignored that flag and would have kept granting access to private profiles.

**Verification.** Three simultaneous follows → three 200s and **one** row. Two simultaneous accepts → one 200, one 409. In total, 35 checks covering public and private flows.

## 8. Small bugs with big effects

| Bug | Effect | Found by |
|---|---|---|
| `deleteMany({ take })`: Prisma calls the option `limit`, and `any` hid the type error | **Account deletion never worked** (500 for every user) | End-to-end test deleting a real account |
| Error handlers imported `PrismaClientKnownRequestError` from an internal path; `instanceof` failed against the class actually thrown | Every duplicate/not-found error became a 500 instead of 409/404 | A concurrent-follow test; confirmed with a live P2002 |
| Four routes read `req.user` but never ran the auth hook | Private profiles were never visible, even to accepted followers | Follow-flow test |
| Uploads served from `__dirname/../../uploads` | In the bundled build that pointed outside the project | Inspecting the path inside the Docker container |
| `page` / `limit` declared as required strings with a default transform | The feed returned 400 unless both were sent | Calling the API like a new client would |

## 9. Documentation that can't drift

The API docs are generated from the **same Zod schemas** the handlers validate with. They're applied through Swagger's `transform` hook, so routes carry no runtime schema and behavior is unchanged. (Moving validation into Fastify would have broken schemas that transform query strings into numbers.) Tags, auth requirements, path parameters and error responses are derived automatically.

A startup check warns about any route without docs, and any docs entry without a route. On its first run it found an endpoint file that had never been registered.

## 10. Operations: rate limits, health checks, CI

- **Rate limiting behind a proxy.** Without `trustProxy`, every request appears to come from Render's proxy, and all users share one rate-limit bucket. It's enabled in production only, so the header can't be spoofed locally. Tested both ways.
- **Liveness vs readiness.** `/ping` never touches the database and is used by the platform, so a database blip doesn't restart the app. `/health` runs `SELECT 1` and is used by the uptime monitor, which also keeps the free-tier database from pausing.
- **CI tests the artifact that ships.** GitHub Actions builds the production Docker image, runs it against a fresh PostgreSQL service, checks that migrations match the schema, and runs the smoke test against the container.

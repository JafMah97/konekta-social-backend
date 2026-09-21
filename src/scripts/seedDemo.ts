// Demo data for the public API docs: one login for visitors plus a small,
// realistic network around it.
//
//   npm run seed:demo                     dry run: shows target DB, writes nothing
//   npm run seed:demo -- --yes            (re)create the demo data
//   npm run seed:demo -- --reset --yes    remove the demo data only
//
// Only touches the users listed in DEMO_USERS (matched by email). Each run
// deletes and recreates them, which also restores the demo after visitors
// change it. Deleting a demo user cascades to everything linked to them,
// including other people's likes/comments on demo posts.
import 'dotenv/config'
import {
  PrismaClient,
  type NotificationType,
  type PostVisibility,
  type Prisma,
} from '@prisma/client'
import { hashPassword } from '../utils/hash'
import { excerpt } from '../modules/notification/notify'

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo12345'

const avatar = (seed: string) =>
  `https://api.dicebear.com/9.x/avataaars/png?seed=${seed}`

const DEMO_USERS = {
  demo: {
    username: 'demo_user',
    email: 'demo@example.com',
    fullName: 'Demo Account',
    bio: 'Log in as me to try the API. Every endpoint works with this account.',
    location: 'The Internet',
    isPrivate: false,
  },
  sara: {
    username: 'sara_codes',
    email: 'sara.demo@example.com',
    fullName: 'Sara Haddad',
    bio: 'Backend engineer. Postgres enjoyer.',
    location: 'Amman',
    isPrivate: false,
  },
  omar: {
    username: 'omar_builds',
    email: 'omar.demo@example.com',
    fullName: 'Omar Khalil',
    bio: 'Shipping side projects on weekends.',
    location: 'Dubai',
    isPrivate: false,
  },
  lina: {
    username: 'lina_designs',
    email: 'lina.demo@example.com',
    fullName: 'Lina Mansour',
    bio: 'Product designer who writes CSS.',
    location: 'Beirut',
    isPrivate: false,
  },
  yusuf: {
    username: 'yusuf_ops',
    email: 'yusuf.demo@example.com',
    fullName: 'Yusuf Aydin',
    bio: 'DevOps, Kubernetes, coffee.',
    location: 'Istanbul',
    isPrivate: false,
  },
  maya: {
    username: 'maya_private',
    email: 'maya.demo@example.com',
    fullName: 'Maya Nasser',
    bio: 'Private account.',
    location: 'Cairo',
    isPrivate: true,
  },
}
type Who = keyof typeof DEMO_USERS

// follower → following
const FOLLOWS: [Who, Who][] = [
  ['demo', 'sara'],
  ['demo', 'omar'],
  ['demo', 'lina'],
  ['sara', 'demo'],
  ['omar', 'demo'],
  ['yusuf', 'demo'],
  ['sara', 'omar'],
  ['omar', 'sara'],
  ['lina', 'sara'],
  ['yusuf', 'omar'],
]

interface DemoPost {
  author: Who
  hoursAgo: number
  title?: string
  content: string
  image?: string
  visibility?: PostVisibility
  likedBy?: Who[]
  comments?: [Who, string, Who[]?][] // [author, text, likedBy]
  savedBy?: Who[]
}

const POSTS: DemoPost[] = [
  {
    author: 'sara',
    hoursAgo: 2,
    title: 'Indexes matter',
    content:
      'Added a composite index on (created_at, id) and the feed query went from 180ms to 9ms. Always check EXPLAIN ANALYZE before reaching for a cache.',
    likedBy: ['demo', 'omar', 'lina', 'yusuf'],
    comments: [
      ['omar', 'Cursor pagination next?', ['sara']],
      ['demo', 'Saving this for later, great tip.'],
    ],
    savedBy: ['demo'],
  },
  {
    author: 'omar',
    hoursAgo: 5,
    content:
      'Weekend project: a tiny CLI that turns my git log into a changelog. 200 lines of TypeScript, zero dependencies.',
    likedBy: ['sara', 'yusuf'],
    comments: [['sara', 'Open source it please!']],
  },
  {
    author: 'lina',
    hoursAgo: 8,
    title: 'New portfolio layout',
    content: 'Finally happy with the grid. Feedback welcome!',
    image: 'https://picsum.photos/seed/demo-lina/1200/800',
    likedBy: ['demo', 'sara'],
    comments: [
      ['demo', 'The spacing is really clean.', ['lina']],
      ['omar', 'Dark mode version when?'],
    ],
  },
  {
    author: 'lina',
    hoursAgo: 12,
    content:
      'Followers-only: early sneak peek of the design system tokens I am publishing next week.',
    visibility: 'FOLLOWERS_ONLY',
    likedBy: ['sara'],
  },
  {
    author: 'yusuf',
    hoursAgo: 20,
    content:
      'Followers-only: notes from debugging a DNS issue at 3am. (Demo does not follow me, so this post is hidden from their feed.)',
    visibility: 'FOLLOWERS_ONLY',
  },
  {
    author: 'demo',
    hoursAgo: 6,
    title: 'Hello from the demo account',
    content:
      'This account exists so you can try the API from /docs. Like, comment, save, post: go ahead. The data is reset regularly.',
    likedBy: ['sara', 'omar', 'lina', 'yusuf'],
    comments: [
      ['sara', 'Welcome!', ['demo']],
      ['yusuf', 'Rate limits are on, so be gentle with /auth/login.'],
    ],
  },
  {
    author: 'demo',
    hoursAgo: 30,
    content: 'Private post: only I can see this one.',
    visibility: 'PRIVATE',
  },
  {
    author: 'yusuf',
    hoursAgo: 34,
    content:
      'Hot take: your first Dockerfile should be multi-stage. Smaller images, faster deploys, fewer secrets baked in.',
    likedBy: ['omar', 'demo'],
    comments: [['omar', 'And pin your base image versions.']],
    savedBy: ['demo'],
  },
  {
    author: 'sara',
    hoursAgo: 48,
    content:
      'Reminder that logout should actually revoke the token. Stateless JWT alone cannot do that; keep a session table.',
    likedBy: ['demo', 'yusuf', 'lina'],
  },
  {
    author: 'omar',
    hoursAgo: 60,
    title: 'Sunset run',
    content: 'Clearing my head before a big release.',
    image: 'https://picsum.photos/seed/demo-omar/1200/800',
    likedBy: ['lina'],
  },
  {
    author: 'maya',
    hoursAgo: 72,
    content: 'Private account, public post.',
    likedBy: ['lina'],
  },
]

const HOUR = 60 * 60 * 1000
const ago = (hours: number) => new Date(Date.now() - hours * HOUR)
const emails = Object.values(DEMO_USERS).map((u) => u.email)

function describeTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '')
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`
  } catch {
    return '(DATABASE_URL not set or invalid)'
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const confirmed = args.has('--yes')
  const reset = args.has('--reset')
  const prisma = new PrismaClient()

  try {
    console.log(`\nTarget database: ${describeTarget()}`)

    // A real account already using one of our usernames would make the
    // insert fail halfway through; check up front instead
    const clashes = await prisma.user.findMany({
      where: {
        username: { in: Object.values(DEMO_USERS).map((u) => u.username) },
        email: { notIn: emails },
      },
      select: { username: true },
    })
    if (clashes.length) {
      throw new Error(
        `Usernames already taken by real accounts: ${clashes
          .map((c) => c.username)
          .join(', ')}. Rename them in DEMO_USERS.`,
      )
    }

    const existing = await prisma.user.count({
      where: { email: { in: emails } },
    })

    if (!confirmed) {
      console.log(
        [
          `Existing demo users: ${existing}`,
          reset
            ? `Would delete ${existing} demo users and everything linked to them.`
            : `Would (re)create ${emails.length} users, ${FOLLOWS.length} follows and ${POSTS.length} posts with likes, comments and saves.`,
          '',
          'Dry run: nothing was written. Re-run with --yes to apply.',
        ].join('\n'),
      )
      return
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD)

    await prisma.$transaction(
      async (tx) => {
        const { count } = await tx.user.deleteMany({
          where: { email: { in: emails } },
        })
        console.log(`Removed ${count} existing demo users`)
        if (reset) return

        const ids = {} as Record<Who, string>
        for (const [key, u] of Object.entries(DEMO_USERS) as [
          Who,
          (typeof DEMO_USERS)[Who],
        ][]) {
          const user = await tx.user.create({
            data: {
              ...u,
              passwordHash,
              profileImage: avatar(u.username),
              emailVerified: true,
              isProfileComplete: true,
              createdAt: ago(24 * 30),
            },
          })
          ids[key] = user.id
        }

        // Notifications mirror the seeded activity, as if it happened live;
        // anything older than a day is already read
        const notifications: Prisma.NotificationCreateManyInput[] = []
        const note = (
          recipient: Who,
          actor: Who,
          type: NotificationType,
          hoursAgo: number,
          extra: Partial<Prisma.NotificationCreateManyInput> = {},
        ) => {
          if (recipient === actor) return
          notifications.push({
            userId: ids[recipient],
            actorId: ids[actor],
            type,
            createdAt: ago(hoursAgo),
            isRead: hoursAgo > 24,
            readAt: hoursAgo > 24 ? ago(hoursAgo - 1) : null,
            ...extra,
          })
        }

        for (const [i, [follower, following]] of FOLLOWS.entries()) {
          const f = DEMO_USERS[follower]
          note(following, follower, 'follow', (i + 1) * 7, {
            link: `/users/${ids[follower]}`,
          })
          await tx.follow.create({
            data: {
              followerId: ids[follower],
              followingId: ids[following],
              followerUsername: f.username,
              followerFullName: f.fullName,
              followerImage: avatar(f.username),
            },
          })
        }

        for (const p of POSTS) {
          const post = await tx.post.create({
            data: {
              authorId: ids[p.author],
              title: p.title ?? null,
              content: p.content,
              image: p.image ?? null,
              format: p.image ? 'IMAGE' : 'TEXT',
              visibility: p.visibility ?? 'PUBLIC',
              likesCount: p.likedBy?.length ?? 0,
              commentsCount: p.comments?.length ?? 0,
              createdAt: ago(p.hoursAgo),
            },
          })

          const postLink = `/posts/${post.id}`
          for (const [i, who] of (p.likedBy ?? []).entries()) {
            await tx.postLike.create({
              data: { postId: post.id, userId: ids[who] },
            })
            note(p.author, who, 'like_post', p.hoursAgo - (i + 1) * 0.2, {
              postId: post.id,
              link: postLink,
            })
          }

          for (const [i, [who, content, likedBy]] of (
            p.comments ?? []
          ).entries()) {
            const comment = await tx.comment.create({
              data: {
                postId: post.id,
                authorId: ids[who],
                content,
                authorUsername: DEMO_USERS[who].username,
                authorImage: avatar(DEMO_USERS[who].username),
                createdAt: ago(p.hoursAgo - (i + 1) * 0.5),
              },
            })
            const commentLink = `${postLink}?comment=${comment.id}`
            const commentHoursAgo = p.hoursAgo - (i + 1) * 0.5
            note(p.author, who, 'comment', commentHoursAgo, {
              postId: post.id,
              messageText: excerpt(content),
              link: commentLink,
            })
            for (const liker of likedBy ?? []) {
              await tx.commentLike.create({
                data: { commentId: comment.id, userId: ids[liker] },
              })
              note(who, liker, 'comment_liked', commentHoursAgo - 0.25, {
                postId: post.id,
                messageText: excerpt(content),
                link: commentLink,
              })
            }
          }

          for (const who of p.savedBy ?? []) {
            await tx.savedPost.create({
              data: {
                postId: post.id,
                userId: ids[who],
                postTitle: p.title ?? '',
                postImage: p.image ?? '',
                postAuthor: DEMO_USERS[p.author].fullName,
              },
            })
          }
        }

        await tx.notification.createMany({ data: notifications })
      },
      { timeout: 120_000 },
    )

    if (reset) {
      console.log('Demo data removed.')
      return
    }

    console.log(
      [
        '',
        'Demo data ready.',
        `  Login:    ${DEMO_USERS.demo.email} / ${DEMO_PASSWORD}`,
        `  Users:    ${emails.length} (maya_private is a private account)`,
        `  Posts:    ${POSTS.length}`,
        '',
        'Try in /docs:',
        '  POST /auth/login     with the login above',
        '  GET  /posts/list     feed shows followers-only posts from people demo follows,',
        '                       hides the one from yusuf_ops (not followed)',
        '  GET  /posts/saved    2 bookmarked posts',
        '  GET  /user/me        the demo profile',
        '  GET  /notifications  likes, comments and follows (some unread)',
      ].join('\n'),
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(`\nSeed failed: ${(err as Error).message}`)
  process.exit(1)
})

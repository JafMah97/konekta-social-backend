// OpenAPI documentation for every route, keyed by "METHOD /full/path".
//
// Docs-only: nothing here is attached to the routes at runtime. Validation
// stays in each handler (Zod `safeParse`); these are the *same* Zod schemas,
// converted to JSON Schema when the spec is generated, so docs can't drift.
// Tags, auth (lock icon) and path params are derived automatically in
// plugins/docs.ts. A startup warning lists any route missing from this map.
import { z } from 'zod'
import {
  forgotPasswordSchema,
  loginSchema,
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailWithCodeSchema,
  verifyEmailWithLinkSchema,
} from '../modules/auth/authSchemas'
import {
  createCommentSchema,
  getCommentsByPostIdSchema,
  likeCommentSchema,
  unlikeCommentSchema,
  updateCommentSchema,
} from '../modules/comment/commentSchemas'
import {
  createPostSchema,
  listPostsSchema,
  listSavedPostsSchema,
  updatePostSchema,
} from '../modules/post/postSchemas'
import {
  changeEmailSchema,
  changePasswordSchema,
  completeProfileSchema,
  updateProfileSchema,
  userSettingsSchema,
  verifyEmailSchema,
  listFollowRequestsSchema,
} from '../modules/user/userSchemas'
import { listNotificationsSchema } from '../modules/notification/notificationSchemas'

export interface RouteDoc {
  summary: string
  description?: string
  body?: z.ZodObject
  querystring?: z.ZodObject
  /** multipart/form-data: text fields come from `body`, these are file fields */
  files?: string[]
}

const DEMO = ' Disabled for the demo accounts (403 `demoAccountReadOnly`).'

const pagination = z.object({
  page: z.number().int().min(1).optional().describe('Default 1'),
  limit: z.number().int().min(1).optional().describe('Default 20'),
})

export const routeDocs: Record<string, RouteDoc> = {
  // ─── Auth ──────────────────────────────────────────────
  'POST /auth/register': {
    summary: 'Register a new account',
    description:
      'Creates the user and signs them in (httpOnly cookie). Emails a 6-digit code (30 min) and a ' +
      'verification link (24 h); an unverified email does not block login. ' +
      'Response includes `verificationEmailSent`.',
    body: registerSchema,
  },
  'POST /auth/login': {
    summary: 'Log in',
    description:
      'Sets an httpOnly `token` cookie (7 days) backed by a server-side session. ' +
      'Unverified emails can log in; the response includes `emailVerified`.',
    body: loginSchema,
  },
  'POST /auth/logout': {
    summary: 'Log out',
    description:
      'Deletes the session, so the token is revoked immediately, and disconnects its live sockets.',
  },
  'POST /auth/verify-email-with-code': {
    summary: 'Verify email with the 6-digit code',
    body: verifyEmailWithCodeSchema,
  },
  'POST /auth/verify-email-with-link': {
    summary: 'Verify email with the link token',
    body: verifyEmailWithLinkSchema,
  },
  'POST /auth/resend-verification': {
    summary: 'Resend the verification email',
    description:
      'Always the same response, whether or not the account exists (no email enumeration). ' +
      'Replaces any previous code and link.',
    body: resendVerificationSchema,
  },
  'POST /auth/forgot-password': {
    summary: 'Request a password reset email',
    description:
      'Always the same response (no email enumeration). The link is valid for 1 hour, ' +
      'single use, and replaces any earlier one.',
    body: forgotPasswordSchema,
  },
  'POST /auth/magic-link': {
    summary: 'Email a passwordless sign-in link',
    description:
      'Always the same response (no email enumeration). The link is valid for 15 minutes and single use.',
    body: magicLinkRequestSchema,
  },
  'POST /auth/magic-link/verify': {
    summary: 'Sign in with a magic link',
    description:
      'Redeems the token from the email, sets the session cookie and marks the email as verified.',
    body: magicLinkVerifySchema,
  },
  'POST /auth/reset-password': {
    summary: 'Reset password with the emailed token',
    description:
      'Single use. Revokes every session, disconnects all sockets, and sends a security email.',
    body: resetPasswordSchema,
  },

  // ─── Users ─────────────────────────────────────────────
  'GET /user/me': { summary: 'Get the current user' },
  'GET /user/:userId': { summary: 'Get a user profile by id' },
  'PUT /user/profile-update': {
    summary: 'Update profile',
    body: updateProfileSchema,
  },
  'POST /user/complete-profile': {
    summary: 'Complete profile after sign-up',
    body: completeProfileSchema,
  },
  'POST /user/profile-picture': {
    summary: 'Upload profile picture',
    description: 'Max 5 MB. Stored on ImageKit.',
    files: ['profileImage'],
  },
  'POST /user/profile-cover': {
    summary: 'Upload cover image',
    description: 'Max 5 MB. Stored on ImageKit.',
    files: ['coverImage'],
  },
  'GET /user/settings': { summary: 'Get privacy & notification settings' },
  'PUT /user/update-settings': {
    summary: 'Update privacy & notification settings',
    body: userSettingsSchema,
  },
  'POST /user/change-password': {
    summary: 'Change password',
    description:
      'Signs out every other device (the current one stays logged in) and sends a security email.' +
      DEMO,
    body: changePasswordSchema,
  },
  'POST /user/change-email': {
    summary: 'Request an email change',
    description:
      'Stores the new address as `pendingEmail` and emails a code + link to it. The current email ' +
      'keeps working until the change is confirmed.' +
      DEMO,
    body: changeEmailSchema,
  },
  'POST /user/verify-new-Email': {
    summary: 'Confirm an email change',
    description:
      'Provide either the `token` (link) or the `code`. Swaps in the new email and notifies the ' +
      'previous address.' +
      DEMO,
    body: verifyEmailSchema,
  },
  'DELETE /user/delete-account': {
    summary: 'Delete the current account',
    description:
      'Permanently deletes the account and its data, disconnects live sockets and sends a confirmation email.' +
      DEMO,
  },
  'GET /user/followers/:userId': {
    summary: 'List the followers of a user',
    querystring: pagination,
  },
  'GET /user/following/:userId': {
    summary: 'List who a user follows',
    querystring: pagination,
  },
  'POST /user/follow/:userId': {
    summary: 'Follow a user',
    description:
      'Public account: follows immediately → `{ status: "following" }`. ' +
      'Private account: sends a follow request → `{ status: "requested" }`. ' +
      'Idempotent: repeating the call returns the current status.',
  },
  'DELETE /user/follow/:userId': {
    summary: 'Unfollow, or cancel a pending request',
    description: 'Idempotent → `{ status: "none" }`.',
  },
  'GET /user/follow-requests': {
    summary: 'List my incoming follow requests',
    description: 'Pending requests sent to the current user, newest first.',
    querystring: listFollowRequestsSchema,
  },
  'POST /user/follow-requests/:requestId/accept': {
    summary: 'Accept a follow request',
    description:
      'Creates the follow. 409 if the request was already answered or cancelled.',
  },
  'POST /user/follow-requests/:requestId/reject': {
    summary: 'Reject a follow request',
    description:
      'No follow is created; the sender may request again later. 409 if already answered.',
  },
  'GET /user/suggestions': {
    summary: 'Suggested accounts to follow',
    querystring: z.object({
      limit: z.number().int().min(1).optional().describe('Default 10'),
    }),
  },

  // ─── Posts ─────────────────────────────────────────────
  'GET /posts/list': {
    summary: 'Feed: list posts (paginated)',
    description:
      'Returns public posts, your own posts, and followers-only posts from accounts you follow.',
    querystring: listPostsSchema,
  },
  'GET /posts/get/:postId': { summary: 'Get a single post' },
  'POST /posts/create': {
    summary: 'Create a post',
    description: 'multipart/form-data; `image` is optional (max 5 MB).',
    body: createPostSchema,
    files: ['image'],
  },
  'PUT /posts/update/:postId': {
    summary: 'Update a post (author only)',
    description: 'multipart/form-data; send only the fields to change.',
    body: updatePostSchema.omit({ postId: true }),
    files: ['image'],
  },
  'DELETE /posts/delete/:postId': { summary: 'Delete a post (author only)' },
  'POST /posts/like/:postId': { summary: 'Like a post' },
  'POST /posts/unlike/:postId': { summary: 'Unlike a post' },
  'POST /posts/save/:postId': { summary: 'Save (bookmark) a post' },
  'POST /posts/unsave/:postId': { summary: 'Remove a saved post' },
  'GET /posts/saved': {
    summary: 'List my saved posts',
    querystring: listSavedPostsSchema,
  },

  // ─── Comments ──────────────────────────────────────────
  'GET /comments/post/:postId': {
    summary: 'List comments on a post',
    querystring: getCommentsByPostIdSchema.omit({ postId: true }),
  },
  'POST /comments/create': {
    summary: 'Comment on a post',
    body: createCommentSchema,
  },
  'PUT /comments/edit/:postId/:commentId': {
    summary: 'Edit a comment (author only)',
    description: 'Note: `commentId` is currently also required in the body.',
    body: updateCommentSchema,
  },
  'DELETE /comments/delete/:commentId': {
    summary: 'Delete a comment (author only)',
  },
  'POST /comments/like': { summary: 'Like a comment', body: likeCommentSchema },
  'POST /comments/unlike': {
    summary: 'Unlike a comment',
    body: unlikeCommentSchema,
  },

  // ─── Notifications ─────────────────────────────────────
  'GET /notifications/': {
    summary: 'List my notifications',
    description:
      'Newest first, with `unreadCount`. Types: like_post, comment, comment_liked, ' +
      'follow, follow_request, follow_accepted.',
    querystring: listNotificationsSchema,
  },
  'GET /notifications/unread-count': { summary: 'Unread notification count' },
  'POST /notifications/:notificationId/read': {
    summary: 'Mark a notification as read',
  },
  'POST /notifications/read-all': { summary: 'Mark all notifications as read' },
  'DELETE /notifications/:notificationId': {
    summary: 'Delete a notification',
  },

  // ─── System ────────────────────────────────────────────
  'GET /ping': {
    summary: 'Liveness check',
    description: 'Does not touch the database (used by the hosting platform).',
  },
  'GET /health': {
    summary: 'Readiness check (database included)',
    description:
      'Runs `SELECT 1`. 200 with `dbLatencyMs`, or 503 if the database is unreachable. ' +
      'Used by the uptime monitor, which also keeps the free-tier database active.',
  },
}

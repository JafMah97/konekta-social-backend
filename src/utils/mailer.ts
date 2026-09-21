import dotenv from 'dotenv'

dotenv.config()

// Emails go through Resend's HTTPS API rather than SMTP, because Render's
// free tier blocks outbound SMTP ports (25/465/587).
//
// Sending is best-effort: every function resolves to true/false and never
// throws, so a mail outage can't turn a successful request into a 500 (or
// reveal which addresses have accounts). Emailed secrets are never logged,
// except in local development without an API key, where the whole email is
// printed so its links can be clicked.

const APP_NAME = 'Konekta'

const frontendUrl = () =>
  (process.env.NODE_ENV === 'production'
    ? process.env.PROD_ORIGIN
    : process.env.DEV_ORIGIN) ?? 'http://localhost:3000'

// RFC 2606/6761 reserved names never receive mail: demo accounts use them,
// and sending there would only bounce and hurt the sender reputation
const RESERVED_RECIPIENT =
  /@(?:.+\.)?(?:example\.(?:com|net|org)|test|invalid|localhost|example)$/i

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )

interface Email {
  subject: string
  heading: string
  paragraphs: string[]
  code?: string
  button?: { label: string; url: string }
  footnote: string
}

function render(email: Email): { html: string; text: string } {
  const year = new Date().getFullYear()
  const p = (t: string) =>
    `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(t)}</p>`

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2328">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;padding:32px">
      <div style="font-size:20px;font-weight:bold;margin-bottom:24px">${APP_NAME}</div>
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(email.heading)}</h1>
      ${email.paragraphs.map(p).join('\n      ')}
      ${email.code ? `<div style="font-size:28px;letter-spacing:6px;font-weight:bold;text-align:center;margin:24px 0">${email.code}</div>` : ''}
      ${
        email.button
          ? `<div style="text-align:center;margin:24px 0"><a href="${escapeHtml(email.button.url)}" style="display:inline-block;background:#5b5bd6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">${escapeHtml(email.button.label)}</a></div>
      <p style="margin:0 0 16px;font-size:13px;color:#57606a;word-break:break-all">Or open this link: ${escapeHtml(email.button.url)}</p>`
          : ''
      }
      <p style="margin:24px 0 0;font-size:13px;color:#57606a">${escapeHtml(email.footnote)}</p>
    </div>
    <p style="text-align:center;font-size:12px;color:#8c959f;margin-top:16px">&copy; ${year} ${APP_NAME}</p>
  </div>
</body></html>`

  const text = [
    email.heading,
    '',
    ...email.paragraphs.flatMap((t) => [t, '']),
    ...(email.code ? [`Code: ${email.code}`, ''] : []),
    ...(email.button ? [`${email.button.label}: ${email.button.url}`, ''] : []),
    email.footnote,
    '',
    `© ${year} ${APP_NAME}`,
  ].join('\n')

  return { html, text }
}

async function send(to: string, email: Email): Promise<boolean> {
  if (RESERVED_RECIPIENT.test(to)) {
    console.info(`[Email] Skipped "${email.subject}" to reserved address ${to}`)
    return true
  }

  const { html, text } = render(email)
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Email] RESEND_API_KEY is not set; email not sent')
      return false
    }
    console.info(
      `[Email] (dev, not sent) To: ${to}\nSubject: ${email.subject}\n\n${text}`,
    )
    return true
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${APP_NAME} <${process.env.EMAIL_FROM ?? 'no-reply@example.com'}>`,
        to: [to],
        subject: email.subject,
        html,
        text,
      }),
    })
    if (!res.ok) {
      console.error(
        `[Email] Resend rejected "${email.subject}" to ${to}: ${res.status} ${await res.text()}`,
      )
      return false
    }
    const { id } = (await res.json()) as { id: string }
    console.info(`[Email] Sent "${email.subject}" to ${to} (id ${id})`)
    return true
  } catch (err) {
    console.error(`[Email] Failed to send "${email.subject}" to ${to}`, err)
    return false
  }
}

const IGNORE_IF_NOT_YOU =
  'If you did not request this, you can ignore this email.'
const SECURE_ACCOUNT =
  'If this was not you, reset your password right away and review your account.'

export const sendVerificationEmail = (
  to: string,
  { token, code }: { token: string; code: string },
) =>
  send(to, {
    subject: `Verify your email for ${APP_NAME}`,
    heading: 'Confirm your email address',
    paragraphs: [
      `Welcome to ${APP_NAME}! Enter this code in the app (valid for 30 minutes), or use the button (valid for 24 hours).`,
    ],
    code,
    button: {
      label: 'Verify email',
      url: `${frontendUrl()}/auth/verify-email?token=${token}`,
    },
    footnote: IGNORE_IF_NOT_YOU,
  })

export const sendPasswordResetEmail = (to: string, token: string) =>
  send(to, {
    subject: `Reset your ${APP_NAME} password`,
    heading: 'Reset your password',
    paragraphs: [
      'We received a request to reset your password. The link is valid for 1 hour and works once.',
    ],
    button: {
      label: 'Reset password',
      url: `${frontendUrl()}/auth/reset-password?token=${token}`,
    },
    footnote: IGNORE_IF_NOT_YOU,
  })

export const sendMagicLinkEmail = (to: string, token: string) =>
  send(to, {
    subject: `Your ${APP_NAME} sign-in link`,
    heading: 'Sign in without a password',
    paragraphs: [
      'Use the button below to sign in. The link is valid for 15 minutes and works once.',
    ],
    button: {
      label: `Sign in to ${APP_NAME}`,
      url: `${frontendUrl()}/auth/magic-link?token=${token}`,
    },
    footnote: IGNORE_IF_NOT_YOU,
  })

export const sendEmailChangeVerification = (
  to: string,
  { token, code }: { token: string; code: string },
) =>
  send(to, {
    subject: `Confirm your new ${APP_NAME} email address`,
    heading: 'Confirm your new email address',
    paragraphs: [
      `Your ${APP_NAME} account asked to use this address. Your current address keeps working until you confirm.`,
      'Enter this code in the app (valid for 30 minutes), or use the button (valid for 24 hours).',
    ],
    code,
    button: {
      label: 'Confirm new email',
      url: `${frontendUrl()}/auth/verify-new-email?token=${token}`,
    },
    footnote: IGNORE_IF_NOT_YOU,
  })

export const sendPasswordChangedEmail = (
  to: string,
  { viaReset }: { viaReset: boolean },
) =>
  send(to, {
    subject: `Your ${APP_NAME} password was changed`,
    heading: 'Your password was changed',
    paragraphs: [
      viaReset
        ? 'Your password was reset using a reset link. All devices were signed out.'
        : 'Your password was changed. Other devices were signed out.',
    ],
    footnote: SECURE_ACCOUNT,
  })

export const sendEmailChangedNotice = (oldEmail: string, newEmail: string) =>
  send(oldEmail, {
    subject: `Your ${APP_NAME} email address was changed`,
    heading: 'Your email address was changed',
    paragraphs: [
      `Your ${APP_NAME} account now uses ${newEmail}. This address will no longer receive account emails.`,
    ],
    footnote: `If this was not you, contact support immediately: someone may have access to your account.`,
  })

export const sendAccountDeletedEmail = (to: string) =>
  send(to, {
    subject: `Your ${APP_NAME} account was deleted`,
    heading: 'Your account was deleted',
    paragraphs: [
      `Your ${APP_NAME} account and its data were permanently deleted. We're sorry to see you go.`,
    ],
    footnote: `If you did not delete your account, reply to this email.`,
  })

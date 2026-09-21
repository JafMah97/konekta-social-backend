// Per-IP limits for unauthenticated auth endpoints, which are the usual
// targets for credential stuffing, code guessing and email bombing.
export const authRateLimits = {
  login: { max: 5, timeWindow: '1 minute' },
  register: { max: 5, timeWindow: '1 hour' },
  // 6-digit codes / link tokens: cap guesses
  verifyEmail: { max: 10, timeWindow: '15 minutes' },
  // Each call sends an email
  sendEmail: { max: 3, timeWindow: '15 minutes' },
  resetPassword: { max: 5, timeWindow: '15 minutes' },
}

// End-to-end smoke test against a running API with the demo data loaded.
// Used by CI; also handy after a deploy:
//
//   BASE_URL=http://localhost:4000 node scripts/smoke.mjs
//
// Plain Node (>= 18, global fetch), no dependencies.

const base = (process.env.BASE_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
)
const email = process.env.SMOKE_EMAIL ?? 'demo@example.com'
const password = process.env.SMOKE_PASSWORD ?? 'demo12345'

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`,
  )
}

async function request(path, { method = 'GET', cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(cookie && { cookie }),
      ...(body && { 'content-type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json, headers: res.headers }
}

console.log(`Smoke test against ${base}\n`)

const ping = await request('/ping')
check('GET /ping', ping.status === 200, String(ping.status))

const health = await request('/health')
check(
  'GET /health (database)',
  health.status === 200 && health.json?.db === 'ok',
  `${health.status}, db ${health.json?.dbLatencyMs} ms`,
)

const root = await fetch(base + '/', { redirect: 'manual' })
check(
  'GET / redirects to /docs',
  root.status >= 300 &&
    root.status < 400 &&
    root.headers.get('location') === '/docs',
  `${root.status} → ${root.headers.get('location')}`,
)

const docs = await request('/docs/json')
const paths = Object.keys(docs.json?.paths ?? {}).length
check('GET /docs/json', docs.status === 200 && paths > 40, `${paths} paths`)

const login = await request('/auth/login', {
  method: 'POST',
  body: { email, password },
})
const token = login.headers.get('set-cookie')?.match(/token=([^;]+)/)?.[1]
const cookie = token && `token=${token}`
check('POST /auth/login', login.status === 200 && !!token, String(login.status))

if (cookie) {
  const me = await request('/user/me', { cookie })
  const username = me.json?.data?.username ?? me.json?.username
  check('GET /user/me', me.status === 200 && !!username, username)

  const feed = await request('/posts/list', { cookie })
  const posts = feed.json?.data?.posts?.length ?? 0
  check('GET /posts/list', feed.status === 200 && posts > 0, `${posts} posts`)

  const inbox = await request('/notifications', { cookie })
  check(
    'GET /notifications',
    inbox.status === 200,
    `${inbox.json?.data?.pagination?.total} total`,
  )

  const logout = await request('/auth/logout', { method: 'POST', cookie })
  check('POST /auth/logout', logout.status === 200, String(logout.status))

  const after = await request('/user/me', { cookie })
  check(
    'old token rejected after logout',
    after.status === 401,
    String(after.status),
  )
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)

/** Same-origin account routes mounted on DSH's WebServer. */
import { CatalogError, passwordRecord, validPassword } from './auth-store.js'
import { isKey } from './config.js'

const LOGIN_SECONDS = 12 * 60 * 60
const MAX_BODY_BYTES = 8192
const loginPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>登录 DSH</title>
<style>body{font:14px system-ui;margin:0;background:#f6f7f8;color:#15171a;display:grid;min-height:100vh;place-items:center}main{background:white;border:1px solid #ddd;border-radius:20px;padding:32px;width:min(320px,75vw)}h1{font-size:22px;font-weight:500}label{display:grid;gap:8px;margin:20px 0}input,button{font:inherit;padding:12px;border:1px solid #ccc;border-radius:10px}button{width:100%;background:#17191c;color:white;cursor:pointer}.hint{color:#626872;line-height:1.6}a{color:inherit}</style></head>
<body><main><h1>登录 DSH</h1><p class="hint">使用项目管理员分配的账号登录</p>
<!--login-error--><form method="post" action="/_xlx/login"><label>用户名<input name="username" autocomplete="username" required maxlength="63"></label>
<label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button type="submit">登录</button></form></main></body></html>`

function header(request, name) {
  return request.headers instanceof Headers ? request.headers.get(name) : request.headers[name]
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    // Form navigation must retain its same-origin Origin header for CSRF validation.
    'referrer-policy': 'same-origin',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}
class RequestError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
  }
}
function showLogin(res, status = 200, code) {
  const messages = {
    'invalid-login': '用户名或密码不正确，或账号未获授权',
    forbidden: '登录请求来源无效，请刷新此页面后重试',
    'rate-limit': '登录尝试过多，请稍后重试',
    busy: '登录服务繁忙，请稍后重试',
  }
  const error = code === undefined ? '' : `<p role="alert">${messages[code] ?? '登录暂时失败，请稍后重试'}</p>`
  send(res, status, loginPage.replace('<!--login-error-->', error), {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  })
}
async function readBody(req, media) {
  if (req.headers['content-type']?.split(';')[0] !== media) throw new RequestError(415, 'invalid-body')
  const parts = []
  let size = 0
  for await (const part of req) {
    size += part.length
    if (size > MAX_BODY_BYTES) throw new RequestError(413, 'invalid-body')
    parts.push(part)
  }
  const text = Buffer.concat(parts).toString('utf8')
  try {
    return media === 'application/json' ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text))
  } catch {
    throw new RequestError(400, 'invalid-body')
  }
}

/** Create routes and account lookup without opening another listener.
 * @param {object} options Database, workspace provisioning and revocation owners.
 * @returns {object} HTTP handler, identity reader and lifecycle cleanup.
 */
export function createAccountHttp({ store, provision, revoke, secure }) {
  const cookieName = secure ? '__Host-xlx_dsh_session' : 'xlx_dsh_session'
  const cookie = (token, age) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`
  const attempts = new Map()
  let passwordOperations = 0
  let closed = false
  const tasks = new Set()
  const identity = (request) => {
    const audience = `${secure ? 'https' : 'http'}://${header(request, 'host') ?? new URL(request.url).host}`
    const matches = (header(request, 'cookie') ?? '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${cookieName}=`))
    const token = matches.length === 1 ? matches[0].slice(cookieName.length + 1) : undefined
    return { token, audience, user: store.lookup(token, audience) }
  }
  const derive = async (operation) => {
    if (passwordOperations >= 4) throw new RequestError(429, 'busy')
    passwordOperations++
    try {
      return await operation()
    } finally {
      passwordOperations--
    }
  }
  const dispatch = async (req, res) => {
    if (closed) throw new RequestError(503, 'unavailable')
    const { token, audience, user } = identity(req)
    const url = new URL(req.url, audience)
    if (url.origin !== audience) throw new RequestError(403, 'forbidden')
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      (req.headers.origin !== audience || ![undefined, 'same-origin', 'none'].includes(req.headers['sec-fetch-site']))
    ) {
      throw new RequestError(403, 'forbidden')
    }
    if (url.pathname === '/_xlx/login' && req.method === 'GET') {
      showLogin(res)
      return
    }
    if (url.pathname === '/_xlx/login' && req.method === 'POST') {
      const now = Date.now()
      for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key)
      const key = req.socket.remoteAddress
      const attempt = attempts.get(key) ?? { count: 0, until: now + 60_000 }
      if (++attempt.count > 12 || attempts.size > 1000) throw new RequestError(429, 'rate-limit')
      attempts.set(key, attempt)
      const body = await readBody(req, 'application/x-www-form-urlencoded')
      if (!isKey(body.username) || !validPassword(body.password)) throw new RequestError(401, 'invalid-login')
      const account = await derive(() => store.authenticate(body.username, body.password))
      if (!account || (!account.useHarness && !account.manageAccounts)) throw new RequestError(401, 'invalid-login')
      await provision(account)
      if (closed) throw new RequestError(503, 'unavailable')
      const nextToken = store.createLogin(account.id, audience, Date.now() + LOGIN_SECONDS * 1000)
      await revoke()
      send(res, 303, '', { location: '/', 'set-cookie': cookie(nextToken, LOGIN_SECONDS) })
      return
    }
    if (!user) throw new RequestError(401, 'login-required')
    if (url.pathname === '/_xlx/logout' && req.method === 'POST') {
      store.logout(token, audience)
      await revoke()
      send(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) })
      return
    }
    if (url.pathname === '/_xlx/me' && req.method === 'GET') {
      send(res, 200, { username: user.username, manageAccounts: user.manageAccounts })
      return
    }
    if (!user.manageAccounts) throw new RequestError(403, 'forbidden')
    if (url.pathname === '/_xlx/summary' && req.method === 'GET') {
      send(res, 200, { ...store.summary(), currentUser: user.username })
      return
    }
    const listing = /^\/_xlx\/(users|roles)$/.exec(url.pathname)
    if (listing && req.method === 'GET') {
      const search = (url.searchParams.get('search') ?? '').trim().toLowerCase()
      const after = url.searchParams.get('after') ?? ''
      const enabled = url.searchParams.get('enabled') ?? ''
      const limit = Number(url.searchParams.get('limit') ?? 10)
      if (
        !/^[a-z0-9_-]{0,63}$/.test(search) ||
        (after !== '' && !isKey(after)) ||
        !['', '0', '1'].includes(enabled) ||
        ![10, 20, 50].includes(limit) ||
        (listing[1] === 'roles' && enabled !== '')
      )
        throw new RequestError(400, 'invalid-query')
      send(res, 200, store.page(listing[1], { search, after, enabled, limit }))
      return
    }
    if (url.pathname === '/_xlx/catalog' && req.method === 'GET') {
      send(res, 200, { ...store.list(), currentUser: user.username })
      return
    }
    const match = /^\/_xlx\/(users|roles)\/([a-z][a-z0-9_-]{0,62})$/.exec(url.pathname)
    if (req.method !== 'PUT' || !match) throw new RequestError(404, 'not-found')
    const body = await readBody(req, 'application/json')
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'invalid-body')
    if (match[1] === 'roles') {
      if (typeof body.useHarness !== 'boolean' || typeof body.manageAccounts !== 'boolean')
        throw new RequestError(400, 'invalid-body')
      store.saveRole(match[2], body)
    } else {
      if (
        typeof body.enabled !== 'boolean' ||
        !Array.isArray(body.roles) ||
        body.roles.length > 30 ||
        body.roles.some((role) => !isKey(role)) ||
        new Set(body.roles).size !== body.roles.length ||
        (body.password !== undefined && !validPassword(body.password))
      )
        throw new RequestError(400, 'invalid-body')
      const credential = body.password === undefined ? undefined : await derive(() => passwordRecord(body.password))
      // Password derivation yields; an administrator may have been revoked meanwhile.
      if (!identity(req).user?.manageAccounts || closed) throw new RequestError(403, 'forbidden')
      store.saveUser(match[2], body, credential)
    }
    await revoke()
    send(res, 200, { ok: true })
  }
  return {
    identity,
    handle(req, res) {
      const task = dispatch(req, res).catch((error) => {
        if (res.headersSent) {
          res.destroy()
          return
        }
        const known = error instanceof RequestError || error instanceof CatalogError
        const status = error instanceof RequestError ? error.status : known ? 400 : 500
        if (req.method === 'POST' && req.url?.split('?')[0] === '/_xlx/login') {
          showLogin(res, status, known ? error.message : 'operation-failed')
          return
        }
        send(res, status, { error: known ? error.message : 'operation-failed' })
      })
      tasks.add(task)
      void task.finally(() => tasks.delete(task))
      return task
    },
    async close() {
      closed = true
      await Promise.allSettled(tasks)
      attempts.clear()
    },
  }
}

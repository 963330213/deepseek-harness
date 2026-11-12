/** Local authorization-code issuer for the DSH MCP resource. */
import { createHash, randomBytes } from 'node:crypto'
import OAuth2Server from '@node-oauth/oauth2-server'
import { readBody, readJson, sendJson } from './http.js'
import { showConsent } from './consent-page.js'

const PREFIX = '/_xlx_oauth'
const AUTHORIZE = PREFIX + '/authorize'
const TOKEN = PREFIX + '/token'
const REGISTER = PREFIX + '/register'
const METADATA = '/.well-known/oauth-authorization-server'
/** Routes advertised by the local issuer. */
export const ISSUER_ROUTES = [METADATA, AUTHORIZE, TOKEN, REGISTER]
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']
const FORM = 'application/x-www-form-urlencoded'
const SCOPE = 'mcp'
const APPROVAL_MS = 10 * 60 * 1000
const MAX_PENDING = 256
const MAX_GRANTS = 4096
const hash = value => createHash('sha256').update(value).digest('base64url')
const random = () => randomBytes(32).toString('base64url')

function params(search) {
  const result = Object.create(null)
  for (const [name, value] of search) {
    if (Object.hasOwn(result, name)) return
    result[name] = value
  }
  return result
}

function redirect(res, location) {
  res.writeHead(303, { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
}

function prune(entries) {
  const now = Date.now()
  for (const [id, row] of entries) if (row.expiresAt <= now) entries.delete(id)
}

/**
 * Authorize with local DSH browser accounts. Codes and access tokens expire on shutdown.
 * @param {URL} resource Canonical MCP resource URL.
 * @param {object} accounts Current project accounts and browser identity.
 * @param {object} clients Public client registration storage scoped to the resource.
 * @returns {object} OAuth HTTP handler, access token lookup and shutdown.
 */
export function createLocalOAuth(resource, accounts, clients) {
  const pending = new Map()
  const codes = new Map()
  const tokens = new Map()
  const tasks = new Map()
  let closed = false

  const pendingAttempt = id => {
    const attempt = pending.get(id)
    if (!closed && attempt && attempt.expiresAt > Date.now()) return attempt
  }
  const currentAccount = user => accounts.enabledHarnessAccount(user.username)?.id === user.id
  const model = {
    getClient(id, secret) {
      if (!secret) return clients.get(resource.href, id)
    },
    saveAuthorizationCode(code, client, user) {
      prune(codes)
      if (closed || codes.size >= MAX_GRANTS) throw new Error('Authorization code capacity exhausted')
      codes.set(hash(code.authorizationCode), { ...code, authorizationCode: undefined, client, user })
      return code
    },
    getAuthorizationCode(value) {
      const code = codes.get(hash(value))
      if (code && currentAccount(code.user)) return { ...code, authorizationCode: value }
    },
    revokeAuthorizationCode(code) {
      return codes.delete(hash(code.authorizationCode))
    },
    saveToken(token, client, user) {
      prune(tokens)
      if (closed || tokens.size >= MAX_GRANTS) throw new Error('Access token capacity exhausted')
      tokens.set(hash(token.accessToken), { user, expiresAt: token.accessTokenExpiresAt.getTime() })
      return { ...token, client, user }
    },
  }
  const oauth = new OAuth2Server({
    model,
    requirePKCE: true,
    allowEmptyState: true,
    accessTokenLifetime: 3600,
    requireClientAuthentication: { authorization_code: false },
  })

  function register(res, input) {
    const redirects = input?.redirect_uris
    if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 8
      || ![undefined, 'none'].includes(input.token_endpoint_auth_method)) {
      return sendJson(res, 400, { error: 'invalid_client_metadata' })
    }
    if (redirects.some(value => {
      const url = typeof value === 'string' && value.length <= 512 && URL.parse(value)
      // Browser cookies are scoped to a host across ports, so callbacks cannot share the sign-in host.
      return !url || !['http:', 'https:'].includes(url.protocol) || !LOOPBACK.includes(url.hostname)
        || url.hostname === resource.hostname
        || !url.port || url.username || url.password || url.hash || url.href !== value
    })) return sendJson(res, 400, { error: 'invalid_redirect_uri' })
    const name = typeof input.client_name === 'string' ? input.client_name.trim() : 'MCP 客户端'
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) {
      return sendJson(res, 400, { error: 'invalid_client_metadata' })
    }
    const client = clients.add(resource.href, name, [...new Set(redirects)].sort())
    if (!client) return sendJson(res, 503, { error: 'temporarily_unavailable' })
    sendJson(res, 201, {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: client.grants,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
  }

  async function authorize(req, res, query) {
    if (req.method === 'GET' && !Object.hasOwn(query, 'request')) {
      const client = clients.get(resource.href, query.client_id ?? '')
      if (!client || !client.redirectUris.includes(query.redirect_uri) || query.response_type !== 'code'
        || query.resource !== resource.href || (query.scope ?? SCOPE) !== SCOPE
        || query.code_challenge_method !== 'S256' || !/^[\w-]{43}$/.test(query.code_challenge ?? '')
        || (query.state?.length ?? 0) > 1024) {
        return showConsent(res, 400, '授权请求无效，请回到 MCP 客户端重新连接。')
      }
      prune(pending)
      if (pending.size >= MAX_PENDING) return showConsent(res, 503, '授权请求过多，请稍后重试。')
      const request = random()
      const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } = query
      pending.set(request, {
        query: { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state, scope: SCOPE },
        expiresAt: Date.now() + APPROVAL_MS,
      })
      return redirect(res, AUTHORIZE + '?request=' + request)
    }

    const id = query.request
    const attempt = pendingAttempt(id)
    if (!attempt) {
      return showConsent(res, 400, '授权请求已失效，请回到 MCP 客户端重新连接。')
    }
    const login = accounts.browserAccess(req)
    if (req.method === 'GET') {
      if (!login.signedIn) return redirect(res, '/_xlx/login?' + new URLSearchParams({ continue: AUTHORIZE + '?request=' + id }))
      if (!login.account || (attempt.loginId && attempt.loginId !== login.loginId)) {
        return showConsent(res, 403, '当前 DSH 账号不能完成此授权。请使用有访问权限的账号重新发起连接。')
      }
      attempt.loginId = login.loginId
      const client = clients.get(resource.href, attempt.query.client_id)
      return showConsent(res, 200, '允许后，此客户端可以在你的 DSH 工作区创建会话、发送消息和读取回复。', {
        clientName: client.name,
        username: login.account.username,
        callback: new URL(attempt.query.redirect_uri),
      })
    }
    if (req.headers.origin !== resource.origin || !login.account || !attempt.loginId || login.loginId !== attempt.loginId) {
      return showConsent(res, 403, '当前登录无法确认此授权，请从客户端重新发起连接。')
    }
    const form = params(new URLSearchParams(await readBody(req, FORM)))
    const current = accounts.browserAccess(req)
    if (closed || !current.account || current.loginId !== attempt.loginId || attempt.expiresAt <= Date.now()
      || !['allow', 'deny'].includes(form?.decision) || !pending.delete(id)) {
      return showConsent(res, 400, '授权请求已失效，请回到 MCP 客户端重新连接。')
    }
    const request = new OAuth2Server.Request({
      method: 'POST', headers: req.headers, query: attempt.query,
      body: { allowed: form.decision === 'allow' ? 'true' : 'false' },
    })
    const response = new OAuth2Server.Response()
    try {
      await oauth.authorize(request, response, { authenticateHandler: { handle: () => current.account } })
    } catch (error) {
      if (error.name !== 'access_denied') return showConsent(res, 400, '无法完成授权，请回到客户端重试。')
    }
    const callback = new URL(response.get('location'))
    callback.searchParams.set('iss', resource.origin)
    return redirect(res, callback.href)
  }

  async function dispatch(req, res) {
    if (closed || req.headers.host?.toLowerCase() !== resource.host
      || (req.headers.origin && req.headers.origin !== resource.origin)) {
      return sendJson(res, 403, { error: 'untrusted-origin' })
    }
    const url = new URL(req.url, resource.origin)
    if (url.origin !== resource.origin) return sendJson(res, 400, { error: 'invalid_request' })
    if (url.pathname === METADATA && req.method === 'GET') {
      return sendJson(res, 200, {
        issuer: resource.origin,
        authorization_endpoint: resource.origin + AUTHORIZE,
        token_endpoint: resource.origin + TOKEN,
        registration_endpoint: resource.origin + REGISTER,
        scopes_supported: [SCOPE],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      })
    }
    if (url.pathname === AUTHORIZE && ['GET', 'POST'].includes(req.method)) {
      const query = params(url.searchParams)
      if (!query) return showConsent(res, 400, '授权参数无效，请回到 MCP 客户端重新连接。')
      return authorize(req, res, query)
    }
    if (url.pathname === REGISTER && req.method === 'POST') return register(res, await readJson(req))
    if (url.pathname === TOKEN && req.method === 'POST') {
      const body = params(new URLSearchParams(await readBody(req, FORM)))
      if (!body || body.grant_type !== 'authorization_code' || body.resource !== resource.href || !body.redirect_uri) {
        return sendJson(res, 400, { error: 'invalid_request' })
      }
      const request = new OAuth2Server.Request({ method: 'POST', headers: req.headers, query: {}, body })
      const response = new OAuth2Server.Response()
      try {
        await oauth.token(request, response)
      } catch (error) {
        const known = error instanceof OAuth2Server.OAuthError && [400, 401].includes(error.code)
        return sendJson(res, known ? error.code : 500, { error: known ? error.name : 'server_error' })
      }
      return sendJson(res, response.status, response.body)
    }
    sendJson(res, 405, { error: 'method_not_allowed' })
  }

  return {
    acceptsLogin(audience, requestId) {
      const attempt = audience === resource.origin && pendingAttempt(requestId)
      return Boolean(attempt && !attempt.loginId)
    },
    authorizeToken(value) {
      const token = !closed && tokens.get(hash(value))
      if (token && token.expiresAt > Date.now()) return token
    },
    handle(req, res) {
      const task = dispatch(req, res).catch(error => {
        if (res.destroyed || res.writableEnded) return
        if (res.headersSent) return res.destroy()
        const status = error instanceof SyntaxError ? 400 : [413, 415].includes(error.status) ? error.status : 500
        sendJson(res, status, { error: status === 500 ? 'server_error' : 'invalid_request' })
      })
      tasks.set(req, task)
      return task.finally(() => tasks.delete(req))
    },
    async close() {
      closed = true
      for (const req of tasks.keys()) req.destroy()
      await Promise.allSettled(tasks.values())
      pending.clear()
      codes.clear()
      tokens.clear()
    },
  }
}

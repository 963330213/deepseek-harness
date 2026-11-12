/** Expose the Web profile as an MCP resource protected by DSH-issued access tokens. */
import { randomUUID } from 'node:crypto'
import { readJson, sendJson as send } from './oauth-http.js'

const SCOPE = 'mcp'
/** Discovery path advertised in the MCP authentication challenge. */
export const MCP_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp'

/**
 * Serve stateless MCP requests with one scoped DSH peer per verified HTTP request.
 * @param {object} config Validated local MCP resource URL.
 * @param {object} runtime Account, workspace, peer and Remote invocation operations.
 * @returns {Promise<object>} Route handlers and shutdown that drains admitted requests.
 */
export async function createOAuthMcp(config, { store, authorizeToken, provision, createPeer, invoke }) {
  const [{ McpServer, createMcpHandler }, { toNodeHandler }, { z }] = await Promise.all([
    import('@modelcontextprotocol/server'),
    import('@modelcontextprotocol/node'),
    import('zod'),
  ])
  const shutdown = new AbortController()
  const tasks = new Set()
  const challenge = `Bearer resource_metadata="${config.resource.origin}${MCP_METADATA_PATH}", scope="${SCOPE}"`
  const sessionId = z.string().trim().min(1).max(200)
  const trusted = req =>
    req.headers.host?.toLowerCase() === config.resource.host &&
    (req.headers.origin === undefined || req.headers.origin === config.resource.origin)

  function server(peer, workspace, requestSignal) {
    const mcp = new McpServer({ name: 'deepseek-harness', version: '1.0.0' }, { capabilities: { tools: {} } })
    const tool = (name, description, inputSchema, execute) => {
      mcp.registerTool(name, { description, inputSchema }, async (args, context) => {
        try {
          const signal = AbortSignal.any([requestSignal, context.signal].filter(Boolean))
          signal.throwIfAborted()
          const call = (method, args) => invoke({ peer, namespace: 'session', method, args, signal })
          return { content: [{ type: 'text', text: JSON.stringify(await execute(call, args)) }] }
        } catch (error) {
          const code = typeof error?.code === 'string' && /^[\w/-]{1,80}$/.test(error.code) ? ` (${error.code})` : ''
          return { isError: true, content: [{ type: 'text', text: `DSH could not complete this operation${code}.` }] }
        }
      })
    }
    tool(
      'dsh_list_sessions',
      'List recent sessions owned by the authorized account.',
      z.object({ offset: z.number().int().min(0).default(0) }),
      async (call, { offset }) => {
        const { items } = await call('list', { _request: {} })
        const sessions = items.filter(item => item.parentSessionId === undefined)
        return {
          items: sessions
            .slice(offset, offset + 20)
            .map(({ sessionId, updatedAt, running, blank }) => ({ sessionId, updatedAt, running, blank })),
          nextOffset: offset + 20 < sessions.length ? offset + 20 : null,
        }
      },
    )
    tool('dsh_create_session', 'Create a session in the authorized account’s workspace.', z.object({}), call =>
      call('create', { request: { workspaceId: workspace.id } }),
    )
    tool(
      'dsh_send_message',
      'Queue a text message in an owned session. Read replies separately.',
      z.object({ sessionId, text: z.string().trim().min(1).max(12000) }),
      (call, args) =>
        call('prompt', {
          request: {
            sessionId: args.sessionId,
            requestId: randomUUID(),
            mode: 'queue',
            content: [{ type: 'text', text: args.text }],
          },
        }),
    )
    tool(
      'dsh_read_replies',
      'Read recent assistant text from an owned session.',
      z.object({ sessionId, beforeSeq: z.number().int().positive().optional() }),
      async (call, args) => {
        const page = await call('events', {
          request: {
            address: { kind: 'session', sessionId: args.sessionId },
            maxMessages: 20,
            ...(args.beforeSeq === undefined ? {} : { beforeSeq: args.beforeSeq }),
          },
        })
        return {
          replies: page.records
            .map(record => record.event)
            .filter(event => event.type === 'assistant/message' && event.surfaceOp === 'append')
            .map(record => ({
              seq: record.seq,
              text: record.data.message.content
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join(''),
            }))
            .filter(reply => reply.text.length > 0),
          nextBeforeSeq: page.hasMore ? (page.records[0]?.event.seq ?? null) : null,
        }
      },
    )
    return mcp
  }

  async function dispatch(req, res) {
    if (!trusted(req)) return send(res, 403, { error: 'untrusted-origin' })
    const token = /^Bearer ([A-Za-z0-9._~-]{1,200})$/i.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return send(res, 401, { error: 'authorization-required' }, { 'www-authenticate': challenge })
    const request = new AbortController()
    const abort = () => request.abort()
    const destroy = () => req.destroy()
    res.once('close', abort)
    shutdown.signal.addEventListener('abort', destroy, { once: true })
    const signal = AbortSignal.any([request.signal, shutdown.signal])
    try {
      const grant = authorizeToken(token)
      if (!grant)
        return send(res, 401, { error: 'invalid-token' }, { 'www-authenticate': challenge + ', error="invalid_token"' })
      const account = store.enabledHarnessAccount(grant.user.username)
      if (account?.id !== grant.user.id) return send(res, 403, { error: 'dsh-account-not-authorized' })
      if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' }, { allow: 'POST' })
      let body
      try {
        body = await readJson(req)
      } catch (failure) {
        if (!signal.aborted && !res.destroyed)
          send(res, [413, 415].includes(failure.status) ? failure.status : 400, { error: 'invalid-mcp-body' })
        return
      }
      await provision(account)
      if (grant.expiresAt <= Date.now())
        return send(res, 401, { error: 'invalid-token' }, { 'www-authenticate': challenge })
      signal.throwIfAborted()
      const peer = createPeer(account)
      const handler = createMcpHandler(() => server(peer, store.workspace(account.id), signal))
      try {
        res.setHeader('cache-control', 'no-store')
        await toNodeHandler(handler)(req, res, body)
      } finally {
        try {
          await handler.close()
        } finally {
          await peer.dispose()
        }
      }
    } finally {
      res.off('close', abort)
      shutdown.signal.removeEventListener('abort', destroy)
    }
  }

  return {
    metadataPath: MCP_METADATA_PATH,
    metadata(req, res) {
      if (!trusted(req)) return send(res, 403, { error: 'untrusted-origin' })
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' }, { allow: 'GET' })
      send(res, 200, {
        resource: config.resource.href,
        authorization_servers: [config.resource.origin],
        scopes_supported: [SCOPE],
        bearer_methods_supported: ['header'],
      })
    },
    handle(req, res) {
      if (shutdown.signal.aborted) return send(res, 503, { error: 'mcp-unavailable' })
      const task = dispatch(req, res).catch(() => {
        if (res.destroyed || res.writableEnded) return
        if (res.headersSent) res.destroy()
        else send(res, 500, { error: 'mcp-operation-failed' })
      })
      tasks.add(task)
      void task.finally(() => tasks.delete(task))
      return task
    },
    async close() {
      shutdown.abort()
      await Promise.allSettled(tasks)
    },
  }
}

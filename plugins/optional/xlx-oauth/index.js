/** Mount OAuth settings and the protected MCP resource on DSH Web. */
import { realpath } from 'node:fs/promises'
import { createLocalOAuth, ISSUER_ROUTES } from './local-oauth.js'
import { createMcpSettings } from './mcp-settings.js'
import { openOAuthClients } from './oauth-clients.js'
import { createOAuthMcp, MCP_METADATA_PATH } from './oauth-mcp.js'
import { createSettingsHttp, SETTINGS_PATH } from './settings-http.js'

export const name = 'xlx-oauth'
export const inject = ['xlxProjectAccounts', 'webServer', 'connection', 'remoteAccess', 'typertGateway', 'credentials']

/** Mount OAuth without changing the project's browser authentication or account roles.
 * @param {object} ctx Plugin-owned Cordis context.
 * @param {{resource?: string}} options Optional initial MCP resource URL.
 */
export async function apply(ctx, options = {}) {
  const accounts = ctx.xlxProjectAccounts
  const project = await realpath(accounts.database)
  let clients
  ctx.effect(() => () => clients?.close(), 'xlx-oauth: registered MCP clients')
  const settings = await createMcpSettings(ctx.credentials, project, options.resource, async resource => {
    clients ??= openOAuthClients(project + '.mcp-clients.sqlite')
    const issuer = createLocalOAuth(resource, accounts, clients)
    const mcp = await createOAuthMcp({ resource }, {
      store: accounts,
      authorizeToken: issuer.authorizeToken,
      provision: user => accounts.provisionWorkspace(user),
      createPeer: user => ctx.connection.createPeer({
        principal: { kind: 'xlx-mcp', id: user.id, username: user.username },
        interactions: 'none',
      }),
      invoke: request => ctx.typertGateway.invoke(request),
    })
    return {
      ...mcp,
      issuer: issuer.handle,
      async close() {
        await Promise.all([mcp.close(), issuer.close()])
      },
    }
  })
  ctx.effect(() => () => settings.close(), 'xlx-oauth: MCP request lifetimes')
  ctx.effect(() => ctx.remoteAccess.registerPolicy('xlx-mcp', {
    bindings(principal) {
      const user = accounts.enabledHarnessAccount(principal.username)
      return user?.id === principal.id ? accounts.bindings(user) : []
    },
  }), 'xlx-oauth: MCP account grants')
  const http = createSettingsHttp(settings, request => accounts.browserAccess(request), () => {
    ctx.logger.error('xlx-oauth: could not complete the MCP configuration request')
  })
  ctx.effect(() => () => http.close(), 'xlx-oauth: settings request lifetimes')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: SETTINGS_PATH, handler: http.handle }), 'xlx-oauth: settings')
  for (const [path, method] of [
    [MCP_METADATA_PATH, 'metadata'],
    ['/mcp', 'handle'],
    ...ISSUER_ROUTES.map(path => [path, 'issuer']),
  ]) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler(req, res) {
        const active = settings.current()
        if (active) return active[method](req, res)
        res.writeHead(404, { 'cache-control': 'no-store' }).end()
      },
    }), `xlx-oauth: MCP route ${path}`)
  }
}

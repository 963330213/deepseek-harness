/** Project account authentication and settings on the existing DSH listener. */
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { openAuthStore } from './auth-store.js'
import { createAccountHttp } from './project-http.js'
import { accountBindings } from './permissions.js'

export const name = 'xlx-auth'
export const inject = ['webServer', 'connection', 'remoteAccess', 'workspaceRegistry']

/** Install account routes and scoped resource grants.
 * @param {object} ctx Plugin-owned Cordis context.
 * @param {{file: string}} options Server-owned JSON configuration path.
 */
export async function apply(ctx, options) {
  const config = JSON.parse(readFileSync(options.file, 'utf8'))
  if (!isAbsolute(config.database) || !isAbsolute(config.workspacesDirectory)
    || !/^[a-z][a-z0-9_-]{0,62}$/.test(config.bootstrapUser)) {
    throw new Error('xlx-auth: configure absolute database/workspacesDirectory paths and a canonical bootstrapUser')
  }
  await mkdir(dirname(config.database), { recursive: true })
  const store = await openAuthStore(config)
  ctx.effect(() => () => store.close(), 'xlx-auth: authorization database')
  const peers = new Map()
  const provisioning = new Map()
  const provision = async user => {
    if (user.manageAccounts) return
    if (provisioning.has(user.id)) return provisioning.get(user.id)
    const work = (async () => {
      const existing = store.workspace(user.id)
      if (existing && ctx.workspaceRegistry.get(existing.id)) return
      const directory = join(config.workspacesDirectory, String(user.id))
      await mkdir(directory, { recursive: true })
      const workspace = await ctx.workspaceRegistry.create(directory, user.username)
      store.assignWorkspace(user.id, workspace.id, workspace.path)
    })()
    provisioning.set(user.id, work)
    try { await work } finally { provisioning.delete(user.id) }
  }
  const revoke = async () => {
    ctx.remoteAccess.invalidate()
    const retired = []
    for (const [token, record] of peers) {
      if (store.lookup(token, record.audience)) continue
      peers.delete(token)
      clearTimeout(record.timer)
      retired.push(record.peer.dispose())
    }
    await Promise.all(retired)
  }
  const http = createAccountHttp({ store, provision, revoke, secure: ctx.webServer.protocol === 'https:' })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/_xlx', handler: http.handle }), 'xlx-auth: account routes')
  ctx.effect(() => ctx.remoteAccess.registerPolicy('xlx-user', {
    bindings: principal => {
      const record = peers.get(principal.token)
      const user = record && store.lookup(principal.token, record.audience)
      return user?.useHarness ? accountBindings(store, user) : []
    },
  }), 'xlx-auth: user resource access')
  ctx.on('session/created', session => {
    store.recordSession(session.header)
    ctx.remoteAccess.invalidate()
  })
  const admit = request => {
    const { token, audience, user } = http.identity(request)
    if (!user || (!user.useHarness && !user.manageAccounts)) return { rejection: 401 }
    let record = peers.get(token)
    if (!record) {
      const peer = ctx.connection.createPeer({
        principal: user.manageAccounts ? { kind: 'owner' } : { kind: 'xlx-user', userId: user.id, token },
      })
      const timer = setTimeout(() => {
        peers.delete(token)
        void peer.dispose().catch(error => ctx.logger.error('xlx-auth: account connection cleanup failed', error))
      }, Math.max(1, user.expiresAt - Date.now()))
      timer.unref()
      record = { peer, audience, timer }
      peers.set(token, record)
    }
    return { peer: record.peer }
  }
  ctx.effect(() => ctx.connection.registerBrowserAuthentication({
    admit,
    authorizeIndex(request, response) {
      if (!('rejection' in admit(request))) return true
      response.writeHead(303, { location: '/_xlx/login', 'cache-control': 'no-store' })
      response.end()
      return false
    },
  }), 'xlx-auth: project login')
  ctx.effect(() => async () => {
    await http.close()
    await Promise.allSettled(provisioning.values())
    for (const record of peers.values()) clearTimeout(record.timer)
    await Promise.all([...peers.values()].map(record => record.peer.dispose()))
    peers.clear()
  }, 'xlx-auth: login lifetimes')
}

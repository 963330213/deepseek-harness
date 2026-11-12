/** Persist the administrator's local MCP settings and own the active routes. */
import { createHash, randomUUID } from 'node:crypto'

const denied = { status: 403, error: 'forbidden' }
const conflict = { status: 409, error: 'mcp-settings-changed' }
const invalid = { status: 400, error: 'invalid-mcp-settings' }

function resourceUrl(value) {
  const url = typeof value === 'string' && value.length <= 512 && URL.parse(value)
  const loopback = url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!url || (url.protocol !== 'https:' && !loopback) || url.pathname !== '/mcp'
    || url.username || url.password || url.search || url.hash) return
  return url
}

/**
 * Restore local settings and leave any external issuer records inactive.
 * @param {object} credentials DSH credential storage service.
 * @param {string} project Canonical project account database path.
 * @param {string | undefined} initialResource Optional initial resource URL.
 * @param {Function} open Create the issuer and protected resource for a validated URL.
 * @returns {Promise<object>} Admin settings operations and the current routes.
 */
export async function createMcpSettings(credentials, project, initialResource, open) {
  const key = 'xlx-oauth/local-' + createHash('sha256').update(project).digest('hex')
  const record = await credentials.readRecord(key)
  let settings = record?.payload ?? { enabled: initialResource !== undefined, resource: initialResource ?? '', revision: null }
  if ((record && (record.kind !== 'grant' || typeof settings.revision !== 'string'))
    || typeof settings.enabled !== 'boolean' || typeof settings.resource !== 'string'
    || (settings.resource && !resourceUrl(settings.resource)) || (settings.enabled && !settings.resource)) {
    throw new Error('xlx-oauth: invalid local MCP settings')
  }
  let active = settings.enabled ? await open(resourceUrl(settings.resource)) : undefined
  let saving = false

  return {
    snapshot: () => settings,
    current: () => active,
    async save(draft, authorized) {
      if (typeof draft?.enabled !== 'boolean') return invalid
      if (saving || draft.revision !== settings.revision) return conflict
      const resource = draft.enabled ? resourceUrl(draft.resource)?.href : settings.resource
      if (resource === undefined) return invalid
      saving = true
      let next
      try {
        const sameResource = draft.enabled && active && resource === settings.resource
        if (draft.enabled && !sameResource) next = await open(new URL(resource))
        const payload = { enabled: draft.enabled, resource, revision: randomUUID() }
        let rejected
        await credentials.modifyRecord(key, async previous => {
          if (!authorized()) rejected = denied
          else if ((previous?.payload?.revision ?? null) !== settings.revision) rejected = conflict
          if (!rejected) return { kind: 'grant', payload }
        })
        if (rejected) return rejected
        settings = payload
        if (!sameResource) {
          const previous = active
          active = next
          next = undefined
          await previous?.close()
        }
        return { value: settings }
      } finally {
        saving = false
        await next?.close()
      }
    },
    async close() {
      await active?.close()
    },
  }
}

/** Restrict OAuth configuration to signed-in project administrators. */
import { readJson, sendJson } from './http.js'

/** Web-only OAuth configuration endpoint. */
export const SETTINGS_PATH = '/_xlx_oauth/settings'

/**
 * Serve and update the OAuth configuration without returning the service secret.
 * @param {object} settings Persisted configuration and live endpoint owner.
 * @param {Function} browserAccess Read the caller's current project login and admin grant.
 * @param {Function} report Report unexpected configuration failures without request data.
 * @returns {object} Route handler and shutdown that drains pending writes.
 */
export function createSettingsHttp(settings, browserAccess, report) {
  const tasks = new Map()
  let closed = false

  async function dispatch(req, res) {
    if (closed) return sendJson(res, 503, { error: 'unavailable' })
    const { audience, signedIn, manageAccounts } = browserAccess(req)
    if (!signedIn) return sendJson(res, 401, { error: 'login-required' })
    if (!manageAccounts) return sendJson(res, 403, { error: 'forbidden' })
    if (req.method === 'GET') return sendJson(res, 200, settings.snapshot())
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'method-not-allowed' }, { allow: 'GET, PUT' })
    if (req.headers.origin !== audience || ![undefined, 'same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
      return sendJson(res, 403, { error: 'forbidden' })
    }
    let draft
    try {
      draft = await readJson(req)
    } catch (error) {
      if (res.destroyed) return
      return sendJson(res, [413, 415].includes(error.status) ? error.status : 400, { error: 'invalid-mcp-settings' })
    }
    const result = await settings.save(draft, () => !closed && browserAccess(req).manageAccounts)
    if (result.error) return sendJson(res, result.status, { error: result.error })
    return sendJson(res, 200, result.value)
  }

  return {
    handle(req, res) {
      const task = dispatch(req, res).catch(() => {
        report()
        if (res.destroyed || res.writableEnded) return
        if (res.headersSent) res.destroy()
        else sendJson(res, 500, { error: 'mcp-settings-unavailable' })
      })
      tasks.set(req, task)
      return task.finally(() => tasks.delete(req))
    },
    async close() {
      closed = true
      for (const req of tasks.keys()) req.destroy()
      await Promise.allSettled(tasks.values())
    },
  }
}

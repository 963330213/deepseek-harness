/** Durable registrations for public MCP clients. */
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const MAX_CLIENTS = 4096

/**
 * Keep client IDs stable across service restarts and resource toggles.
 * @param {string} filename Project-scoped registration database path.
 * @returns {object} Client lookups, registrations and close operation.
 */
export function openOAuthClients(filename) {
  const db = new DatabaseSync(filename)
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS clients (
        resource TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, redirects TEXT NOT NULL,
        PRIMARY KEY (resource, id), UNIQUE (resource, name, redirects)
      );
    `)
    const find = db.prepare('SELECT id, name, redirects FROM clients WHERE resource = ? AND id = ?')
    const existing = db.prepare('SELECT id, name, redirects FROM clients WHERE resource = ? AND name = ? AND redirects = ?')
    const insert = db.prepare(`
      INSERT OR IGNORE INTO clients (resource, id, name, redirects)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM clients) < ?
    `)
    const client = row => row && ({
      id: row.id,
      name: row.name,
      redirectUris: JSON.parse(row.redirects),
      grants: ['authorization_code'],
    })
    return {
      get: (resource, id) => client(find.get(resource, id)),
      add(resource, name, redirects) {
        const text = JSON.stringify(redirects)
        const previous = existing.get(resource, name, text)
        if (previous) return client(previous)
        insert.run(resource, randomBytes(24).toString('base64url'), name, text, MAX_CLIENTS)
        return client(existing.get(resource, name, text))
      },
      close: () => db.close(),
    }
  } catch (error) {
    db.close()
    throw error
  }
}

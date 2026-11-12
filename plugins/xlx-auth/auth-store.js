/** Own local credentials, role grants and gateway login sessions in an independent SQLite database. */
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { ADMIN_ROLE } from './config.js'

const scryptAsync = promisify(scrypt)
const derive = (password, salt) => scryptAsync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 40 * 1024 * 1024 })
const dummySalt = randomBytes(16)
const dummyHash = randomBytes(64)
const schema = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash BLOB NOT NULL CHECK (length(password_hash) = 64),
    password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
  ) STRICT;
  CREATE TABLE roles (
    name TEXT PRIMARY KEY,
    use_harness INTEGER NOT NULL CHECK (use_harness IN (0, 1)),
    manage_accounts INTEGER NOT NULL CHECK (manage_accounts IN (0, 1))
  ) STRICT;
  CREATE TABLE user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id),
    role_name TEXT NOT NULL REFERENCES roles(name),
    PRIMARY KEY (user_id, role_name)
  ) STRICT;
  CREATE INDEX user_roles_by_role ON user_roles(role_name, user_id);
  CREATE TABLE logins (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    audience TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    UNIQUE (user_id, audience)
  ) STRICT;
  CREATE INDEX logins_by_expiry ON logins(expires_at);
  PRAGMA user_version = 1;
`

const account = `
  SELECT u.id, u.username, u.enabled, u.password_hash, u.password_salt,
    EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.name = ur.role_name
      WHERE ur.user_id = u.id AND r.use_harness = 1) AS useHarness,
    EXISTS (SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_name = ?) AS manageAccounts
  FROM users u
`

const ownershipSchema = `
  CREATE TABLE user_workspaces (
    user_id INTEGER PRIMARY KEY REFERENCES users(id), workspace_id TEXT NOT NULL UNIQUE,
    directory TEXT NOT NULL UNIQUE
  ) STRICT;
  CREATE TABLE user_sessions (
    session_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id)
  ) STRICT;
  CREATE INDEX user_sessions_by_user ON user_sessions(user_id, session_id);
  PRAGMA user_version = 2;
`
const teamGrantsSchema = `
  ALTER TABLE roles ADD COLUMN team_members TEXT
    CHECK (team_members IS NULL OR json_type(team_members) = 'array');
  PRAGMA user_version = 3;
`

function roleTeamMembers(role) {
  if (role.team_members !== null) return JSON.parse(role.team_members)
  return role.name === ADMIN_ROLE ? null : []
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Check password length before entering the bounded password derivation pool.
 * @param {unknown} password Candidate supplied by a user or operator.
 * @returns {boolean} Whether its length matches the browser's 6–256 character bounds.
 */
export function validPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 256
}

/**
 * Generate a fresh salt and derive the credential stored for an account.
 * @param {string} password Validated password.
 * @returns {Promise<{salt: Buffer, hash: Buffer}>} Credential material.
 */
export async function passwordRecord(password) {
  const salt = randomBytes(16)
  return { salt, hash: await derive(password, salt, 64) }
}

/**
 * Open and initialize the authorization database. Bootstrap only when the database has no accounts.
 * @param {object} config Database path and bootstrap username.
 * @returns {Promise<object>} Database operations and the close function.
 */
export async function openAuthStore(config) {
  const db = new DatabaseSync(config.database)
  function transaction(run) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function requireAdmin() {
    return Boolean(
      db
        .prepare(
          `
      SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.enabled = 1 AND ur.role_name = ? LIMIT 1
    `,
        )
        .get(ADMIN_ROLE),
    )
  }

  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
    transaction(() => {
      const { user_version: version } = db.prepare('PRAGMA user_version').get()
      if (version === 0) db.exec(schema)
      else if (version !== 1 && version !== 2 && version !== 3) throw new Error('xlx-auth: unsupported authorization database version')
      if (version < 2) db.exec(ownershipSchema)
      if (version < 3) db.exec(teamGrantsSchema)
    })
    if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
      const password = process.env.DSH_XLX_BOOTSTRAP_PASSWORD
        ?? (config.bootstrapPasswordFile ? (await readFile(config.bootstrapPasswordFile, 'utf8')).trim() : undefined)
      if (!validPassword(password))
        throw new Error('xlx-auth: set DSH_XLX_BOOTSTRAP_PASSWORD to 6–256 characters for the first startup')
      const { hash, salt } = await passwordRecord(password)
      transaction(() => {
        if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) return
        const { lastInsertRowid } = db
          .prepare('INSERT INTO users (username, password_hash, password_salt, enabled) VALUES (?, ?, ?, 1)')
          .run(config.bootstrapUser, hash, salt)
        db.prepare('INSERT INTO roles (name, use_harness, manage_accounts) VALUES (?, 1, 1), (?, 1, 0)').run(
          ADMIN_ROLE,
          'member',
        )
        db.prepare('INSERT INTO user_roles (user_id, role_name) VALUES (?, ?)').run(lastInsertRowid, ADMIN_ROLE)
      })
    }
    if (!requireAdmin()) throw new Error('xlx-auth: no enabled administrator exists')
  } catch (error) {
    db.close()
    throw error
  }

  const find = db.prepare(account + ' WHERE u.username = ?')
  const enabledHarnessAccount = db.prepare(`
    SELECT a.id, a.username FROM (${account}) a
    WHERE a.username = ? AND a.enabled = 1 AND a.useHarness = 1
  `)
  const byLogin = db.prepare(`
    SELECT l.expires_at, a.id, a.username, a.enabled, a.useHarness, a.manageAccounts
    FROM logins l JOIN (${account}) a ON a.id = l.user_id
    WHERE l.token_hash = ? AND l.audience = ? AND l.expires_at > ?
  `)
  const sessionOwner = db.prepare('SELECT user_id FROM user_sessions WHERE session_id = ?')
  const ownedSessionRoles = db.prepare(`
    SELECT r.name, r.team_members FROM users u
    JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.name = ur.role_name
    WHERE u.id = ? AND u.enabled = 1 AND EXISTS (
      SELECT 1 FROM user_roles gr JOIN roles g ON g.name = gr.role_name
      WHERE gr.user_id = u.id AND (g.use_harness = 1 OR g.name = ?)
    )
  `)
  const adminTeamRole = db.prepare('SELECT name, team_members FROM roles WHERE name = ?')

  return {
    enabledHarnessAccount(username) {
      return enabledHarnessAccount.get(ADMIN_ROLE, username)
    },
    workspace(userId) {
      return db.prepare('SELECT workspace_id AS id, directory FROM user_workspaces WHERE user_id = ?').get(userId)
    },
    assignWorkspace(userId, workspaceId, directory) {
      db.prepare(
        'INSERT INTO user_workspaces (user_id, workspace_id, directory) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET workspace_id = excluded.workspace_id, directory = excluded.directory',
      ).run(userId, workspaceId, directory)
    },
    recordSession(header) {
      const owner = header.parentSession
        ? db.prepare('SELECT user_id FROM user_sessions WHERE session_id = ?').get(header.parentSession)
        : db.prepare('SELECT user_id FROM user_workspaces WHERE directory = ?').get(header.cwd ?? '')
      if (owner)
        db.prepare('INSERT OR IGNORE INTO user_sessions (session_id, user_id) VALUES (?, ?)').run(
          header.id,
          owner.user_id,
        )
    },
    sessions(userId) {
      return db
        .prepare('SELECT session_id FROM user_sessions WHERE user_id = ?')
        .all(userId)
        .map((row) => row.session_id)
    },
    teamMemberIdsForSession(sessionId) {
      const owner = sessionOwner.get(sessionId)
      const rows = owner ? ownedSessionRoles.all(owner.user_id, ADMIN_ROLE) : adminTeamRole.all(ADMIN_ROLE)
      const grants = new Set()
      for (const row of rows) {
        const members = roleTeamMembers(row)
        if (members === null) return null
        for (const id of members) grants.add(id)
      }
      return grants
    },
    async authenticate(username, password) {
      const candidate = find.get(ADMIN_ROLE, username)
      const result = await derive(password, candidate?.password_salt ?? dummySalt, 64)
      const latest = find.get(ADMIN_ROLE, username)
      if (
        !timingSafeEqual(result, candidate?.password_hash ?? dummyHash) ||
        !latest?.enabled ||
        !timingSafeEqual(result, latest.password_hash)
      )
        return
      return latest
    },
    createLogin(userId, audience, expiresAt) {
      const token = randomBytes(32).toString('base64url')
      transaction(() => {
        db.prepare('DELETE FROM logins WHERE expires_at <= ? OR (user_id = ? AND audience = ?)').run(
          Date.now(),
          userId,
          audience,
        )
        db.prepare('INSERT INTO logins (token_hash, user_id, audience, expires_at) VALUES (?, ?, ?, ?)').run(
          hashToken(token),
          userId,
          audience,
          expiresAt,
        )
      })
      return token
    },
    lookup(token, audience) {
      if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return
      const hash = hashToken(token)
      const user = byLogin.get(ADMIN_ROLE, hash, audience, Date.now())
      if (user?.enabled)
        return {
          id: user.id,
          username: user.username,
          useHarness: Boolean(user.useHarness),
          manageAccounts: Boolean(user.manageAccounts),
          expiresAt: user.expires_at,
        }
    },
    logout(token, audience) {
      db.prepare('DELETE FROM logins WHERE token_hash = ? AND audience = ?').run(hashToken(token), audience)
    },
    summary() {
      return {
        users: db.prepare('SELECT count(*) AS total FROM users').get().total,
        roles: db.prepare('SELECT count(*) AS total FROM roles').get().total,
      }
    },
    page(kind, { search, after, enabled, limit }) {
      const users = kind === 'users'
      // Identifiers come only from the route's closed users/roles choice.
      const table = users ? 'users' : 'roles'
      const name = users ? 'username' : 'name'
      const filters = [`${name} >= ?`, `${name} < ?`]
      const values = [search, search + '\uffff']
      if (users && enabled !== '') {
        filters.push('enabled = ?')
        values.push(Number(enabled))
      }
      const where = filters.join(' AND ')
      const total = db.prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get(...values).total
      const columns = users ? 'id, username, enabled' : 'name, use_harness, team_members'
      const rows = db
        .prepare(`SELECT ${columns} FROM ${table} WHERE ${where} AND ${name} > ? ORDER BY ${name} LIMIT ?`)
        .all(...values, after, limit + 1)
      const more = rows.length > limit
      const visible = rows.slice(0, limit)
      const namesByUser = new Map()
      if (users && visible.length) {
        const grants = db
          .prepare(
            `SELECT user_id, role_name FROM user_roles WHERE user_id IN (${visible.map(() => '?').join(',')}) ORDER BY user_id, role_name`,
          )
          .all(...visible.map((row) => row.id))
        for (const grant of grants) {
          const names = namesByUser.get(grant.user_id) ?? []
          names.push(grant.role_name)
          namesByUser.set(grant.user_id, names)
        }
      }
      return {
        items: visible.map((row) =>
          users
            ? { username: row.username, enabled: Boolean(row.enabled), roles: namesByUser.get(row.id) ?? [] }
            : { name: row.name, useHarness: Boolean(row.use_harness), manageAccounts: row.name === ADMIN_ROLE, teamMembers: roleTeamMembers(row) },
        ),
        total,
        next: more ? visible.at(-1)[name] : null,
      }
    },
    list() {
      const roles = db.prepare('SELECT name, use_harness, team_members FROM roles ORDER BY name').all()
      const users = db.prepare('SELECT id, username, enabled FROM users ORDER BY username').all()
      const grants = db.prepare('SELECT user_id, role_name FROM user_roles ORDER BY role_name').all()
      const namesByUser = new Map()
      for (const grant of grants) {
        const names = namesByUser.get(grant.user_id) ?? []
        names.push(grant.role_name)
        namesByUser.set(grant.user_id, names)
      }
      return {
        roles: roles.map((r) => ({
          name: r.name,
          useHarness: Boolean(r.use_harness),
          manageAccounts: r.name === ADMIN_ROLE,
          teamMembers: roleTeamMembers(r),
        })),
        users: users.map((u) => ({
          username: u.username,
          enabled: Boolean(u.enabled),
          roles: namesByUser.get(u.id) ?? [],
        })),
      }
    },
    saveRole(name, role) {
      return transaction(() => {
        const previous = db.prepare('SELECT use_harness FROM roles WHERE name = ?').get(name)
        db.prepare(
          `INSERT INTO roles (name, use_harness, manage_accounts, team_members) VALUES (?, ?, ?, ?)
          ON CONFLICT (name) DO UPDATE SET use_harness = excluded.use_harness, manage_accounts = excluded.manage_accounts,
            team_members = CASE WHEN ? THEN excluded.team_members ELSE roles.team_members END`,
        ).run(name, Number(role.useHarness), Number(name === ADMIN_ROLE),
          role.teamMembers == null ? null : JSON.stringify(role.teamMembers), Number(role.teamMembers !== undefined))
        if (!requireAdmin()) throw new CatalogError('last-administrator')
        if (previous && Boolean(previous.use_harness) !== role.useHarness) {
          db.prepare('DELETE FROM logins WHERE user_id IN (SELECT user_id FROM user_roles WHERE role_name = ?)').run(name)
        }
      })
    },
    saveUser(username, user, credential) {
      return transaction(() => {
        const existing = find.get(ADMIN_ROLE, username)
        if (!existing && !credential) throw new CatalogError('password-required')
        const roleExists = db.prepare('SELECT 1 FROM roles WHERE name = ?')
        if (user.roles.some((role) => !roleExists.get(role))) throw new CatalogError('unknown-role')
        const { hash, salt } = credential ?? { hash: existing.password_hash, salt: existing.password_salt }
        const { id } = db
          .prepare(
            `
          INSERT INTO users (username, password_hash, password_salt, enabled) VALUES (?, ?, ?, ?)
          ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash,
            password_salt = excluded.password_salt, enabled = excluded.enabled RETURNING id
        `,
          )
          .get(username, hash, salt, Number(user.enabled))
        db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id)
        const grant = db.prepare('INSERT INTO user_roles (user_id, role_name) VALUES (?, ?)')
        for (const role of user.roles) grant.run(id, role)
        if (!requireAdmin()) throw new CatalogError('last-administrator')
        db.prepare('DELETE FROM logins WHERE user_id = ?').run(id)
      })
    },
    close: () => db.close(),
  }
}

/** Rejected catalog mutation. The transaction was rolled back. */
export class CatalogError extends Error {}

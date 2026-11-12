/** Member-owned capability configuration; contains references, never resolved credentials. */
import z from '@deepseek-ai/schemastery'

/** Installation limits apply to uploaded archives and restored configuration alike. */
export const SKILL_BYTES = 1024 * 1024
/** Bounded archive entry count prevents excessive filesystem work. */
export const SKILL_FILES = 128
/** Maximum number of approved columns in one physical table. */
export const TABLE_COLUMN_LIMIT = 200
/** Portable physical MySQL names and aliases. */
export const MYSQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** One private MCP namespace. */
export interface MemberMcp {
  name: string
  enabled: boolean
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string[]
  env: string
  cwd: string
  url: string
  headers: string
  timeoutMs: number
}

/** A portable skill bundle; files are base64 bytes relative to its SKILL.md. */
export interface MemberSkill {
  name: string
  description: string
  enabled: boolean
  files: Record<string, string>
}

/** Prepared SQL example and the business meaning of each positional parameter. */
export interface SqlExample {
  id: string
  question: string
  sql: string
  parameters: string[]
  description: string
}

/** MySQL connection with approved columns per physical table. */
export interface MemberDatabase {
  id: string
  name: string
  enabled: boolean
  host: string
  port: number
  database: string
  username: string
  passwordRef: string
  tls: boolean
  tables: string[]
  columns: Record<string, string[]>
  maxRows: number
  timeoutMs: number
  examples: SqlExample[]
}

/** Additions are mounted only in the delegated member's agent scope. */
export interface MemberCapabilities {
  mcp: MemberMcp[]
  skills: MemberSkill[]
  databases: MemberDatabase[]
}

const identifier = () => z.string().pattern(/^[a-z][a-z0-9-]{0,31}$/).required()
const text = () => z.string().pattern(/\S/).required()
const sqlIdentifier = () => z.string().pattern(MYSQL_IDENTIFIER)
const sqlExampleSchema: z<SqlExample> = z.object({
  id: identifier(), question: text(), sql: text(), parameters: z.array(String).default([]), description: z.string().default(''),
})

/** ZIP bundles shared by the whole profile or owned by one member. */
export const skillBundlesSchema = z.array(z.object({
  name: identifier(), description: text(), enabled: z.boolean().default(true), files: z.dict(String).required(),
})).default([])

/** Serializable schema used by both profile writes and snapshot restoration. */
export const capabilitiesSchema: z<MemberCapabilities> = z.object({
  mcp: z.array(z.object({
    name: identifier(), enabled: z.boolean().default(true),
    transport: z.union(['stdio', 'streamable-http']).default('stdio'),
    command: z.string().default(''), args: z.array(String).default([]),
    env: z.string().default('{}'), cwd: z.string().default(''),
    url: z.string().default(''), headers: z.string().default('{}'),
    timeoutMs: z.number().step(1).min(1000).max(300000).default(60000),
  })).default([]),
  skills: skillBundlesSchema,
  databases: z.array(z.object({
    id: identifier(), name: text(), enabled: z.boolean().default(true), host: text(),
    port: z.number().step(1).min(1).max(65535).default(3306), database: sqlIdentifier().required(),
    username: text(), passwordRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).required(),
    tls: z.boolean().default(true), tables: z.array(sqlIdentifier()).default([]),
    columns: z.dict(z.array(sqlIdentifier()).max(TABLE_COLUMN_LIMIT), sqlIdentifier()).default({}),
    maxRows: z.number().step(1).min(1).max(1000).default(100),
    timeoutMs: z.number().step(1).min(1000).max(60000).default(10000),
    examples: z.array(sqlExampleSchema).default([]),
  })).default([]),
}).default({ mcp: [], skills: [], databases: [] })

/**
 * Parse durable or wire input using the same schema as profile writes.
 * @param value - Untrusted persisted data.
 * @returns Validated capability fields with defaults applied.
 */
export const parseCapabilities = (value: unknown): MemberCapabilities => z.resolve(value, capabilitiesSchema, {})[0]

/**
 * Validate one SQL example with the same field rules as the saved connection.
 * @param value - Example fields submitted by the editor.
 * @returns The parsed example.
 */
export const parseSqlExample = (value: unknown): SqlExample => z.resolve(value, sqlExampleSchema, {})[0]

/**
 * Parse MCP environment or headers without accepting nested values or empty keys.
 * @param text - Administrator JSON.
 * @returns A string dictionary suitable for the native MCP provider.
 */
export const parseStringMap = (text: string): Record<string, string> => {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object')
  const pairs: [string, string][] = []
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim() || typeof entry !== 'string') throw new Error('MCP values must be strings with nonempty keys')
    pairs.push([key, entry])
  }
  return Object.fromEntries(pairs)
}

/**
 * Reject duplicate namespaces, incomplete transports and unsafe bundle paths.
 * @param value - Parsed capability configuration.
 * @returns The accepted configuration.
 */
export const validateCapabilities = (value: MemberCapabilities): MemberCapabilities => {
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw new Error('Duplicate capability id') }
  unique(value.mcp.map(item => item.name))
  unique(value.skills.map(item => item.name))
  unique(value.databases.map(item => item.id))
  let bytes = 0
  for (const skill of value.skills) {
    const entries = Object.entries(skill.files)
    unique(entries.map(([path]) => path.toLowerCase()))
    if (!skill.files['SKILL.md'] || entries.length > SKILL_FILES) throw new Error('A skill requires SKILL.md and at most 128 files')
    for (const [path, data] of entries) {
      if (!/^[A-Za-z0-9_. /-]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe skill file path')
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid skill file encoding')
      bytes += data.length * 3 / 4
    }
  }
  if (bytes > SKILL_BYTES) throw new Error('Member skill files exceed 1 MiB')
  for (const server of value.mcp) {
    parseStringMap(server.env)
    parseStringMap(server.headers)
    if (server.transport === 'stdio' && !server.command.trim()) throw new Error('MCP command is required')
    if (server.transport === 'streamable-http') {
      const url = new URL(server.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('MCP requires an HTTP URL without embedded credentials')
    }
  }
  for (const database of value.databases) {
    unique(database.examples.map(item => item.id))
    unique(database.tables)
    for (const [table, columns] of Object.entries(database.columns)) {
      if (!database.tables.includes(table)) throw new Error('Columns require a configured table')
      unique(columns.map(column => column.toLowerCase()))
    }
  }
  return value
}

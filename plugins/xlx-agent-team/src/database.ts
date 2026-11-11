/** Bounded MySQL reads using prepared values and explicit table and column grants. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2/promise'
import sqlParser from 'node-sql-parser'
import { MYSQL_IDENTIFIER, type MemberDatabase } from './capabilities.ts'

const parser = new sqlParser.Parser()
const SAFE_FUNCTIONS = new Set(['ABS', 'AVG', 'CEIL', 'CEILING', 'COALESCE', 'CONCAT', 'COUNT', 'DATE', 'DATE_FORMAT', 'DATEDIFF', 'DAY', 'FLOOR', 'IF', 'IFNULL', 'LOWER', 'MAX', 'MIN', 'MONTH', 'NULLIF', 'ROUND', 'SUM', 'TRIM', 'UPPER', 'YEAR'])
const SUPPORTED_JOINS = new Set(['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN'])
type SqlValue = string | number | boolean | null

/** Build the column grant for a named physical table. */
const approvedColumns = (database: MemberDatabase, table: string): string[] =>
  database.tables.includes(table) && Object.hasOwn(database.columns, table) ? database.columns[table]! : []

/**
 * Validate a single SELECT and bound its output without changing its filters or grouping.
 * @param sql - Model or administrator supplied SQL.
 * @param database - Allowed tables, columns and row budget.
 * @returns Canonical SQL and its positional parameter count.
 */
export const prepareRead = (sql: string, database: MemberDatabase): { sql: string; parameters: number } => {
  if (sql.length > 32000 || /\/\*|--|#|;|@/.test(sql)) throw new Error('Use one SELECT without comments, variables or statement separators')
  if (/['"]/.test(sql)) throw new Error('Bind text and date values with ?; use backticks for identifiers')
  const ast = parser.astify(sql, { database: 'MySQL' })
  if (Array.isArray(ast) || ast.type !== 'select' || ast.with || ast._next) throw new Error('Use one SELECT without CTEs or UNION')
  if (!Array.isArray(ast.columns)) throw new Error('Select explicit columns; COUNT(*) is supported')
  if (!Array.isArray(ast.from) || !ast.from.length) throw new Error('Select from a configured physical table')
  const sources = new Map<string, Set<string>>()
  for (const [index, source] of ast.from.entries()) {
    if (!('table' in source) || !MYSQL_IDENTIFIER.test(source.table) || (source.db && source.db !== database.database) || source.schema) throw new Error('Use physical tables in this connection’s database')
    if (index && (!('join' in source) || !SUPPORTED_JOINS.has(source.join) || !source.on || source.using)) throw new Error('Join configured tables with an explicit ON condition')
    const alias = source.as || source.table
    if (!MYSQL_IDENTIFIER.test(alias) || sources.has(alias.toLowerCase())) throw new Error('Use distinct table aliases')
    const columns = approvedColumns(database, source.table)
    if (!columns.length) throw new Error('SQL refers to a table without approved columns')
    sources.set(alias.toLowerCase(), new Set(columns.map(column => column.toLowerCase())))
  }
  let parameters = 0
  const inspect = (node: unknown, countStar = false): void => {
    if (Array.isArray(node)) { node.forEach(item => inspect(item)); return }
    if (!node || typeof node !== 'object') return
    const object = Object.fromEntries<unknown>(Object.entries(node))
    if (object.as != null && (typeof object.as !== 'string' || !MYSQL_IDENTIFIER.test(object.as))) throw new Error('Use simple names for SQL aliases')
    if (object.type === 'select' && node !== ast) throw new Error('Subqueries are not supported')
    if (object.type === 'column_ref') {
      if (object.db != null && object.db !== database.database) throw new Error('SQL column belongs to another database')
      const allowed = typeof object.table === 'string' ? sources.get(object.table.toLowerCase()) : sources.size === 1 ? sources.values().next().value : undefined
      if (typeof object.column !== 'string' || !allowed?.has(object.column.toLowerCase())) throw new Error('Use approved columns and qualify column names in joins')
    }
    if (object.type === 'star' && !countStar) throw new Error('Select explicit columns; COUNT(*) is supported')
    if (object.type === 'into' || object.locking_read || object.assign || object.type === 'var' || object.type === 'set' || object.options || object.over || object.window) throw new Error('SQL must be read-only without locks, output files, query modifiers, windows or assignments')
    if (object.type === 'function' || object.type === 'aggr_func') {
      const functionName = typeof object.name === 'string' ? object.name : JSON.stringify(object.name)
      const names = typeof object.name === 'string' ? [object.name] : [...functionName.matchAll(/"value":"([^"]+)"/g)].map(match => match[1] ?? '')
      if (names.length !== 1 || !SAFE_FUNCTIONS.has((names[0] ?? '').toUpperCase())) throw new Error('SQL function is not in the supported read-only function list')
    }
    if (object.type === 'origin') {
      if (object.value !== '?') throw new Error('Unsupported SQL expression')
      parameters++
    }
    if (object.type === 'aggr_func' && object.name === 'COUNT' && object.args && typeof object.args === 'object') {
      for (const [key, value] of Object.entries(object.args)) inspect(value, key === 'expr')
      for (const [key, value] of Object.entries(object)) if (key !== 'args') inspect(value)
      return
    }
    for (const value of Object.values(object)) inspect(value)
  }
  inspect(ast)
  // A fixed cap is applied only to the result count; existing OFFSET and smaller limits survive.
  const limit = ast.limit
  if (limit) {
    if (limit.value.some(item => item.type !== 'number' || typeof item.value !== 'number' || !Number.isSafeInteger(item.value) || item.value < 0)) throw new Error('LIMIT requires nonnegative integer literals')
    const count = limit.seperator === 'offset' ? limit.value[0] : limit.value.at(-1)
    if (!count || typeof count.value !== 'number') throw new Error('LIMIT requires a literal count')
    count.value = Math.min(count.value, database.maxRows)
    const offset = limit.seperator === 'offset' ? limit.value[1] : limit.value.length > 1 ? limit.value[0] : undefined
    if (offset && Number(offset.value) > 10000) throw new Error('Use cursor pagination instead of a deep OFFSET')
  } else ast.limit = { seperator: '', value: [{ type: 'number', value: database.maxRows }] }
  return { sql: parser.sqlify(ast, { database: 'MySQL' }), parameters }
}

/**
 * Register a private database tool; abort and drain requests before releasing its context.
 * @param ctx - The member's scoped plugin context.
 * @param databases - Accepted connection definitions; credentials resolve at each operation.
 */
export const installDatabaseTools = (ctx: Context, databases: MemberDatabase[]): void => {
  if (!databases.length) return
  const lifecycle = new AbortController()
  const pending = new Set<Promise<unknown>>()
  const explained = new Set<string>()
  const tool = defineTool({
    name: 'team_database',
    description: 'Use this teammate’s private MySQL connections. catalog lists approved tables and columns, example questions, prepared SQL, positional parameters and business definitions. schema reads approved columns and their complete indexes for one approved table. test checks connectivity. For reads: supply one SELECT with ? placeholders and a JSON array of scalar values, call explain first, inspect its cost, then query with the identical SQL and values. Every column must be approved, including filters, joins, groups and sorts. Qualify columns in joins and use explicit ON. Subqueries are unsupported. Results are capped; LIMIT does not guarantee low scan cost. Use business date ranges and stable cursor pagination. Never invent column meanings or present truncated results as complete.',
    parameters: {
      action: { type: 'string', enum: ['catalog', 'schema', 'test', 'explain', 'query'], required: true },
      connection: { type: 'string', description: 'Connection id from catalog.' },
      table: { type: 'string', description: 'An approved table for schema inspection.' },
      sql: { type: 'string', description: 'Read-only SELECT; bind values through ?.' },
      values: { type: 'string', description: 'JSON array of scalar parameter values, in positional order. Defaults to [].' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    execute: (args, exec) => {
      const work = (async () => {
        const signal = AbortSignal.any([exec.signal, lifecycle.signal])
        signal.throwIfAborted()
        if (args.action === 'catalog') return { result: JSON.stringify(databases.map(({ id, name, database, tables, columns, maxRows, examples }) => ({ id, name, database, tables: tables.filter(table => columns[table]?.length && Object.hasOwn(columns, table)), columns, maxRows, examples }))) }
        const config = databases.find(item => item.id === args.connection)
        if (!config) throw new Error('Choose a connection from team_database catalog')
        let sql = 'SELECT 1 AS connected'
        let values: SqlValue[] = []
        let fingerprint = ''
        let schemaColumns: string[] = []
        if (args.action === 'schema') {
          schemaColumns = args.table ? approvedColumns(config, args.table) : []
          if (!args.table || !schemaColumns.length) throw new Error('Choose a table with approved columns')
          const placeholders = schemaColumns.map(() => '?').join(', ')
          sql = `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (${placeholders}) ORDER BY ORDINAL_POSITION`
          values = [config.database, args.table, ...schemaColumns]
        } else if (args.action === 'explain' || args.action === 'query') {
          const read = prepareRead(args.sql ?? '', config)
          const parsed: unknown = JSON.parse(args.values ?? '[]')
          if (!Array.isArray(parsed) || !parsed.every((value: unknown) => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) throw new Error('SQL values must be a JSON array of scalar values')
          values = parsed
          if (values.length !== read.parameters) throw new Error('The number of bound values does not match SQL placeholders')
          fingerprint = createHash('sha256').update(JSON.stringify([config.id, read.sql, values])).digest('hex')
          if (args.action === 'query' && !explained.has(fingerprint)) throw new Error('Run explain with the same SQL and values, inspect the plan, then query')
          sql = args.action === 'explain' ? `EXPLAIN ${read.sql}` : read.sql
        }
        const credential = await ctx.credentials.resolve(credentialRef(config.passwordRef))
        if (!credential) throw new Error('Database password reference is not configured. Store it in Credentials, then retry.')
        signal.throwIfAborted()
        let connection: mysql.Connection | undefined
        const abort = () => connection?.destroy()
        try {
          connection = await mysql.createConnection({
            host: config.host, port: config.port, database: config.database, user: config.username, password: credential.value,
            connectTimeout: config.timeoutMs, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true,
            dateStrings: true, ...config.tls ? { ssl: { rejectUnauthorized: true } } : {},
          })
          signal.addEventListener('abort', abort, { once: true })
          signal.throwIfAborted()
          await connection.execute({ sql: 'SET SESSION max_execution_time = ?', timeout: config.timeoutMs }, [config.timeoutMs])
          await connection.query({ sql: 'START TRANSACTION READ ONLY', timeout: config.timeoutMs })
          const [rows] = await connection.execute<RowDataPacket[]>({ sql, timeout: config.timeoutMs }, values)
          let indexes: RowDataPacket[] | undefined
          if (args.action === 'schema') {
            const [statistics] = await connection.execute<RowDataPacket[]>({ sql: 'SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, CARDINALITY FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', timeout: config.timeoutMs }, values.slice(0, 2))
            const allowed = new Set(schemaColumns.map(column => column.toLowerCase()))
            const excluded = new Set(statistics.filter(row => typeof row['COLUMN_NAME'] !== 'string' || !allowed.has(row['COLUMN_NAME'].toLowerCase())).map(row => row['INDEX_NAME']))
            indexes = statistics.filter(row => !excluded.has(row['INDEX_NAME']))
          }
          if (args.action === 'explain') {
            if (explained.size >= 64) explained.clear()
            explained.add(fingerprint)
          }
          const result = JSON.stringify({ rows, ...indexes ? { indexes } : {}, rowLimit: config.maxRows, mayBeTruncated: args.action === 'query' && rows.length >= config.maxRows })
          if (result.length > DATABASE_RESULT_BYTES) throw new Error('Database result exceeds the response budget. Select fewer fields or a smaller page.')
          return { result }
        } catch (error) {
          signal.throwIfAborted()
          // Driver messages can contain hosts, users and SQL values; report only an enumerated diagnostic.
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
          const reason = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_QUERY_TIMEOUT', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes(code) ? code : 'QUERY_FAILED'
          throw new Error(`Database operation failed (${reason}). Check the connection, credentials, approved tables and SQL; do not assume a result was returned.`)
        } finally {
          signal.removeEventListener('abort', abort)
          connection?.destroy()
        }
      })()
      pending.add(work)
      return work.finally(() => pending.delete(work))
    },
  })
  ctx.effect(() => ctx.tools.register(tool), 'xlx-team: private database tools')
  ctx.effect(() => async () => {
    lifecycle.abort()
    await Promise.allSettled(pending)
  }, 'xlx-team: drain database reads')
}

const DATABASE_RESULT_BYTES = 256 * 1024

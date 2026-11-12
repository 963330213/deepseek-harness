/** Owner-only schema discovery for saved member connections. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { MYSQL_IDENTIFIER, type MemberDatabase } from './capabilities.ts'
import { catalogRemote, databaseTarget, type CatalogRequest, type CatalogResult, type PublicSkill } from './database-catalog-contract.ts'

const PAGE_SIZE = 50
type CatalogConnection = Parameters<typeof databaseTarget>[0] & Pick<MemberDatabase, 'id' | 'timeoutMs'>
type CatalogMembers = Readonly<Record<string, { readonly capabilities?: { readonly databases: readonly CatalogConnection[] } }>>

/** Catalog operations accept only the owner and only the latest saved connection target. */
class TeamCatalog extends Service {
  readonly typertRemote = bindTypertRemote(this, 'xlxTeamCatalog')

  constructor(ctx: Context, private readonly members: () => CatalogMembers, private readonly publicSkillsReady: () => Promise<void>) {
    super(ctx, 'xlxTeamCatalog')
  }

  /**
   * Read the unscoped skill registry without invoking a skill.
   * @param signal - Cancels discovery when the panel closes.
   * @returns Global skill metadata without local paths or instruction bodies.
   */
  async publicSkills(signal: AbortSignal): Promise<PublicSkill[]> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') throw new Error('Public skill settings require the owner')
    await this.publicSkillsReady()
    return (await this.ctx.skills.list({ signal })).map(({ name, description, provider, invocation }) => ({
      name, description, provider, modelInvocable: invocation.modelInvocable,
    }))
  }

  /**
   * Load a page of tables or the fields of one table.
   * @param request - Saved connection identity and metadata selection.
   * @param signal - Cancels the read when the picker changes or closes.
   * @returns The metadata or a failure category without driver details.
   */
  async read(request: CatalogRequest, signal: AbortSignal): Promise<CatalogResult> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') throw new Error('Database settings require the owner')
    const members = this.members()
    const config = Object.hasOwn(members, request.member)
      ? members[request.member]?.capabilities?.databases.find(item => item.id === request.connection)
      : undefined
    if (!config || databaseTarget(config) !== request.target) return { kind: 'error', reason: 'connection' }

    let connection: mysql.Connection | undefined
    const abort = () => connection?.destroy()
    try {
      signal.throwIfAborted()
      const credential = await this.ctx.credentials.resolve(credentialRef(config.passwordRef))
      if (!credential) return { kind: 'error', reason: 'credentials' }
      signal.throwIfAborted()
      const timeout = config.timeoutMs
      connection = await mysql.createConnection({
        host: config.host, port: config.port, database: config.database, user: config.username, password: credential.value,
        connectTimeout: timeout, multipleStatements: false, ...config.tls ? { ssl: { rejectUnauthorized: true } } : {},
      })
      signal.addEventListener('abort', abort, { once: true })
      signal.throwIfAborted()
      if (request.kind === 'tables') {
        const [rows] = await connection.execute<(RowDataPacket & { name: string })[]>({
          sql: "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND BINARY TABLE_SCHEMA = BINARY ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') AND BINARY TABLE_NAME > BINARY ? AND TABLE_NAME REGEXP ? AND LOCATE(?, TABLE_NAME) > 0 ORDER BY BINARY TABLE_NAME LIMIT ?",
          timeout,
        }, [config.database, config.database, request.after ?? '', MYSQL_IDENTIFIER.source, request.search, PAGE_SIZE + 1])
        const names = rows.slice(0, PAGE_SIZE).map(row => row.name).filter(name => MYSQL_IDENTIFIER.test(name))
        return { kind: 'tables', names, next: rows.length > PAGE_SIZE ? names.at(-1) ?? null : null }
      }
      const [rows] = await connection.execute<(RowDataPacket & { name: string; type: string; comment: string })[]>({
        sql: 'SELECT COLUMN_NAME AS name, DATA_TYPE AS type, LEFT(COLUMN_COMMENT, 160) AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND BINARY TABLE_SCHEMA = BINARY ? AND BINARY TABLE_NAME = BINARY ? ORDER BY ORDINAL_POSITION',
        timeout,
      }, [config.database, request.table, config.database, request.table])
      return { kind: 'columns', fields: rows.filter(row => MYSQL_IDENTIFIER.test(row.name)).map(({ name, type, comment }) => ({ name, type, comment })) }
    } catch (error) {
      signal.throwIfAborted()
      // Driver failures may contain connection details. Return only a failure category.
      return { kind: 'error', reason: 'load' }
    } finally {
      signal.removeEventListener('abort', abort)
      connection?.destroy()
    }
  }
}

/**
 * Register metadata discovery when the profile provides the Remote registry.
 * @param ctx - Owning team plugin.
 * @param members - Live saved roster getter.
 * @param publicSkillsReady - Settles when the saved public bundles are mounted.
 */
export const installDatabaseCatalog = (ctx: Context, members: () => CatalogMembers, publicSkillsReady: () => Promise<void>): void => {
  ctx.inject(['typert', 'credentials', 'skills'], catalogCtx => {
    new TeamCatalog(catalogCtx, members, publicSkillsReady)
    catalogCtx.typert.register({ ...catalogRemote, face: 'host', invocations: catalogRemote.descriptors, schemas: [], model: { services: [], events: [], objects: [] } })
  })
}

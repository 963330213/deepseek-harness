/** Wire contract for the member settings database picker. */
import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { MYSQL_IDENTIFIER, type MemberDatabase } from './capabilities.ts'

const identifier = z.string().regex(MYSQL_IDENTIFIER)
const address = {
  member: z.string().max(32),
  connection: z.string().max(32),
  target: z.string().max(2048),
}
const requestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...address, kind: z.literal('tables'), search: z.string().max(64), after: identifier.optional() }),
  z.strictObject({ ...address, kind: z.literal('columns'), table: identifier }),
])
const resultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tables'), names: z.array(identifier), next: identifier.nullable() }),
  z.object({ kind: z.literal('columns'), fields: z.array(z.object({ name: identifier, type: z.string(), comment: z.string() })) }),
  z.object({ kind: z.literal('error'), reason: z.enum(['connection', 'credentials', 'load']) }),
])

/** Requests reference a saved member and connection. */
export type CatalogRequest = z.infer<typeof requestSchema>
/** Catalog results carry metadata or a localized failure category. */
export type CatalogResult = z.infer<typeof resultSchema>
/** Client action passed through the member editor. */
export type LoadCatalog = (request: CatalogRequest, signal: AbortSignal) => Promise<CatalogResult>

/**
 * Identify the saved connection target without including the password.
 * @param database - Settings for one connection.
 * @returns The target checked against the latest saved settings before metadata is fetched.
 */
export const databaseTarget = (database: Pick<MemberDatabase, 'host' | 'port' | 'database' | 'username' | 'passwordRef' | 'tls'>): string =>
  JSON.stringify([database.host.trim(), database.port, database.database.trim(), database.username.trim(), database.passwordRef.trim(), database.tls])

const descriptor: InvocationDescriptor = {
  id: 'dsh-xlx-agent-team#xlxTeamCatalog/read',
  service: 'xlxTeamCatalog', namespace: 'xlxTeamCatalog', method: 'read',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'CatalogRequest', create: () => requestSchema } }],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: 'CatalogResult', create: () => resultSchema },
}

/** Use the same strict descriptor on the host and browser. */
export const catalogRemote: TypertRemoteContribution = { package: 'dsh-xlx-agent-team', descriptors: [descriptor] }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Owner-only read access to saved member database metadata. */
    xlxTeamCatalog: { read: (request: CatalogRequest, signal?: AbortSignal) => Promise<RemoteResult<CatalogResult>> }
  }
}

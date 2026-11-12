/** Admission snapshots and child-scoped capability lifetimes. */
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { z } from 'zod'
import { parseCapabilities, parseStringMap, validateCapabilities, type MemberCapabilities, type MemberSkill } from './capabilities.ts'
import { readSkillHeader } from './skill-bundle.ts'
import { installDatabaseTools, prepareRead } from './database.ts'
import { MEMBER_ID_PATTERN } from './types.ts'

const SNAPSHOT_PREFIX = 'xlx-team-'
type AcceptedMember = MemberCapabilities & { memberId?: string }
const snapshots = defineDomain({
  name: 'xlx_team_capabilities', version: 1, layout: 'per-record',
  tables: { members: domainTable<SessionId, AcceptedMember>(z.unknown().transform(raw => {
    const capabilities = validateCapabilities(parseCapabilities(raw))
    const memberId = raw && typeof raw === 'object' && 'memberId' in raw ? raw.memberId : undefined
    if (memberId === undefined) return capabilities
    if (typeof memberId !== 'string' || !MEMBER_ID_PATTERN.test(memberId)) throw new Error('Invalid saved team member identifier')
    return { ...capabilities, memberId }
  })) },
})

interface MemberRuntime {
  admit(memberId: string, value: unknown): Promise<SessionId>
  /** Returns null for legacy team children and undefined for other children. */
  memberOf(childId: SessionId): string | null | undefined
}

/**
 * Materialize skill bundles in the registry layer owned by the calling context.
 * @param ctx - Profile or member context that owns the temporary directory.
 * @param providerName - Skill provider name within that layer.
 * @param bundles - Saved ZIP contents and enablement.
 * @returns After enabled bundles have been mounted.
 */
const mountSkillBundles = async (ctx: Context, providerName: string, bundles: readonly MemberSkill[]): Promise<void> => {
  const skills = bundles.filter(item => item.enabled)
  if (skills.length) {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-xlx-team-'))
    ctx.effect(() => () => rm(directory, { recursive: true, force: true }), 'xlx-team: temporary skill resources')
    for (const skill of skills) {
      const header = readSkillHeader(Buffer.from(skill.files['SKILL.md']!, 'base64'))
      if (header.name !== skill.name || header.description !== skill.description) throw new Error('Skill frontmatter does not match its saved definition')
      for (const [relative, bytes] of Object.entries(skill.files)) {
        const path = join(directory, skill.name, relative)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, Buffer.from(bytes, 'base64'), { flag: 'wx', mode: 0o600 })
      }
    }
    await ctx.plugin(SkillFilesystem, { providerName, includeDefaultRoots: false, customSkillDirs: [directory], watch: false })
  }
}

/**
 * Reject public bundles that cannot be materialized before settings are persisted.
 * @param bundles - Complete public bundle configuration.
 */
export const validatePublicSkills = (bundles: readonly MemberSkill[]): void => {
  validateCapabilities({ mcp: [], skills: [...bundles], databases: [] })
  for (const skill of bundles) {
    const header = readSkillHeader(Buffer.from(skill.files['SKILL.md']!, 'base64'))
    if (header.name !== skill.name || header.description !== skill.description) throw new Error('Skill frontmatter does not match its saved definition')
  }
}

/**
 * Keep the unscoped provider in sync with the saved public bundles.
 * @param ctx - Team plugin context owning the global provider.
 * @param bundles - Live reference to the validated public bundles.
 * @returns A fence for inventory reads after a settings write.
 */
export const installPublicSkills = async (ctx: Context, bundles: Volatile<MemberSkill[]>): Promise<() => Promise<void>> => {
  let mounted: Fiber | undefined
  let stopped = false
  const provider = { name: 'xlx-team-public-skills', inject: ['skills'], apply: (skillCtx: Context, skills: readonly MemberSkill[]) => mountSkillBundles(skillCtx, 'xlx-team-public', skills) }
  const replace = async () => {
    if (stopped) return
    const snapshot = bundles.get()
    await mounted?.dispose()
    mounted = undefined
    if (stopped || !snapshot.some(skill => skill.enabled)) return
    const next = ctx.plugin(provider, snapshot)
    try {
      await next
      mounted = next
    } catch (error) {
      await next.dispose()
      throw error
    }
  }
  await replace()
  let ready = Promise.resolve()
  let tail = ready
  const owner = ctx.fiber
  ctx.on('internal/plugin', fiber => { if (fiber === owner && fiber.uid === null) stopped = true }, { global: true })
  ctx.on('loader/volatile-update', paths => {
    if (!paths.some(path => path[0] === 'publicSkills')) return
    ready = tail.then(replace)
    tail = ready.catch(error => ctx.logger.error('Could not reload shared skill bundles', error))
  })
  return () => ready
}

const applyMember = async (ctx: Context, config: MemberCapabilities): Promise<void> => {
  await mountSkillBundles(ctx, 'xlx-team', config.skills)
  for (const server of config.mcp.filter(item => item.enabled)) {
    await ctx.plugin(McpClient, {
      serverName: server.name,
      ...server.transport === 'stdio' ? { transport: 'stdio', command: server.command, args: server.args, env: parseStringMap(server.env), cwd: server.cwd } : { transport: 'streamable-http', url: server.url, headers: parseStringMap(server.headers) },
      expandTemplates: true, failOnStartupError: true,
      startupTimeoutMs: server.timeoutMs, toolCallTimeoutMs: server.timeoutMs,
    })
  }
  installDatabaseTools(ctx, config.databases.filter(item => item.enabled))
}

/**
 * Persist capability admission before child creation and restore the same snapshot on cold resume.
 * @param ctx - Team plugin context owning the admission store and creation listener.
 * @returns Child admission and lookup of the member associated with a saved child.
 */
export const createMemberRuntime = async (ctx: Context): Promise<MemberRuntime> => {
  const domain = await ctx.storageDomain.open(snapshots)
  ctx.effect(() => () => domain.close(), 'xlx-team: admission snapshots')
  const table = domain.table('members')
  ctx.on('agent/created', async ({ agent }) => {
    const accepted = table.get(agent.id)
    if (!accepted) {
      if (agent.id.startsWith(SNAPSHOT_PREFIX)) throw new Error('The team capability snapshot is missing; restore the plugin storage before resuming this member')
      return
    }
    await agent.ctx.plugin({ name: 'xlx-team-member', inject: ['tools', 'skills', 'credentials'], apply: applyMember }, accepted)
  })
  return {
    async admit(memberId, value) {
      const accepted = validateCapabilities(parseCapabilities(structuredClone(value)))
      for (const database of accepted.databases) for (const example of database.examples) {
        if (prepareRead(example.sql, database).parameters !== example.parameters.length) throw new Error('SQL example parameter descriptions must match its ? placeholders')
      }
      const id = brandString<SessionId>(`${SNAPSHOT_PREFIX}${randomUUID()}`)
      await table.put(id, { ...accepted, memberId })
      return id
    },
    memberOf(childId) {
      return childId.startsWith(SNAPSHOT_PREFIX) ? table.get(childId)?.memberId ?? null : undefined
    },
  }
}

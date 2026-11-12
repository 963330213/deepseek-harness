/** Admission snapshots and child-scoped capability lifetimes. */
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { z } from 'zod'
import { parseCapabilities, parseStringMap, validateCapabilities, type MemberCapabilities } from './capabilities.ts'
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
 * Install accepted additions into a single member context, with independent dependency ownership.
 * @param ctx - Child scope; its disposal closes transports and drains database work.
 * @param config - Immutable accepted snapshot without resolved secrets.
 */
const applyMember = async (ctx: Context, config: MemberCapabilities): Promise<void> => {
  const skills = config.skills.filter(item => item.enabled)
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
    await ctx.plugin(SkillFilesystem, { providerName: 'xlx-team', includeDefaultRoots: false, customSkillDirs: [directory], watch: false })
  }
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

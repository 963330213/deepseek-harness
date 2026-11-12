/** Revision-fenced roster editing through the existing DSH configuration service. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormPathOp, SettingsFormScope, SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpManagedServerView, ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { TeamRoster, TeamSettings } from '../types.ts'
import type { MemberCapabilities, MemberMcp, MemberSkill } from '../capabilities.ts'
import type { TeamLocaleKey } from './locales.ts'
import type { LoadCatalog, PublicSkill } from '../database-catalog-contract.ts'

/** Fields the public MCP editor reads from the native manager. */
export interface PublicMcpSettings {
  servers: Record<string, Omit<MemberMcp, 'name' | 'env' | 'headers' | 'timeoutMs'> & {
    env: Record<string, string>
    headers: Record<string, string>
    startupTimeoutMs?: number
    toolCallTimeoutMs?: number
  }>
}

/** Shared state survives page navigation and reports write outcomes. */
export interface TeamPageState {
  form: SettingsFormScopeSnapshot<TeamRoster>
  busy: boolean
  error: TeamLocaleKey | null
  saved: boolean
  models: readonly ModelProviderGroup[]
  catalogError: boolean
  publicSkills: MemberSkill[]
  publicMcp: SettingsFormScopeSnapshot<PublicMcpSettings>
}

/** Plain actions and one renderer-bound observable. */
export interface TeamPageFace {
  hooks: { teamPage: SnapshotStore<TeamPageState> }
  save: (value: TeamRoster, revision: number | undefined) => Promise<boolean>
  clearFeedback: () => void
  refreshModels: () => void
  loadCatalog: LoadCatalog
  savePublicSkills: (skills: MemberSkill[], revision: number | undefined) => Promise<boolean>
  savePublicMcp: (servers: PublicMcpSettings['servers'], revision: number | undefined) => Promise<boolean>
  saveMemberResources: <K extends 'mcp' | 'skills'>(memberId: string, kind: K, resources: MemberCapabilities[K], revision: number | undefined) => Promise<boolean>
  listPublicSkills: (signal: AbortSignal) => Promise<PublicSkill[] | undefined>
  watchPublicMcp: (signal: AbortSignal) => AsyncIterable<McpManagedServerView[]>
}

/**
 * Own subscriptions, request generations and writes for one plugin activation.
 * @param ctx - Client context providing the model directory.
 * @param scope - Shared revision-aware configuration form.
 * @returns Inject face and its lifecycle disposer.
 */
export const createTeamPage = (ctx: Context, scope: SettingsFormScope<TeamSettings>) => {
  const mcpScope = ctx.configForms.get<PublicMcpSettings>('mcp-manager')
  const readForm = (): SettingsFormScopeSnapshot<TeamRoster> => {
    const form = scope.getSnapshot()
    return { ...form, value: form.value ? { enabled: form.value.enabled, members: Object.entries(form.value.members).map(([id, member]) => ({ id, ...member })) } : undefined }
  }
  const readPublicSkills = () => scope.getSnapshot().value?.publicSkills ?? []
  const store = createSnapshotStore<TeamPageState>({
    form: readForm(), busy: false, error: null, saved: false, models: [], catalogError: false,
    publicSkills: readPublicSkills(), publicMcp: mcpScope.getSnapshot(),
  })
  let disposed = false
  let generation = 0
  const pending = new Set<Promise<unknown>>()
  /** Keep the remote service alive until this controller's admitted requests settle. */
  const track = <T>(request: Promise<T>): Promise<T> => {
    const tracked = request.finally(() => pending.delete(tracked))
    pending.add(tracked)
    return tracked
  }
  const publish = (patch: Partial<TeamPageState>) => {
    if (!disposed) store.set({ ...store.getSnapshot(), ...patch })
  }
  const unsubscribe = scope.subscribe(() => publish({ form: readForm(), publicSkills: readPublicSkills() }))
  const unsubscribeMcp = mcpScope.subscribe(() => publish({ publicMcp: mcpScope.getSnapshot() }))
  const loadModels = async () => {
    if (disposed) return
    const current = ++generation
    try {
      const result = await ctx.remote.session.modelCatalog()
      if (disposed || current !== generation) return
      if (result.ok) publish({ models: result.value.groups, catalogError: result.value.failures.length > 0 })
      else publish({ catalogError: true })
    } catch (error) {
      // The retained catalog stays usable while the next explicit refresh can retry transport.
      if (current === generation) publish({ catalogError: true })
    }
  }
  const write = <T>(target: SettingsFormScope<T>, ops: SettingsFormPathOp[], revision: number | undefined): Promise<boolean> => track((async () => {
    if (disposed || store.getSnapshot().busy || !target.getSnapshot().writable) return false
    if (revision !== target.getSnapshot().revision) {
      publish({ error: 'conflict', saved: false })
      return false
    }
    publish({ busy: true, error: null, saved: false })
    try {
      const saved = await target.mutate(ops, revision)
      publish({ busy: false, saved, error: saved ? null : 'conflict' })
      return saved
    } catch (error) {
      // The form owns recovery reads and keeps the last accepted configuration visible.
      publish({ busy: false, error: 'error' })
      return false
    }
  })())
  const face: TeamPageFace = {
    hooks: { teamPage: store },
    loadCatalog: (request, signal) => track((async () => {
      const response = await ctx.remote.xlxTeamCatalog.read(request, signal)
      if (response.ok) return response.value
      if (!signal.aborted) ctx.logger.warn('Team database catalog request failed (%s)', response.error.code)
      return { kind: 'error', reason: 'load' }
    })()),
    clearFeedback: () => publish({ error: null, saved: false }),
    refreshModels: () => { void track(loadModels()) },
    save: (value, revision) => write(scope, [
      { op: 'set', path: ['enabled'], value: value.enabled },
      { op: 'set', path: ['members'], value: Object.fromEntries(value.members.map(({ id, ...member }) => [id, member])) },
    ], revision),
    savePublicSkills: (skills, revision) => write(scope, [{ op: 'set', path: ['publicSkills'], value: skills }], revision),
    savePublicMcp: (servers, revision) => write(mcpScope, [{ op: 'set', path: ['servers'], value: servers }], revision),
    saveMemberResources: (memberId, kind, resources, revision) => write(scope, [
      { op: 'set', path: ['members', memberId, 'capabilities', kind], value: resources },
    ], revision),
    listPublicSkills: signal => track(ctx.remote.xlxTeamCatalog.publicSkills(signal).then(result => result.ok ? result.value : undefined)),
    watchPublicMcp: signal => ctx.remote.mcpManager.watch(signal),
  }
  return {
    face,
    dispose: async () => {
      disposed = true
      generation++
      unsubscribe()
      unsubscribeMcp()
      await Promise.allSettled(pending)
    },
  }
}

/** Shared resource inventory and the public resource editors. */
import { useEffect, useId, useState } from 'react'
import type { McpManagedServerView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, Modal, SegmentedTabs, Switch, Tooltip, IconEditOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconSkillOutlineRegular, IconTrashOutlineRegular, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseStringMap, type MemberMcp, type MemberSkill } from '../capabilities.ts'
import type { PublicSkill } from '../database-catalog-contract.ts'
import { McpEditor, SkillEditor } from './capability-forms.tsx'
import type { PublicMcpSettings, TeamPageFace } from './controller.ts'
import type { TeamLocaleKey } from './locales.ts'
import css from './page.module.css'

type Kind = 'mcp' | 'skills'
type Props = PropsRuntime<'main'> & PropsLocale<'settings.xlxAgentTeam'> & InjectFace<TeamPageFace>
type Server = PublicMcpSettings['servers'][string]
type Row = {
  key: string
  name: string
  detail?: string | undefined
  member?: { name: string; id: string }
  status: TeamLocaleKey
  enabled?: boolean
}
type Dialog = { action: 'edit'; name: string | undefined; revision: number | undefined }
  | { action: 'remove'; row: Row; revision: number | undefined }

const EMPTY_SERVERS: PublicMcpSettings['servers'] = {}

const changeItems = <T extends MemberMcp | MemberSkill,>(items: T[], name: string, change: 'remove' | boolean): T[] =>
  change === 'remove'
    ? items.filter(item => item.name !== name)
    : items.map(item => item.name === name ? { ...item, enabled: change } : item)

const mcpDraft = (name: string, server: Server): MemberMcp => ({
  name, transport: server.transport, enabled: server.enabled ?? true,
  command: server.command ?? '', args: server.args ?? [], cwd: server.cwd ?? '', url: server.url ?? '',
  env: JSON.stringify(server.env ?? {}), headers: JSON.stringify(server.headers ?? {}),
  timeoutMs: server.toolCallTimeoutMs ?? server.startupTimeoutMs ?? 30_000,
})

const serverEntry = (draft: MemberMcp, original: Server | undefined): Server => {
  const stdio = draft.transport === 'stdio'
  const preserveTimeouts = original && draft.timeoutMs === mcpDraft(draft.name, original).timeoutMs
  return {
    ...original,
    enabled: draft.enabled, transport: draft.transport,
    command: stdio ? draft.command : '', args: stdio ? draft.args : [],
    env: stdio ? parseStringMap(draft.env) : {}, cwd: stdio ? draft.cwd : '',
    url: stdio ? '' : draft.url, headers: stdio ? {} : parseStringMap(draft.headers),
    ...preserveTimeouts ? {} : { startupTimeoutMs: draft.timeoutMs, toolCallTimeoutMs: draft.timeoutMs },
  }
}

const mcpStatus = (view: McpManagedServerView | undefined, enabled = true): TeamLocaleKey => {
  if (!enabled || view?.status.state === 'disabled') return 'disabled'
  switch (view?.status.state) {
    case 'connected': return 'connected'
    case 'connecting':
    case 'reconnecting': return 'connecting'
    case undefined: return 'active'
    default: return 'connectionFailed'
  }
}

const ResourceList = ({ kind, t, useTeamPage, listPublicSkills, watchPublicMcp, clearFeedback, savePublicSkills, savePublicMcp, saveMemberResources }: Props & { kind: Kind }) => {
  const state = useTeamPage(value => value)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [binding, setBinding] = useState('all')
  const [publicSkills, setPublicSkills] = useState<PublicSkill[]>()
  const [mcpViews, setMcpViews] = useState<McpManagedServerView[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState<Dialog>()
  const isMcp = kind === 'mcp'
  const scope = isMcp ? state.publicMcp : state.form
  const publicLocked = state.busy || !scope.writable
  const resourceScope = (row: Row) => row.member ? state.form : scope
  const rowLocked = (row: Row) => state.busy || !resourceScope(row).writable
  const servers = state.publicMcp.value?.servers ?? EMPTY_SERVERS
  const publicSkillsRevision = isMcp ? undefined : state.form.revision

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setLoadFailed(false)
    const load = async () => {
      try {
        if (isMcp) {
          for await (const views of watchPublicMcp(signal)) {
            if (!signal.aborted) setMcpViews(views)
          }
        } else {
          const skills = await listPublicSkills(signal)
          if (!signal.aborted) {
            if (skills) setPublicSkills(skills)
            else setLoadFailed(true)
          }
        }
      } catch (error) {
        if (!signal.aborted) setLoadFailed(true)
      }
    }
    void load()
    return () => controller.abort()
  }, [isMcp, listPublicSkills, watchPublicMcp, publicSkillsRevision, refresh])

  const skillRegistry = new Map(publicSkills?.map(skill => [skill.name, skill]))
  const mcpRegistry = new Map(mcpViews.map(view => [view.name, view]))
  const importedNames = new Set(state.publicSkills.map(skill => skill.name))
  const shared: Row[] = isMcp ? [
    ...Object.entries(servers).map(([name, server]) => ({ key: `configured:${name}`, name, status: mcpStatus(mcpRegistry.get(name), server.enabled), enabled: server.enabled ?? true })),
    ...mcpViews.filter(view => view.configured && !Object.hasOwn(servers, view.name)).map(view => ({ key: `registered:${view.name}`, name: view.name, status: mcpStatus(view) })),
  ] : [
    ...state.publicSkills.map((skill): Row => ({
      key: `imported:${skill.name}`, name: skill.name, detail: skill.description, enabled: skill.enabled,
      status: !skill.enabled ? 'disabled' : skillRegistry.has(skill.name) && skillRegistry.get(skill.name)?.provider !== 'xlx-team-public' ? 'shadowedSkill' : 'active',
    })),
    ...(publicSkills ?? []).filter(skill => skill.provider !== 'xlx-team-public' || !importedNames.has(skill.name)).map((skill): Row => ({
      key: `registered:${skill.provider}:${skill.name}`, name: skill.name, detail: skill.description, status: skill.modelInvocable ? 'active' : 'manualSkill',
    })),
  ]
  const members = state.form.value?.members ?? []
  const privateRows: Row[] = members.flatMap(member => (member.capabilities?.[kind] ?? []).map((item): Row => ({
    key: `member:${member.id}:${item.name}`, name: item.name, detail: 'description' in item ? item.description : undefined,
    member: { name: member.name, id: member.id }, enabled: item.enabled,
    status: state.form.value?.enabled && member.enabled && item.enabled ? 'active' : 'disabled',
  })))
  const visible = [...shared, ...privateRows].filter(row =>
    (binding === 'all' || (binding === 'public' ? !row.member : row.member))
    && `${row.name}\n${row.member?.name ?? t('allAgents')}\n${row.member?.id ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))

  const openEditor = (name?: string) => {
    clearFeedback()
    setDialog({ action: 'edit', name, revision: scope.revision })
  }
  const confirmRemoval = (row: Row) => {
    clearFeedback()
    setDialog({ action: 'remove', row, revision: resourceScope(row).revision })
  }
  const resourceLabel = (row: Row) => row.member ? `${row.name} · ${row.member.name} (${row.member.id})` : row.name
  const close = () => { clearFeedback(); setDialog(undefined) }
  const save = async (candidate: MemberMcp | MemberSkill) => {
    if (dialog?.action !== 'edit' || publicLocked) return
    const saved = isMcp ? await savePublicMcp(Object.fromEntries([
      ...Object.entries(servers).filter(([name]) => name !== dialog.name),
      ...('transport' in candidate ? [[candidate.name, serverEntry(candidate, dialog.name === undefined ? undefined : servers[dialog.name])] as const] : []),
    ]), dialog.revision) : await savePublicSkills([
      ...state.publicSkills.filter(skill => skill.name !== dialog.name),
      ...('files' in candidate ? [candidate] : []),
    ], dialog.revision)
    if (saved) setDialog(undefined)
  }
  const changeResource = (row: Row, change: 'remove' | boolean, revision: number | undefined) => {
    if (row.enabled === undefined || rowLocked(row)) return
    if (row.member) {
      const { id } = row.member
      const member = members.find(item => item.id === id)
      if (!member?.capabilities) return
      return isMcp
        ? saveMemberResources(member.id, 'mcp', changeItems(member.capabilities.mcp, row.name, change), revision)
        : saveMemberResources(member.id, 'skills', changeItems(member.capabilities.skills, row.name, change), revision)
    }
    if (!isMcp) return savePublicSkills(changeItems(state.publicSkills, row.name, change), revision)
    const next = { ...servers }
    const server = Object.hasOwn(next, row.name) ? next[row.name] : undefined
    if (!server) return
    if (change === 'remove') delete next[row.name]
    else next[row.name] = { ...server, enabled: change }
    return savePublicMcp(next, revision)
  }
  const remove = async () => {
    if (dialog?.action !== 'remove') return
    if (await changeResource(dialog.row, 'remove', dialog.revision)) setDialog(undefined)
  }
  const editor = { t, disabled: publicLocked, close, accept: (candidate: MemberMcp | MemberSkill) => { void save(candidate) }, saveError: state.error ? t(state.error) : undefined }
  const editLabel = t(isMcp ? 'editMcp' : 'editSkill')
  const title = t(isMcp ? 'mcpPanel' : 'skillPanel')
  const removalConflict = dialog?.action === 'remove' && resourceScope(dialog.row).revision !== dialog.revision

  return <>
    <div className={css.page}>
      <form className={css.toolbar} onSubmit={event => { event.preventDefault(); setSearch(query.trim()) }}>
        <Input value={query} aria-label={t('resourceSearch')} placeholder={t('resourceSearch')} onChange={event => setQuery(event.target.value)} />
        <label className={css.field}><select aria-label={t('resourceBinding')} value={binding} onChange={event => setBinding(event.target.value)}>
          <option value="all">{t('allBindings')}</option><option value="public">{t('publicBinding')}</option><option value="private">{t('privateBinding')}</option>
        </select></label>
        <Button type="submit" icon={<IconSearchOutlineRegular size={16} />}>{t('searchAction')}</Button>
        <Button icon={<IconRefreshOutlineRegular size={16} />} onClick={() => { setQuery(''); setSearch(''); setBinding('all') }}>{t('reset')}</Button>
        <Button variant="primary" disabled={publicLocked} icon={<IconPlusOutlineRegular size={16} />} onClick={() => openEditor()}>{t(isMcp ? 'addPublicMcp' : 'addPublicSkill')}</Button>
      </form>
      {loadFailed ? <div className={css.notice} role="status">{t('resourceLoadFailed')} <Button size="sm" onClick={() => setRefresh(count => count + 1)}>{t('retry')}</Button></div> : null}
      {!dialog && state.saved ? <div className={css.meta} role="status">{t('saved')}</div> : null}
      {!dialog && state.error ? <p className={css.error} role="alert">{t(state.error)}</p> : null}
      {visible.length ? <table className={css.resourceList} aria-label={title}>
        <thead><tr><th scope="col">{t('name')}</th><th scope="col">{t('resourceBinding')}</th><th scope="col">{t('capabilityStatus')}</th><th scope="col">{t('capabilityActions')}</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.key}>
          <td><div className={css.memberTitle}>{row.name}</div>{row.detail ? <div className={css.meta}>{row.detail}</div> : null}</td>
          <td>{row.member?.name ?? t('allAgents')}{row.member ? <div className={css.meta}>{row.member.id}</div> : null}</td>
          <td className={css.status}><div className={css.resourceStatus}>
            {row.enabled !== undefined ? <Switch checked={row.enabled} disabled={rowLocked(row)} label={`${t('enableCapability')} ${resourceLabel(row)}`}
              title={t(row.enabled ? 'disableCapability' : 'enableCapability')} onChange={enabled => { void changeResource(row, enabled, resourceScope(row).revision) }} /> : null}
            <span>{t(row.status)}</span>
          </div></td>
          <td>{row.enabled !== undefined ? <div className={css.actions}>
            {!row.member ? <Tooltip portal label={editLabel}><Button disabled={publicLocked} aria-label={`${editLabel} ${row.name}`} icon={<IconEditOutlineRegular size={16} />} onClick={() => openEditor(row.name)} /></Tooltip> : null}
            <Tooltip portal label={t('deleteResource')}><Button disabled={rowLocked(row)} aria-label={`${t('deleteResource')} ${resourceLabel(row)}`} icon={<IconTrashOutlineRegular size={16} />} onClick={() => confirmRemoval(row)} /></Tooltip>
          </div> : <span className={css.status}>{t('managedElsewhere')}</span>}</td>
        </tr>)}</tbody>
      </table> : <p className={css.empty}>{t(state.form.status === 'loading' ? 'loading' : 'resourcesEmpty')}</p>}
    </div>
    {dialog?.action === 'edit' && (isMcp ? <McpEditor {...editor}
      value={dialog.name !== undefined && Object.hasOwn(servers, dialog.name) ? mcpDraft(dialog.name, servers[dialog.name]!) : undefined}
      peers={Object.entries(servers).filter(([name]) => name !== dialog.name).map(([name, server]) => mcpDraft(name, server))}
    /> : <SkillEditor {...editor}
      value={state.publicSkills.find(skill => skill.name === dialog.name)} peers={state.publicSkills.filter(skill => skill.name !== dialog.name)}
    />)}
    {dialog?.action === 'remove' ? <Modal open title={`${t('deleteResource')} · ${resourceLabel(dialog.row)}`} description={t(dialog.row.member ? 'removeMemberResourceDescription' : 'removePublicDescription')} closeLabel={t('close')}
      onClose={() => { if (!state.busy) close() }} footer={<><Button disabled={state.busy} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={rowLocked(dialog.row) || removalConflict} onClick={() => { void remove() }}>{t(state.busy ? 'saving' : 'confirmDelete')}</Button></>}>
      {state.error || removalConflict ? <p role="alert" className={css.error}>{t(state.error ?? 'conflict')}</p> : null}
    </Modal> : null}
  </>
}

/**
 * Open the skill and MCP inventories in one sidebar destination.
 * @param props - Localized labels and authorized resource actions.
 * @returns The resource page with keyboard-accessible tabs.
 */
export const ResourcesPanel = (props: Props) => {
  const { t } = props
  const [kind, setKind] = useState<Kind>('skills')
  const id = useId()
  const tabs: [SegmentedTab<Kind>, SegmentedTab<Kind>] = [
    { value: 'skills', label: t('skillPanel'), id: `${id}-skills`, panelId: `${id}-skills-panel` },
    { value: 'mcp', label: t('mcpPanel'), id: `${id}-mcp`, panelId: `${id}-mcp-panel` },
  ]
  const title = t('resourcesPanel')
  return <section className={css.panel}>
    <div className={css.panelContent}>
      <header className={css.panelHeader}>
        <h1>{title}</h1>
        <SegmentedTabs size="sm" className={css.resourceTabs} items={tabs} value={kind} onChange={setKind} label={title} />
      </header>
      {tabs.map(tab => <div key={tab.value} id={tab.panelId} role="tabpanel" aria-labelledby={tab.id} hidden={kind !== tab.value}>
        {kind === tab.value ? <ResourceList {...props} kind={kind} /> : null}
      </div>)}
    </div>
  </section>
}

/**
 * Render the Skills sidebar glyph.
 * @param props - Sidebar-owned icon dimensions.
 * @returns The skill glyph.
 */
export const SkillsPanelIcon = ({ size }: PropsRuntime<'sidebar.panellist'>) => <IconSkillOutlineRegular size={size} />

/** Pure settings presentation using the same controls as built-in plugins. */
import { useId, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Modal, Switch, Tooltip, IconPlusOutlineRegular, IconEditOutlineRegular, IconTrashOutlineRegular, IconSearchOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamPageFace, TeamPageState } from './controller.ts'
import { MEMBER_ID_PATTERN, validateMembers, type TeamMember, type TeamRoster } from '../types.ts'
import type { TeamLocaleKey } from './locales.ts'
import { CapabilityEditor } from './capability-editor.tsx'
import { parseCapabilities, validateCapabilities } from '../capabilities.ts'
import css from './page.module.css'

type LocaleProps = PropsLocale<'settings.xlxAgentTeam'>
type PageProps = PropsRuntime<'plugins.item'> & LocaleProps & InjectFace<TeamPageFace>
type EditorProps = LocaleProps & {
  member: TeamMember
  settings: TeamRoster
  revision: number | undefined
  state: TeamPageState
  save: TeamPageFace['save']
  refreshModels: () => void
  loadCatalog: TeamPageFace['loadCatalog']
  close: () => void
  creating: boolean
}

/**
 * Keep an unsaved member draft until its revision-fenced write succeeds.
 * @param props - Member snapshot, current request state and write action.
 * @returns The member editor dialog.
 */
const MemberEditor = (props: EditorProps) => {
  const { t, state } = props
  const [draft, setDraft] = useState(props.member)
  const [section, setSection] = useState<'basic' | 'mcp' | 'skills' | 'databases'>('basic')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<TeamLocaleKey | null>(null)
  const prefix = useId()
  const field = (key: keyof TeamMember, value: string | boolean) => setDraft(current => ({ ...current, [key]: value }))
  const candidates = state.models.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id, label: `${group.name} / ${model.name}` })))
  const route = JSON.stringify([draft.provider, draft.model])
  const missing = draft.provider && !candidates.some(candidate => candidate.provider === draft.provider && candidate.model === draft.model)
  const submit = async () => {
    if (state.busy || importing) return
    const next = { ...draft, id: draft.id.trim(), name: draft.name.trim(), instructions: draft.instructions.trim() }
    try {
      const capabilities = structuredClone(next.capabilities ?? { mcp: [], skills: [], databases: [] })
      next.capabilities = validateCapabilities(parseCapabilities(capabilities))
    } catch (validationError) { setError('invalidCapabilities'); return }
    if (!MEMBER_ID_PATTERN.test(next.id) || next.id === 'lead' || !next.name || !next.instructions) { setError('invalid'); return }
    if (props.settings.members.some(member => member.id === next.id && (props.creating || member.id !== props.member.id))) { setError('duplicate'); return }
    const members = props.creating ? [...props.settings.members, next] : props.settings.members.map(member => member.id === props.member.id ? next : member)
    try { validateMembers(members) } catch (validationError) { setError('invalid'); return }
    setError(null)
    if (await props.save({ ...props.settings, members }, props.revision)) props.close()
  }
  return <Modal open className={css.memberDialog!} contentClassName={css.memberDialogContent!} onClose={() => { if (!state.busy && !importing) props.close() }} title={t(props.creating ? 'add' : 'edit')} closeLabel={t('close')}
    footer={<><Button disabled={state.busy || importing} onClick={props.close}>{t('cancel')}</Button><Button variant="primary" disabled={state.busy || importing} onClick={() => { void submit() }}>{t(state.busy ? 'saving' : 'save')}</Button></>}>
    <div className={css.editor}>
      <div className={css.tabs} role="group" aria-label={t('memberSettings')}>
        {(['basic', 'mcp', 'skills', 'databases'] as const).map(item => <Button key={item} disabled={importing} aria-pressed={section === item} onClick={() => setSection(item)}>{t(item)}</Button>)}
      </div>
      {section === 'basic' ? <>
      <label className={css.field} htmlFor={`${prefix}-name`}><span>{t('name')}</span><Input id={`${prefix}-name`} value={draft.name} disabled={state.busy} onChange={event => field('name', event.target.value)} /></label>
      <label className={css.field} htmlFor={`${prefix}-id`}><span>{t('id')}</span><Input id={`${prefix}-id`} value={draft.id} disabled={state.busy || !props.creating} onChange={event => field('id', event.target.value)} /><small>{t('idHint')}</small></label>
      <label className={css.field} htmlFor={`${prefix}-instructions`}><span>{t('instructions')}</span><textarea id={`${prefix}-instructions`} rows={6} value={draft.instructions} disabled={state.busy} placeholder={t('instructionsHint')} onChange={event => field('instructions', event.target.value)} /></label>
      <label className={css.field} htmlFor={`${prefix}-model`}><span>{t('model')}</span><select id={`${prefix}-model`} value={route} disabled={state.busy} onChange={event => {
        const candidate = candidates.find(item => JSON.stringify([item.provider, item.model]) === event.target.value)
        setDraft(current => ({ ...current, provider: candidate?.provider ?? '', model: candidate?.model ?? '' }))
      }}>
        <option value={JSON.stringify(['', ''])}>{t('inherit')}</option>
        {missing ? <option value={route}>{draft.provider} / {draft.model} · {t('missingModel')}</option> : null}
        {candidates.map(candidate => <option key={JSON.stringify([candidate.provider, candidate.model])} value={JSON.stringify([candidate.provider, candidate.model])}>{candidate.label}</option>)}
      </select></label>
      {state.catalogError ? <div className={css.notice}>{t('catalogError')} <Button size="sm" onClick={props.refreshModels}>{t('retry')}</Button></div> : null}
      <div className={css.toggle}><span>{t('memberEnabled')}</span><Switch checked={draft.enabled} label={t('memberEnabled')} disabled={state.busy} onChange={value => field('enabled', value)} /></div>
      </> : <CapabilityEditor section={section} value={draft.capabilities ?? { mcp: [], skills: [], databases: [] }} member={props.member} loadCatalog={props.loadCatalog} disabled={state.busy} t={t} importingChanged={setImporting} change={capabilities => setDraft(current => ({ ...current, capabilities }))} />}
      {error || state.error ? <p role="alert" className={css.error}>{t(error ?? state.error ?? 'error')}</p> : null}
    </div>
  </Modal>
}

/**
 * Render summary copy or the editable roster inside the Plugins page.
 * @param props - Framework-bound state, locale and actions.
 * @returns The team configuration view.
 */
export const TeamPage = (props: PageProps) => {
  const { t } = props
  const state = props.useTeamPage(value => value)
  const [editing, setEditing] = useState<{ member: TeamMember; settings: TeamRoster; revision: number | undefined; creating: boolean } | null>(null)
  const [deleting, setDeleting] = useState<{ member: TeamMember; settings: TeamRoster; revision: number | undefined } | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  if (props.view === 'summary') return t('description')
  const settings = state.form.value
  if (state.form.status === 'loading') return <div className={css.skeleton} aria-label={t('loading')} aria-busy="true" />
  if (!settings) return <p>{t('unavailable')}</p>
  const disabled = state.busy || !state.form.writable
  const visible = settings.members.filter(member => `${member.name}\n${member.id}\n${member.instructions}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const edit = (member: TeamMember, creating: boolean) => { props.clearFeedback(); setEditing({ member, settings, revision: state.form.revision, creating }) }
  return <div className={css.page}>
    <div className={css.toggle}><span>{t('enabled')}</span><Switch checked={settings.enabled} label={t('enabled')} disabled={disabled} onChange={enabled => { void props.save({ ...settings, enabled }, state.form.revision) }} /></div>
    <p className={css.help}>{t('limits')}</p>
    <form className={css.toolbar} onSubmit={event => { event.preventDefault(); setSearch(query.trim()) }}>
      <Input value={query} aria-label={t('search')} placeholder={t('search')} onChange={event => setQuery(event.target.value)} />
      <Button type="submit" icon={<IconSearchOutlineRegular size={16} />}>{t('searchAction')}</Button>
      <Button icon={<IconRefreshOutlineRegular size={16} />} onClick={() => { setQuery(''); setSearch('') }}>{t('reset')}</Button>
      <Button variant="primary" disabled={disabled} icon={<IconPlusOutlineRegular size={16} />} onClick={() => edit({ id: '', name: '', instructions: '', provider: '', model: '', enabled: true }, true)}>{t('add')}</Button>
    </form>
    <div className={css.feedback} aria-live="polite">{state.error ? <span role="alert" className={css.error}>{t(state.error)}</span> : state.saved ? t('saved') : null}</div>
    {visible.length ? <div className={css.members}>{visible.map(member => <div className={css.member} key={member.id}>
      <div className={css.memberText}><div className={css.memberTitle}><span>{member.name}</span><span className={css.status}>{t(member.enabled ? 'active' : 'disabled')}</span></div><div className={css.meta}>{member.id} · {member.provider ? `${member.provider} / ${member.model}` : t('inherit')}</div><p className={css.instructions}>{member.instructions}</p><div className={css.capabilitySummary}>{member.capabilities?.skills.filter(item => item.enabled).map(item => <span key={`skill-${item.name}`}>Skill · {item.name}</span>)}{member.capabilities?.mcp.filter(item => item.enabled).map(item => <span key={`mcp-${item.name}`}>MCP · {item.name}</span>)}{member.capabilities?.databases.filter(item => item.enabled).map(item => <span key={`db-${item.id}`}>{t('databases')} · {item.name}</span>)}</div></div>
      <div className={css.actions}>
        <Tooltip label={t('edit')} portal><Button disabled={disabled} aria-label={`${t('edit')} ${member.name}`} icon={<IconEditOutlineRegular size={16} />} onClick={() => edit(member, false)} /></Tooltip>
        <Tooltip label={t('remove')} portal><Button disabled={disabled} aria-label={`${t('remove')} ${member.name}`} icon={<IconTrashOutlineRegular size={16} />} onClick={() => { props.clearFeedback(); setDeleting({ member, settings, revision: state.form.revision }) }} /></Tooltip>
      </div>
    </div>)}</div> : <p className={css.empty}>{t(settings.members.length ? 'noMatches' : 'empty')}</p>}
    {editing ? <MemberEditor {...editing} t={t} state={state} save={props.save} refreshModels={props.refreshModels} loadCatalog={props.loadCatalog} close={() => setEditing(null)} /> : null}
    {deleting ? <Modal open title={`${t('deleteTitle')} · ${deleting.member.name}`} description={t('deleteDescription')} closeLabel={t('close')} onClose={() => { if (!state.busy) setDeleting(null) }} footer={<><Button disabled={state.busy} onClick={() => setDeleting(null)}>{t('cancel')}</Button><Button variant="primary" disabled={state.busy} onClick={() => {
      void props.save({ ...deleting.settings, members: deleting.settings.members.filter(member => member.id !== deleting.member.id) }, deleting.revision).then(saved => { if (saved) setDeleting(null) })
    }}>{t(state.busy ? 'saving' : 'confirmDelete')}</Button></>}>{state.error ? <p role="alert" className={css.error}>{t(state.error)}</p> : null}</Modal> : null}
  </div>
}

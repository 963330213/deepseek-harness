/** Draft editor for a connection, its field grants, and SQL examples. */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal, Switch, Tooltip, IconPlusOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseCapabilities, validateCapabilities, type MemberDatabase } from '../capabilities.ts'
import { databaseTarget, type LoadCatalog } from '../database-catalog-contract.ts'
import type { TeamMember } from '../types.ts'
import { CapabilityField as Field } from './capability-forms.tsx'
import { DatabaseGrants } from './database-grants.tsx'
import css from './page.module.css'

type Props = PropsLocale<'settings.xlxAgentTeam'> & {
  value: MemberDatabase | undefined
  peers: MemberDatabase[]
  disabled: boolean
  accept: (value: MemberDatabase) => void
  close: () => void
  member: TeamMember
  loadCatalog: LoadCatalog
}

const newConnection: MemberDatabase = {
  id: '', name: '', enabled: true, host: '', port: 3306, database: '', username: '', passwordRef: '', tls: true,
  tables: [], columns: {}, maxRows: 100, timeoutMs: 10000, examples: [],
}

/**
 * Edit a connection and its table grants as one draft.
 * @param props - Existing connection, sibling connections and dialog actions.
 * @returns A database form that applies changes to the enclosing member draft.
 */
export const DatabaseEditor = ({ value, peers, disabled, accept, close, t, member, loadCatalog }: Props) => {
  const [draft, setDraft] = useState(value ?? newConnection)
  const [tables, setTables] = useState(() => draft.tables.map(name => ({ name, columns: draft.columns[name] ?? [] })))
  const saved = member.capabilities?.databases.find(database => database.id === value?.id)
  const [section, setSection] = useState<'connectionSettings' | 'tables' | 'sqlExamples'>(saved ? 'tables' : 'connectionSettings')
  const [error, setError] = useState(false)
  const target = databaseTarget(draft)
  const address = saved && databaseTarget(saved) === target ? { member: member.id, connection: saved.id, target } : undefined
  const update = (patch: Partial<MemberDatabase>) => setDraft(current => ({ ...current, ...patch }))
  const field = (label: Parameters<typeof t>[0], content: string, change: (text: string) => void, multiline = false, hint?: string) => <Field label={t(label)} value={content} change={change} disabled={disabled} multiline={multiline} {...hint ? { hint } : {}} />
  const number = (label: Parameters<typeof t>[0], content: number, change: (number: number) => void) => <Field label={t(label)} value={String(content)} change={text => change(Number(text))} disabled={disabled} type="number" />
  const remove = (label: string, action: () => void) => <Tooltip portal label={t('removeCapability')}><Button disabled={disabled} aria-label={`${t('removeCapability')} ${label}`} icon={<IconTrashOutlineRegular size={16} />} onClick={action} /></Tooltip>
  const submit = () => {
    try {
      const candidate = { ...draft, id: draft.id.trim(), name: draft.name.trim(), host: draft.host.trim(),
        database: draft.database.trim(), username: draft.username.trim(), passwordRef: draft.passwordRef.trim(),
        tables: tables.map(item => item.name), columns: Object.fromEntries(tables.map(item => [item.name, item.columns])),
        examples: draft.examples.map(example => ({ ...example, parameters: example.parameters.map(parameter => parameter.trim()).filter(Boolean) })),
      }
      const checked = validateCapabilities(parseCapabilities(structuredClone({ mcp: [], skills: [], databases: [...peers, candidate] })))
      accept(checked.databases.at(-1)!)
    } catch (validationError) { setError(true) }
  }
  return <Modal open className={css.memberDialog!} contentClassName={css.memberDialogContent!} title={t(value ? 'editDatabase' : 'addDatabase')} closeLabel={t('close')} onClose={() => { if (!disabled) close() }}
    footer={<><Button disabled={disabled} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={disabled} onClick={submit}>{t('confirm')}</Button></>}>
    <div className={css.editor}>
      <div className={css.tabs} role="group" aria-label={t('editDatabase')}>
        {(['connectionSettings', 'tables', 'sqlExamples'] as const).map(item => <Button key={item} aria-pressed={section === item} onClick={() => setSection(item)}>{t(item)}</Button>)}
      </div>
      {section === 'connectionSettings' ? <>
      <div className={css.toggle}><span>{t('enableCapability')}</span><Switch label={t('enableCapability')} checked={draft.enabled} disabled={disabled} onChange={enabled => update({ enabled })} /></div>
      <div className={css.formGrid}>
        {field('connectionName', draft.name, name => update({ name }))}
        {field('capabilityId', draft.id, id => update({ id }), false, t('idHint'))}
        {field('host', draft.host, host => update({ host }))}
        {number('port', draft.port, port => update({ port }))}
        {field('databaseName', draft.database, database => update({ database }))}
        {field('username', draft.username, username => update({ username }))}
      </div>
      {field('passwordRef', draft.passwordRef, passwordRef => update({ passwordRef }), false, t('passwordHint'))}
      <div className={css.toggle}><span>{t('tls')}</span><Switch label={t('tls')} checked={draft.tls} disabled={disabled} onChange={tls => update({ tls })} /></div>
      <div className={css.formGrid}>
        {number('rowLimit', draft.maxRows, maxRows => update({ maxRows }))}
        {number('timeout', draft.timeoutMs, timeoutMs => update({ timeoutMs }))}
      </div>
      </> : section === 'tables' ? address
        ? <DatabaseGrants address={address} load={loadCatalog} grants={tables} change={setTables} disabled={disabled} t={t} />
        : <p className={css.empty}>{t('saveToBrowse')}</p>
      : <>
      {draft.examples.map((example, index) => {
        const change = (patch: Partial<typeof example>) => update({ examples: draft.examples.map((item, cursor) => cursor === index ? { ...item, ...patch } : item) })
        return <fieldset className={css.capability} key={index}><legend>{t('sqlExample')}</legend>
          <div className={css.actions}>{remove(example.id || t('sqlExample'), () => update({ examples: draft.examples.filter((_, cursor) => cursor !== index) }))}</div>
          {field('capabilityId', example.id, id => change({ id }))}
          {field('question', example.question, question => change({ question }))}
          {field('sql', example.sql, sql => change({ sql }), true, t('sqlHint'))}
          {field('sqlParameters', example.parameters.join('\n'), text => change({ parameters: text.split('\n') }), true, t('parametersHint'))}
          {field('businessDescription', example.description, description => change({ description }), true)}
        </fieldset>
      })}
      <Button disabled={disabled} icon={<IconPlusOutlineRegular size={16} />} onClick={() => update({ examples: [...draft.examples, { id: '', question: '', sql: '', parameters: [], description: '' }] })}>{t('addSqlExample')}</Button>
      </>}
      {error ? <p role="alert" className={css.error}>{t('databaseError')}</p> : null}
    </div>
  </Modal>
}

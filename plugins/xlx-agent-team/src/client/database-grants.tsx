/** Browse metadata and stage grants for selected physical fields. */
import { useEffect, useId, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Checkbox, Input, IconRefreshOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { TABLE_COLUMN_LIMIT } from '../capabilities.ts'
import type { CatalogRequest, CatalogResult, LoadCatalog } from '../database-catalog-contract.ts'
import css from './page.module.css'

type Address = Pick<CatalogRequest, 'member' | 'connection' | 'target'>
type Grants = { name: string; columns: string[] }[]
type Props = PropsLocale<'settings.xlxAgentTeam'> & {
  address: Address
  load: LoadCatalog
  grants: Grants
  change: (grants: Grants) => void
  disabled: boolean
}

const failureLabels = { connection: 'catalogConnectionChanged', credentials: 'catalogCredentials', load: 'catalogFailed' } as const

/** Keep previous requests from publishing results after the selection changes. */
const useCatalog = (load: LoadCatalog, request: CatalogRequest | null, generation: number) => {
  const [snapshot, setSnapshot] = useState<{ request: CatalogRequest; generation: number; data: CatalogResult }>()
  useEffect(() => {
    if (!request) return
    const abort = new AbortController()
    const publish = (data: CatalogResult) => {
      if (!abort.signal.aborted) setSnapshot({ request, generation, data })
    }
    void load(request, abort.signal).then(publish, () => publish({ kind: 'error', reason: 'load' }))
    return () => abort.abort()
  }, [load, request, generation])
  return snapshot?.request === request && snapshot.generation === generation ? snapshot.data : undefined
}

/**
 * Select a table from a paginated catalog and grant individual columns.
 * @param props - Saved connection identity, staged grants and read action.
 * @returns The table picker and the active table's column checklist.
 */
export const DatabaseGrants = ({ address, load, grants, change, disabled, t }: Props) => {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [pages, setPages] = useState<string[]>([])
  const [table, setTable] = useState(grants[0]?.name ?? '')
  const [filter, setFilter] = useState('')
  const [tableRefresh, refreshTables] = useState(0)
  const [fieldRefresh, refreshFields] = useState(0)
  const picker = useId()
  const after = pages.at(-1)
  const { member, connection, target } = address
  const tableRequest = useMemo<CatalogRequest>(() => ({ member, connection, target, kind: 'tables', search, ...(after ? { after } : {}) }), [member, connection, target, search, after])
  const fieldRequest = useMemo<CatalogRequest | null>(() => table ? { member, connection, target, kind: 'columns', table } : null, [member, connection, target, table])
  const tables = useCatalog(load, tableRequest, tableRefresh)
  const columns = useCatalog(load, fieldRequest, fieldRefresh)
  const names = tables?.kind === 'tables' ? tables.names : []
  const grant = grants.find(item => item.name === table)
  const selected = new Set(grant?.columns.map(column => column.toLowerCase()))
  const fieldNames = new Set(columns?.kind === 'columns' ? columns.fields.map(field => field.name.toLowerCase()) : [])
  const stale = columns?.kind === 'columns' ? grant?.columns.filter(column => !fieldNames.has(column.toLowerCase())) ?? [] : []
  const query = filter.trim().toLowerCase()
  const visible = columns?.kind === 'columns'
    ? columns.fields.filter(field => field.name.toLowerCase().includes(query) || field.comment.toLowerCase().includes(query))
    : []
  const choose = (name: string) => { setTable(name); setFilter('') }
  const update = (name: string, checked: boolean) => {
    const current = grant?.columns ?? []
    const next = checked ? [...current, name] : current.filter(column => column.toLowerCase() !== name.toLowerCase())
    if (!next.length) change(grants.filter(item => item.name !== table))
    else if (grant) change(grants.map(item => item.name === table ? { ...item, columns: next } : item))
    else change([...grants, { name: table, columns: next }])
  }
  return <div className={css.editor}>
    <div className={css.toolbar}>
      <Input aria-label={t('searchTables')} placeholder={t('searchTables')} maxLength={64} value={input} disabled={disabled} onChange={event => setInput(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); setSearch(input.trim()); setPages([]) }
      }} />
      <Button disabled={disabled} icon={<IconSearchOutlineRegular size={16} />} onClick={() => { setSearch(input.trim()); setPages([]) }}>{t('searchAction')}</Button>
      <Button disabled={disabled || !tables} icon={<IconRefreshOutlineRegular size={16} />} onClick={() => refreshTables(current => current + 1)}>{t('refreshTables')}</Button>
    </div>
    <label className={css.field} htmlFor={picker}><span>{t('physicalTable')}</span>
      <select id={picker} disabled={disabled || tables?.kind !== 'tables'} value={table} onChange={event => choose(event.target.value)}>
        <option value="">{t('chooseTable')}</option>
        {table && !names.includes(table) ? <option value={table}>{table}</option> : null}
        {names.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    {!tables ? <p className={css.help} role="status">{t('loadingTables')}</p> : null}
    {tables?.kind === 'error' ? <p className={css.error} role="alert">{t(failureLabels[tables.reason])}</p> : null}
    {tables?.kind === 'tables' && !names.length ? <p className={css.help} role="status">{t('noTables')}</p> : null}
    {tables?.kind === 'tables' && (pages.length || tables.next) ? <div className={css.actions}>
      <Button size="sm" disabled={!pages.length || disabled} onClick={() => setPages(current => current.slice(0, -1))}>{t('previousTables')}</Button>
      <Button size="sm" disabled={!tables.next || disabled} onClick={() => { if (tables.next) setPages([...pages, tables.next]) }}>{t('nextTables')}</Button>
    </div> : null}
    {grants.length ? <div className={css.grantList} role="group" aria-label={t('configuredTables')}>
      {grants.map(item => <Button size="sm" key={item.name} disabled={disabled} aria-pressed={item.name === table} onClick={() => choose(item.name)}>{item.name} · {item.columns.length}</Button>)}
    </div> : null}
    {table ? <section className={css.fieldPanel} aria-label={t('allowedColumns')} aria-busy={!columns}>
      <div className={css.sectionToolbar}>
        <div><strong>{t('allowedColumns')}</strong><p className={css.help}>{t('selectedColumns').replace('{count}', String(selected.size)).replace('{max}', String(TABLE_COLUMN_LIMIT))}</p></div>
        <Button size="sm" disabled={disabled || !columns} icon={<IconRefreshOutlineRegular size={16} />} onClick={() => refreshFields(current => current + 1)}>{t('refreshFields')}</Button>
      </div>
      {!columns ? <p className={css.help} role="status">{t('loadingFields')}</p> : null}
      {columns?.kind === 'error' ? <p className={css.error} role="alert">{t(failureLabels[columns.reason])}</p> : null}
      {columns?.kind === 'columns' ? <>
        <Input aria-label={t('searchFields')} placeholder={t('searchFields')} value={filter} disabled={disabled} onChange={event => setFilter(event.target.value)} />
        {visible.length ? <div className={css.fieldChoices}>
          {visible.map(field => {
            const checked = selected.has(field.name.toLowerCase())
            return <div className={css.fieldChoice} key={field.name}>
              <Checkbox label={field.name} checked={checked} onChange={value => update(field.name, value)} disabled={disabled || (!checked && selected.size >= TABLE_COLUMN_LIMIT)} />
              <span className={css.fieldType}>{field.type}</span>
              {field.comment ? <span className={css.fieldComment}>{field.comment}</span> : null}
            </div>
          })}
        </div> : <p className={css.help}>{t('noFields')}</p>}
        {stale.length ? <div className={css.fieldChoices}><p className={css.help}>{t('missingFields')}</p>{stale.map(name =>
          <Checkbox key={name} label={name} checked disabled={disabled} onChange={() => update(name, false)} />,
        )}</div> : null}
      </> : null}
    </section> : null}
  </div>
}

/** Browse metadata and stage grants for selected physical fields. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Checkbox, Input, IconCheckOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
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
type TableFailure = Extract<CatalogResult, { kind: 'error' }>['reason']
type TablePages = { search: string; names: string[]; next: string | null } & (
  | { status: 'loading'; after: string | null }
  | { status: 'ready' }
  | { status: 'error'; after: string | null; reason: TableFailure }
)

const firstPage = (search: string): TablePages => ({ search, names: [], next: null, status: 'loading', after: null })

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

type PickerProps = Pick<Props, 'address' | 'load' | 'disabled' | 't'> & {
  table: string
  choose: (name: string) => void
}

/** Keep loaded table rows in view while requesting the next cursor. */
const TablePicker = ({ address, load, table, choose, disabled, t }: PickerProps) => {
  const [input, setInput] = useState('')
  const [pages, setPages] = useState(() => firstPage(''))
  const list = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const { member, connection, target } = address

  useEffect(() => {
    if (pages.status !== 'loading') return
    const abort = new AbortController()
    const publish = (result: CatalogResult) => {
      if (abort.signal.aborted) return
      setPages(current => {
        if (current !== pages) return current
        if (result.kind !== 'tables') {
          const reason = result.kind === 'error' ? result.reason : 'load'
          return { ...pages, status: 'error', reason }
        }
        return {
          search: pages.search, names: [...new Set([...pages.names, ...result.names])],
          next: result.next, status: 'ready',
        }
      })
    }
    const request: CatalogRequest = {
      member, connection, target, kind: 'tables', search: pages.search,
      ...(pages.after === null ? {} : { after: pages.after }),
    }
    void load(request, abort.signal).then(publish, () => publish({ kind: 'error', reason: 'load' }))
    return () => abort.abort()
  }, [load, member, connection, target, pages])

  useEffect(() => {
    if (disabled || pages.status !== 'ready' || pages.next === null || !list.current || !end.current) return
    const after = pages.next
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setPages(current => current === pages ? { ...pages, status: 'loading', after } : current)
      }
    }, { root: list.current, rootMargin: '0px 0px 40px' })
    observer.observe(end.current)
    return () => observer.disconnect()
  }, [disabled, pages])

  const restart = (search: string) => {
    if (list.current) list.current.scrollTop = 0
    setPages(firstPage(search))
  }
  const retry = () => setPages(current => current.status === 'error' ? { ...current, status: 'loading' } : current)

  return <section className={css.fieldPanel}>
    <div className={css.sectionToolbar}>
      <h3 className={css.catalogHeading}>{t('physicalTable')}</h3>
      <Button size="sm" disabled={disabled || pages.status === 'loading'} icon={<IconRefreshOutlineRegular size={16} />} onClick={() => restart(pages.search)}>{t('refreshTables')}</Button>
    </div>
    <form className={css.tableSearch} onSubmit={event => { event.preventDefault(); restart(input.trim()) }}>
      <Input aria-label={t('searchTables')} placeholder={t('searchTables')} maxLength={64} value={input} disabled={disabled} onChange={event => setInput(event.target.value)} />
      <Button type="submit" disabled={disabled} icon={<IconSearchOutlineRegular size={16} />}>{t('searchAction')}</Button>
    </form>
    {pages.names.length || pages.status !== 'error' ? <div className={css.tableList} ref={list} tabIndex={0} role="region" aria-label={t('physicalTable')}>
      {pages.names.length ? <ul className={css.tableRows}>
        {pages.names.map(name => <li key={name}>
          <Button className={css.tableOption} disabled={disabled} aria-pressed={name === table} onClick={() => choose(name)}>
            <span>{name}</span>
            {name === table ? <IconCheckOutlineRegular size={16} aria-hidden /> : null}
          </Button>
        </li>)}
      </ul> : <p className={css.tableStatus} role="status">{t(pages.status === 'loading' ? 'loadingTables' : 'noTables')}</p>}
      {pages.status === 'ready' && pages.next !== null ? <div className={css.tableListEnd} ref={end} aria-hidden /> : null}
    </div> : null}
    {pages.status === 'loading' && pages.names.length ? <p className={css.help} role="status">{t('loadingMoreTables')}</p> : null}
    {pages.status === 'error' ? <div className={css.notice}>
      <p className={css.error} role="alert">{t(failureLabels[pages.reason])}</p>
      {pages.reason === 'load' ? <Button size="sm" disabled={disabled} icon={<IconRefreshOutlineRegular size={16} />} onClick={retry}>{t('retry')}</Button> : null}
    </div> : null}
  </section>
}

/**
 * Select a table from a paginated catalog and grant individual columns.
 * @param props - Saved connection identity, staged grants and read action.
 * @returns The table picker and the active table's column checklist.
 */
export const DatabaseGrants = ({ address, load, grants, change, disabled, t }: Props) => {
  const [table, setTable] = useState(grants[0]?.name ?? '')
  const [filter, setFilter] = useState('')
  const [fieldRefresh, refreshFields] = useState(0)
  const { member, connection, target } = address
  const fieldRequest = useMemo<CatalogRequest | null>(() => table ? { member, connection, target, kind: 'columns', table } : null, [member, connection, target, table])
  const columns = useCatalog(load, fieldRequest, fieldRefresh)
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
    {grants.length ? <div className={css.grantList} role="group" aria-label={t('configuredTables')}>
      {grants.map(item => <Button size="sm" key={item.name} disabled={disabled} aria-pressed={item.name === table} onClick={() => choose(item.name)}>{item.name} · {item.columns.length}</Button>)}
    </div> : null}
    <div className={css.databaseGrantsLayout}>
      <TablePicker key={JSON.stringify([member, connection, target])} address={address} load={load} table={table} choose={choose} disabled={disabled} t={t} />
      <section className={css.fieldPanel} aria-label={t('allowedColumns')} aria-busy={Boolean(table) && !columns}>
        <div className={css.sectionToolbar}>
          <h3 className={css.catalogHeading}>{t('allowedColumns')}</h3>
          {table ? <Button size="sm" disabled={disabled || !columns} icon={<IconRefreshOutlineRegular size={16} />} onClick={() => refreshFields(current => current + 1)}>{t('refreshFields')}</Button> : null}
        </div>
        {table ? <div className={css.columnContext}>
          <span>{table}</span><span className={css.status}>{t('selectedColumns').replace('{count}', String(selected.size)).replace('{max}', String(TABLE_COLUMN_LIMIT))}</span>
        </div> : <p className={css.help}>{t('chooseTable')}</p>}
        {table && !columns ? <p className={css.help} role="status">{t('loadingFields')}</p> : null}
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
      </section>
    </div>
  </div>
}

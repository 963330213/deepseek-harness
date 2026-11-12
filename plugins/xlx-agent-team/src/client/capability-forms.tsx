/** Isolated drafts for member-owned MCP servers and skill bundles. */
import { useId, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Modal, Switch, IconArchiveOutlineRegular, IconCodeOutlineRegular, IconFolderOpenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SKILL_BYTES, parseCapabilities, parseStringMap, validateCapabilities, type MemberMcp, type MemberSkill } from '../capabilities.ts'
import { importSkill } from '../skill-bundle.ts'
import css from './page.module.css'

/** Parse one stdio entry from a portable MCP settings document. */
const stdioEntry = (text: string): Pick<MemberMcp, 'name' | 'command' | 'args' | 'env' | 'cwd'> => {
  const document: unknown = JSON.parse(text)
  if (!document || typeof document !== 'object' || !('mcpServers' in document)) throw new Error('Missing mcpServers')
  const servers = document.mcpServers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers) || Object.keys(servers).length !== 1) throw new Error('Expected one MCP server')
  const [name, server]: [string, unknown] = Object.entries(servers)[0]!
  if (!server || typeof server !== 'object' || !('command' in server) || typeof server.command !== 'string') throw new Error('Missing stdio command')
  if (Object.keys(server).some(key => !['command', 'args', 'env', 'cwd', 'type'].includes(key)) || ('type' in server && server.type !== 'stdio')) throw new Error('Unsupported stdio configuration')
  const args: unknown = 'args' in server ? server.args : []
  const cwd: unknown = 'cwd' in server ? server.cwd : ''
  if (!Array.isArray(args) || !args.every((arg: unknown): arg is string => typeof arg === 'string') || typeof cwd !== 'string') throw new Error('Invalid stdio arguments or working directory')
  return { name, command: server.command, args, cwd, env: 'env' in server ? JSON.stringify(server.env) : '{}' }
}

type EditorProps<T> = PropsLocale<'settings.xlxAgentTeam'> & {
  value: T | undefined
  peers: T[]
  disabled: boolean
  accept: (value: T) => void
  close: () => void
  saveError?: string | undefined
}

/**
 * Label a form field with a stable id.
 * @param props - Controlled value, label and input options.
 * @returns A labeled input or multiline editor.
 */
export const CapabilityField = ({ label, value, change, disabled, multiline = false, type = 'text', hint, rows = 3, code = false }: { label: string; value: string; change: (value: string) => void; disabled: boolean; multiline?: boolean; type?: 'text' | 'number'; hint?: string; rows?: number; code?: boolean }) => {
  const id = useId()
  return <label className={css.field} htmlFor={id}><span>{label}</span>{multiline
    ? <textarea id={id} rows={rows} className={code ? css.codeInput : undefined} spellCheck={!code} value={value} disabled={disabled} onChange={event => change(event.target.value)} />
    : <Input id={id} type={type} value={value} disabled={disabled} onChange={event => change(event.target.value)} />}{hint ? <small>{hint}</small> : null}</label>
}

/**
 * Stage one validated MCP configuration without persisting the member.
 * @param props - Initial server, other servers and draft acceptance callback.
 * @returns The add or edit dialog; cancellation leaves the member unchanged.
 */
export const McpEditor = ({ value, peers, disabled, accept, close, saveError, t }: EditorProps<MemberMcp>) => {
  const [draft, setDraft] = useState<MemberMcp>(() => value ?? { name: '', enabled: true, transport: 'stdio', command: '', args: [], env: '{}', cwd: '', url: '', headers: '{}', timeoutMs: 60000 })
  const [stdioJson, setStdioJson] = useState(() => {
    let env: string | Record<string, string>
    try { env = parseStringMap(draft.env) } catch (error) { env = draft.env }
    return JSON.stringify({ mcpServers: { [draft.name || 'my-tool']: {
      command: draft.command, args: draft.args, env, ...(draft.cwd ? { cwd: draft.cwd } : {}),
    } } }, null, 2)
  })
  const [error, setError] = useState<'mcpError' | 'malformedJson'>()
  const update = (patch: Partial<MemberMcp>) => setDraft(current => ({ ...current, ...patch }))
  const field = (label: Parameters<typeof t>[0], content: string, change: (text: string) => void, hint?: string) => <CapabilityField label={t(label)} value={content} change={change} disabled={disabled} {...hint ? { hint } : {}} />
  const format = () => {
    try {
      setStdioJson(JSON.stringify(JSON.parse(stdioJson), null, 2))
      setError(undefined)
    } catch (syntaxError) { setError('malformedJson') }
  }
  const submit = () => {
    try {
      const candidate = draft.transport === 'stdio' ? { ...draft, ...stdioEntry(stdioJson) } : { ...draft, name: draft.name.trim() }
      const checked = validateCapabilities(parseCapabilities(structuredClone({ mcp: [...peers, candidate], skills: [], databases: [] })))
      accept(checked.mcp.at(-1)!)
    } catch (validationError) { setError('mcpError') }
  }
  return <Modal open className={css.memberDialog!} contentClassName={css.memberDialogContent!} title={t(value ? 'editMcp' : 'addMcp')} closeLabel={t('close')} onClose={() => { if (!disabled) close() }}
    footer={<><Button disabled={disabled} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={disabled} onClick={submit}>{t('confirm')}</Button></>}>
    <div className={css.editor}>
      <div className={css.sectionToolbar}>
        <div className={css.choices} role="group" aria-label={t('transport')}>
          {(['stdio', 'streamable-http'] as const).map(transport => <Button key={transport} disabled={disabled} aria-pressed={draft.transport === transport} onClick={() => {
            update({ transport })
            setError(undefined)
          }}>{t(transport === 'stdio' ? 'stdio' : 'http')}</Button>)}
        </div>
        {draft.transport === 'stdio' ? <Button size="sm" disabled={disabled} icon={<IconCodeOutlineRegular size={16} />} onClick={format}>{t('formatJson')}</Button> : null}
      </div>
      {draft.transport === 'stdio' ? <CapabilityField label={t('mcpConfigJson')} value={stdioJson} change={text => { setStdioJson(text); setError(undefined) }} disabled={disabled} multiline code rows={10} hint={t('mcpConfigHint')} /> : <>
        {field('serviceName', draft.name, name => update({ name }), t('idHint'))}
        {field('url', draft.url, url => update({ url }))}
        <CapabilityField label={t('headers')} value={draft.headers} change={headers => update({ headers })} disabled={disabled} multiline code hint={t('credentialHint')} />
      </>}
      <div className={css.formGrid}>
        <CapabilityField label={t('timeout')} type="number" value={String(draft.timeoutMs)} disabled={disabled} change={text => update({ timeoutMs: Number(text) })} />
        <div className={css.switchField}><span>{t('enableCapability')}</span><Switch checked={draft.enabled} label={t('enableCapability')} disabled={disabled} onChange={enabled => update({ enabled })} /></div>
      </div>
      {error || saveError ? <p role="alert" className={css.error}>{error ? t(error) : saveError}</p> : null}
    </div>
  </Modal>
}

/**
 * Stage a complete ZIP bundle or change an existing skill's enabled status.
 * @param props - Initial bundle, other skills, import lock and acceptance callback.
 * @returns A skill editor whose changes remain local until confirmed.
 */
export const SkillEditor = ({ value, peers, disabled, accept, close, saveError, importingChanged, t }: EditorProps<MemberSkill> & { importingChanged?: (busy: boolean) => void }) => {
  const [draft, setDraft] = useState(value)
  const [filename, setFilename] = useState<string>()
  const [enabled, setEnabled] = useState(value?.enabled ?? true)
  const [error, setError] = useState<'skillZipRequired' | 'skillZipSize' | 'skillZipInvalid' | 'skillError'>()
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const uploadInput = useRef<HTMLInputElement>(null)
  const uploadInFlight = useRef(false)
  const dragDepth = useRef(0)
  const uploadHelp = useId()
  const locked = disabled || importing
  const files = draft ? Object.keys(draft.files) : []
  const upload = async (selection: FileList) => {
    if (disabled || uploadInFlight.current) return
    const file = selection.item(0)
    if (selection.length !== 1 || !file || !/\.zip$/i.test(file.name)) { setError('skillZipRequired'); return }
    if (file.size > SKILL_BYTES) { setError('skillZipSize'); return }
    uploadInFlight.current = true
    setError(undefined)
    setImporting(true)
    importingChanged?.(true)
    try {
      const skill = importSkill(file.name, new Uint8Array(await file.arrayBuffer()))
      setDraft(skill)
      setFilename(file.name)
    } catch (importError) {
      // Failed imports leave the current bundle available for correction.
      setError('skillZipInvalid')
    } finally {
      uploadInFlight.current = false
      setImporting(false)
      importingChanged?.(false)
    }
  }
  const submit = () => {
    if (!draft || locked || uploadInFlight.current) return
    try {
      const candidate = { ...draft, enabled }
      validateCapabilities({ mcp: [], databases: [], skills: [...peers, candidate] })
      setError(undefined)
      accept(candidate)
    } catch (validationError) { setError('skillError') }
  }
  return <Modal open className={css.skillDialog!} contentClassName={css.memberDialogContent!} title={t(value ? 'editSkill' : 'installSkill')} closeLabel={t('close')} onClose={() => { if (!locked) close() }}
    footer={<><Button disabled={locked} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={locked || !draft} onClick={submit}>{t(value ? 'confirm' : 'installSkill')}</Button></>}>
    <div className={css.editor}>
      <input ref={uploadInput} type="file" accept=".zip,application/zip" disabled={locked} hidden onChange={event => {
        const selection = event.currentTarget.files
        if (selection?.length) void upload(selection)
        event.currentTarget.value = ''
      }} />
      <section className={css.uploadPanel} data-filled={!!draft} data-dragging={dragging && !locked} aria-label={t('importSkill')} aria-busy={importing}
        onDragEnter={event => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          dragDepth.current++
          setDragging(true)
        }}
        onDragOver={event => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = locked ? 'none' : 'copy'
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={event => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          if (!locked) void upload(event.dataTransfer.files)
        }}>
        <div className={css.uploadHeader}>
          <span className={css.uploadIcon}><IconArchiveOutlineRegular size={22} aria-hidden="true" /></span>
          <div className={css.uploadCopy}>
            <div className={css.memberTitle}>{draft?.name ?? t('dropSkillZip')}</div>
            <p className={css.help} id={uploadHelp}>{draft?.description ?? t('skillImportHint')}</p>
            {filename ? <p className={css.meta}>{filename}</p> : null}
          </div>
          <Button disabled={locked} data-modal-autofocus aria-describedby={draft ? undefined : uploadHelp} icon={<IconFolderOpenOutlineRegular size={16} />}
            onClick={() => uploadInput.current?.click()}>{t(draft ? 'replaceZip' : 'chooseZip')}</Button>
        </div>
        {draft ? <details className={css.uploadFiles}>
          <summary>{t('skillFiles')} · {files.length}</summary>
          <ul className={css.skillFiles}>{files.map(path => <li key={path}>{path}</li>)}</ul>
        </details> : null}
      </section>
      {importing ? <p role="status" className={css.help}>{t('importingSkill')}</p> : null}
      {error || saveError ? <p role="alert" className={css.error}>{error ? t(error) : saveError}</p> : null}
      {draft ? <div className={css.toggle}><span>{t('enableCapability')}</span><Switch label={t('enableCapability')} checked={enabled} disabled={locked} onChange={setEnabled} /></div> : null}
    </div>
  </Modal>
}

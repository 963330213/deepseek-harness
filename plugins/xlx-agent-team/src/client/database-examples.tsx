/** List and edit SQL examples before confirming a database connection. */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal, Tooltip, IconEditOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseSqlExample, type SqlExample } from '../capabilities.ts'
import { CapabilityField } from './capability-forms.tsx'
import css from './page.module.css'

type ListProps = PropsLocale<'settings.xlxAgentTeam'> & {
  examples: SqlExample[]
  change: (examples: SqlExample[]) => void
  disabled: boolean
}

type DialogProps = Omit<ListProps, 'change'> & {
  value: SqlExample | undefined
  accept: (example: SqlExample) => void
  close: () => void
}

/** Keep an unfinished example separate from the connection draft. */
const SqlExampleDialog = ({ value, examples, disabled, accept, close, t }: DialogProps) => {
  const [draft, setDraft] = useState(() => ({
    id: value?.id ?? '',
    question: value?.question ?? '',
    sql: value?.sql ?? '',
    parameters: value?.parameters.join('\n') ?? '',
    description: value?.description ?? '',
  }))
  const [error, setError] = useState<'sqlExampleError' | 'duplicateSqlExample'>()
  const change = (key: keyof typeof draft, text: string) => {
    setDraft(current => ({ ...current, [key]: text }))
    setError(undefined)
  }
  const submit = () => {
    let example: SqlExample
    try {
      example = parseSqlExample({ ...draft, id: draft.id.trim(), parameters: draft.parameters.split('\n') })
    } catch (validationError) {
      setError('sqlExampleError')
      return
    }
    if (examples.some(item => item.id !== value?.id && item.id === example.id)) {
      setError('duplicateSqlExample')
      return
    }
    accept(example)
  }

  return <Modal open className={css.memberDialog!} contentClassName={css.memberDialogContent!}
    title={t(value ? 'editSqlExample' : 'addSqlExample')} closeLabel={t('close')} onClose={close} backdropBlur={false}
    footer={<>
      {error ? <p role="alert" className={css.error}>{t(error)}</p> : null}
      <Button disabled={disabled} onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" disabled={disabled} onClick={submit}>{t('confirm')}</Button>
    </>}>
    <div className={css.editor}>
      <CapabilityField label={t('capabilityId')} value={draft.id} change={text => change('id', text)} disabled={disabled} hint={t('idHint')} />
      <CapabilityField label={t('question')} value={draft.question} change={text => change('question', text)} disabled={disabled} />
      <CapabilityField label={t('sql')} value={draft.sql} change={text => change('sql', text)} disabled={disabled} multiline code rows={8} hint={t('sqlHint')} />
      <CapabilityField label={t('sqlParameters')} value={draft.parameters} change={text => change('parameters', text)} disabled={disabled} multiline hint={t('parametersHint')} />
      <CapabilityField label={t('businessDescription')} value={draft.description} change={text => change('description', text)} disabled={disabled} multiline />
    </div>
  </Modal>
}

/**
 * Manage examples in a connection draft.
 * @param props - Current examples and callback for confirmed additions, edits and removals.
 * @returns A compact list with a separate form for one example at a time.
 */
export const DatabaseExamples = ({ examples, change, disabled, t }: ListProps) => {
  const [editing, setEditing] = useState<SqlExample | 'add' | null>(null)
  const close = () => setEditing(null)
  const accept = (next: SqlExample) => {
    if (editing === null) return
    change(editing === 'add' ? [...examples, next] : examples.map(item => item.id === editing.id ? next : item))
    close()
  }

  return <>
    <div className={css.toolbar}>
      <Button disabled={disabled} icon={<IconPlusOutlineRegular size={16} />} onClick={() => setEditing('add')}>{t('addSqlExample')}</Button>
    </div>
    {examples.length ? <table className={`${css.capabilityList} ${css.sqlExampleList}`} aria-label={t('sqlExamples')}>
      <thead><tr><th scope="col">{t('question')}</th><th scope="col">{t('capabilityActions')}</th></tr></thead>
      <tbody>
        {examples.map(example => <tr key={example.id}>
          <td>
            <div className={css.memberTitle}>{example.question}</div>
            <div className={css.meta}>{example.id}</div>
          </td>
          <td><div className={css.actions}>
            <Tooltip portal label={t('editSqlExample')}>
              <Button disabled={disabled} aria-label={`${t('editSqlExample')} ${example.id}`}
                icon={<IconEditOutlineRegular size={16} />} onClick={() => setEditing(example)} />
            </Tooltip>
            <Tooltip portal label={t('removeCapability')}>
              <Button disabled={disabled} aria-label={`${t('removeCapability')} ${example.id}`}
                icon={<IconTrashOutlineRegular size={16} />} onClick={() => change(examples.filter(item => item.id !== example.id))} />
            </Tooltip>
          </div></td>
        </tr>)}
      </tbody>
    </table> : <p className={css.empty}>{t('emptySqlExamples')}</p>}
    {editing !== null ? <SqlExampleDialog value={editing === 'add' ? undefined : editing}
      examples={examples} disabled={disabled} accept={accept} close={close} t={t} /> : null}
  </>
}

/** Lists and draft dialogs for member-scoped capabilities. */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Switch, Tooltip, IconPlusOutlineRegular, IconEditOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MemberCapabilities } from '../capabilities.ts'
import type { TeamMember } from '../types.ts'
import type { LoadCatalog } from '../database-catalog-contract.ts'
import { McpEditor, SkillEditor } from './capability-forms.tsx'
import { DatabaseEditor } from './database-form.tsx'
import css from './page.module.css'

type Props = PropsLocale<'settings.xlxAgentTeam'> & {
  section: keyof MemberCapabilities
  value: MemberCapabilities
  disabled: boolean
  change: (value: MemberCapabilities) => void
  importingChanged: (busy: boolean) => void
  member: TeamMember
  loadCatalog: LoadCatalog
}

const labels = {
  mcp: { add: 'addMcp', edit: 'editMcp', empty: 'emptyMcp' },
  skills: { add: 'installSkill', edit: 'editSkill', empty: 'emptySkills' },
  databases: { add: 'addDatabase', edit: 'editDatabase', empty: 'emptyDatabases' },
} as const

/**
 * Edit one capability family without writing until the enclosing member is saved.
 * @param props - Member draft, locale and immutable update callback.
 * @returns Capability controls inside the member dialog.
 */
export const CapabilityEditor = ({ section, value, change, disabled, importingChanged, t, member, loadCatalog }: Props) => {
  const [editing, setEditing] = useState<number | null>(null)
  const items = value[section]
  const label = labels[section]
  const close = () => setEditing(null)
  const editor = { disabled, t, close }
  const filter = <T,>(rows: T[], index: number) => rows.filter((_, cursor) => cursor !== index)
  const accept = <K extends keyof MemberCapabilities,>(key: K, rows: MemberCapabilities[K], index: number, next: MemberCapabilities[K][number]) => {
    change({ ...value, [key]: index < 0 ? [...rows, next] : rows.map((item, cursor) => cursor === index ? next : item) })
    close()
  }
  const update = (index: number, enabled: boolean) => {
    if (section === 'mcp') change({ ...value, mcp: value.mcp.map((item, cursor) => cursor === index ? { ...item, enabled } : item) })
    else if (section === 'skills') change({ ...value, skills: value.skills.map((item, cursor) => cursor === index ? { ...item, enabled } : item) })
    else change({ ...value, databases: value.databases.map((item, cursor) => cursor === index ? { ...item, enabled } : item) })
  }
  return <div className={css.editor}>
    <div className={css.toolbar}><Button disabled={disabled} icon={<IconPlusOutlineRegular size={16} />} onClick={() => setEditing(-1)}>{t(label.add)}</Button></div>
    {items.length ? <table className={css.capabilityList} aria-label={t(section)}>
      <thead><tr><th scope="col">{t('name')}</th><th scope="col">{t('capabilityStatus')}</th><th scope="col">{t('capabilityActions')}</th></tr></thead>
      <tbody>{items.map((item, index) => <tr key={'id' in item ? item.id : item.name}>
        <td><div className={css.memberTitle}>{item.name}</div><div className={css.meta}>{'transport' in item ? t(item.transport === 'stdio' ? 'stdio' : 'http') : 'database' in item ? item.database : item.description}</div></td>
        <td><Switch label={`${t('enableCapability')} ${item.name}`} checked={item.enabled} disabled={disabled} onChange={enabled => update(index, enabled)} /></td>
        <td><div className={css.actions}>
          <Tooltip portal label={t(label.edit)}><Button disabled={disabled} aria-label={`${t(label.edit)} ${item.name}`} icon={<IconEditOutlineRegular size={16} />} onClick={() => setEditing(index)} /></Tooltip>
          <Tooltip portal label={t('removeCapability')}><Button disabled={disabled} aria-label={`${t('removeCapability')} ${item.name}`} icon={<IconTrashOutlineRegular size={16} />} onClick={() => change({ ...value, [section]: items.filter((_, cursor) => cursor !== index) })} /></Tooltip>
        </div></td>
      </tr>)}</tbody>
    </table> : <p className={css.empty}>{t(label.empty)}</p>}
    {editing === null ? null : section === 'mcp'
      ? <McpEditor {...editor} value={value.mcp[editing]} peers={filter(value.mcp, editing)} accept={server => accept('mcp', value.mcp, editing, server)} />
      : section === 'skills'
        ? <SkillEditor {...editor} value={value.skills[editing]} peers={filter(value.skills, editing)} importingChanged={importingChanged} accept={skill => accept('skills', value.skills, editing, skill)} />
        : <DatabaseEditor {...editor} value={value.databases[editing]} peers={filter(value.databases, editing)} member={member} loadCatalog={loadCatalog} accept={database => accept('databases', value.databases, editing, database)} />}
  </div>
}

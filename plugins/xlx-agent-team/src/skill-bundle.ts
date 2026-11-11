/** Portable single-skill imports shared by the editor and server validation. */
import { unzipSync } from 'fflate/browser'
import { parseDocument } from 'yaml'
import { SKILL_BYTES, SKILL_FILES, validateCapabilities, type MemberSkill } from './capabilities.ts'

/**
 * Read frontmatter without executing custom YAML tags.
 * @param bytes - UTF-8 SKILL.md bytes.
 * @returns Required name and description.
 */
export const readSkillHeader = (bytes: Uint8Array): { name: string; description: string } => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!header) throw new Error('SKILL.md requires YAML name and description frontmatter')
  const document = parseDocument(header[1]!, { uniqueKeys: true })
  if (document.errors.length || document.warnings.length) throw new Error('Invalid skill frontmatter')
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  if (!value || typeof value !== 'object' || !('name' in value) || !('description' in value) || typeof value.name !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.name) || typeof value.description !== 'string' || !value.description.trim()) throw new Error('Skill name or description is invalid')
  return { name: value.name, description: value.description }
}

/**
 * Import one ZIP with a single SKILL.md and relative resources.
 * @param filename - Selected .zip file name.
 * @param bytes - Uploaded bytes, capped before archive expansion.
 * @returns A validated, portable skill definition. Import never executes scripts.
 */
export const importSkill = (filename: string, bytes: Uint8Array): MemberSkill => {
  if (bytes.length > SKILL_BYTES) throw new Error('Skill upload exceeds 1 MiB')
  if (!/\.zip$/i.test(filename)) throw new Error('Choose a ZIP skill file')
  let expanded = 0
  const seen = new Set<string>()
  const files = unzipSync(bytes, { filter: entry => {
    if (entry.name.endsWith('/')) return false
    if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.includes(':') || entry.name.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsafe archive path')
    expanded += entry.originalSize
    if (seen.has(entry.name) || seen.size >= SKILL_FILES || expanded > SKILL_BYTES) throw new Error('Skill archive exceeds limits or repeats a path')
    seen.add(entry.name)
    return true
  } })
  const candidates = Object.keys(files).filter(path => /(^|\/)SKILL\.md$/.test(path))
  if (candidates.length !== 1) throw new Error('The ZIP must contain exactly one SKILL.md')
  const root = candidates[0]!.slice(0, -'SKILL.md'.length)
  if (Object.keys(files).some(path => !path.startsWith(root))) throw new Error('All files must belong to the skill directory')
  const content = files[candidates[0]!]!
  const skill: MemberSkill = { ...readSkillHeader(content), enabled: true, files: Object.fromEntries(Object.entries(files).map(([path, data]) => {
    let binary = ''
    for (const byte of data) binary += String.fromCharCode(byte)
    return [path.slice(root.length), btoa(binary)]
  })) }
  validateCapabilities({ mcp: [], databases: [], skills: [skill] })
  return skill
}

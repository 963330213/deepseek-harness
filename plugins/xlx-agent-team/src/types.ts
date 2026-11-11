/** Persisted member configuration shared by the Host and settings editor. */
import { validateCapabilities, type MemberCapabilities } from './capabilities.ts'

/** A reusable teammate definition. Running children retain their accepted configuration. */
export interface TeamMember {
  /** Stable identifier used by the lead's delegation tool. */
  id: string
  /** Human-readable member name. */
  name: string
  /** Instructions included in the child's logged first message. */
  instructions: string
  /** Whether the lead may start new tasks with this member. */
  enabled: boolean
  /** Both empty strings inherit the lead's model route. */
  provider: string
  /** Exact model id within the selected provider. */
  model: string
  /** Private additions; absent in profiles created before capability support. */
  capabilities?: MemberCapabilities
}

/** Live settings persisted through the profile's revision-fenced configuration editor. */
export interface TeamSettings {
  /** Whether configured teammates are offered to root agents. */
  enabled: boolean
  /** User-owned member definitions, in display order. */
  members: Record<string, Omit<TeamMember, 'id'>>
}

/** Ordered member rows used by the settings editor. */
export interface TeamRoster {
  enabled: boolean
  members: TeamMember[]
}

/** Identifiers remain valid as subagent names and tool arguments. */
export const MEMBER_ID_PATTERN = /^(?!lead$)[a-z][a-z0-9-]{0,31}$/

/**
 * Validate roster-wide invariants after the field schema has accepted each member.
 * @param members - Parsed member definitions.
 * @returns The validated definitions.
 * @throws When identifiers repeat or a model route is incomplete.
 */
export const validateMembers = (members: TeamMember[]): TeamMember[] => {
  const ids = new Set<string>()
  for (const member of members) {
    if (ids.has(member.id)) throw new Error(`Duplicate team member id: ${member.id}`)
    if (member.id === 'lead') throw new Error('The team member id lead is reserved')
    if (!member.name.trim() || !member.instructions.trim()) throw new Error('Team member name and instructions are required')
    if (Boolean(member.provider) !== Boolean(member.model)) throw new Error('A team member model requires both provider and model')
    ids.add(member.id)
    if (member.capabilities) validateCapabilities(member.capabilities)
  }
  return members
}

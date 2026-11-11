/** User-configured teammates over the existing subagent runtime and shared task board. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-llm'
import { MEMBER_ID_PATTERN } from './types.ts'
import type { TeamSettings } from './types.ts'
import { capabilitiesSchema } from './capabilities.ts'
import { createMemberRuntime } from './member-runtime.ts'
import { installDatabaseCatalog } from './database-catalog.ts'

/** Cordis entry identity and settings namespace. */
export const name = 'xlx-agent-team'
/** Existing services own child execution, task persistence, and model resolution. */
export const inject = ['tools', 'systemPrompt', 'subagents', 'agentTeams', 'llm', 'storageDomain']

/** Fields are sampled when preparing a step and again before starting a child. */
export interface Config {
  /** Global availability of configured members. */
  enabled: Volatile<boolean>
  /** Validated user-owned roster. */
  members: Volatile<TeamSettings['members']>
}

const memberSchema = z.intersect([
  z.object({
    name: z.string().pattern(/\S/).required(),
    instructions: z.string().pattern(/\S/).required(),
    enabled: z.boolean().default(true),
    capabilities: capabilitiesSchema,
  }),
  z.union([
    z.object({ provider: z.const('').default(''), model: z.const('').default('') }),
    z.object({ provider: z.string().pattern(/^\S+$/).required(), model: z.string().pattern(/^\S+$/).required() }),
  ]),
])

/** Configuration validation applies to profile files and settings writes. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  members: z.dict(memberSchema, z.string().pattern(MEMBER_ID_PATTERN)).default({}).volatile(),
})

/**
 * Register root-only teammate discovery and delegation with lifecycle-owned effects.
 * @param ctx - Plugin context whose services own admitted child activations.
 * @param config - Live validated profile configuration.
 * @returns After admission storage and root tools are ready.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const admit = await createMemberRuntime(ctx)
  installDatabaseCatalog(ctx, () => config.members.get())
  const members = () => Object.entries(config.members.get()).map(([id, member]) => ({ id, ...member })).filter(member => member.enabled)
  const available = (agent: Parameters<typeof ctx.subagents.rootOf>[0]) =>
    config.enabled.get() && ctx.subagents.rootOf(agent) === agent && members().length > 0

  const roster = defineTool({
    name: 'team_members',
    description: 'List the configured teammates, their responsibilities, and their model routes before assigning work.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          members: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                instructions: { type: 'string', required: true },
                provider: { type: 'string', required: true },
                model: { type: 'string', required: true },
                capabilities: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    execute: async (_args, exec) => {
      exec.signal.throwIfAborted()
      if (!exec.agent || !available(exec.agent)) throw new Error('The configured team is unavailable for this agent')
      return { members: members().map(({ id, name: memberName, instructions, provider, model, capabilities }) => ({ id, name: memberName, instructions, provider, model, capabilities: JSON.stringify({
        skills: capabilities?.skills.filter(item => item.enabled).map(({ name, description }) => ({ name, description })) ?? [],
        mcp: capabilities?.mcp.filter(item => item.enabled).map(({ name }) => name) ?? [],
        databases: capabilities?.databases.filter(item => item.enabled).map(({ id, name }) => ({ id, name })) ?? [],
      }) })) }
    },
  })

  const delegate = defineTool({
    name: 'team_delegate',
    description: 'Assign a self-contained task to a configured teammate. Its saved responsibilities and model are applied automatically. Returns immediately with a subagent name. Completion is delivered to you. Use send_message for follow-up work and list_agents to find existing members.',
    parameters: {
      member: { type: 'string', required: true, description: 'Member id returned by team_members.' },
      description: { type: 'string', required: true, description: 'Short task description in the user’s language.' },
      prompt: { type: 'string', required: true, description: 'Complete task, context, expected result, and any file ownership limits.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'activation' },
          name: { type: 'string', required: true },
          member: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Started teammate ${value.member} as ${value.name}` }],
      presentationMeta: (_args, value) => ({ kind: value.kind, name: value.name }),
    },
    execute: async (args, exec) => {
      const parent = exec.agent
      if (!parent || !available(parent)) throw new Error('The configured team is unavailable for this agent')
      const member = members().find(candidate => candidate.id === args.member)
      if (!member) throw new Error('This teammate is unavailable. Read team_members again before delegating.')
      if (!args.prompt.trim() || !args.description.trim()) throw new Error('The teammate task and description are required')
      const provider = ctx.subagents.getProvider('spawn')
      if (!provider?.prepareContinuable) throw new Error('The spawn subagent provider must be enabled to use the configured team')
      const agentOptions = member.provider
        ? { provider: member.provider, model: member.model, reasoningEffort: undefined }
        : undefined
      const parentOptions = parentAgentOptionsForDelegation(parent)
      const selectedProvider = agentOptions?.provider ?? parentOptions.provider
      const selectedModel = agentOptions?.model ?? parentOptions.model
      if (!selectedProvider || !selectedModel) throw new Error('Choose a model for the lead or this teammate before delegating')
      await ctx.llm.resolveCallConfig({
        provider: selectedProvider, model: selectedModel,
        ...!agentOptions && parentOptions.reasoningEffort ? { reasoningEffort: parentOptions.reasoningEffort } : {},
      }, exec.signal)
      const requireCurrentMember = () => {
        exec.signal.throwIfAborted()
        if (!available(parent) || !members().some(candidate => candidate.id === member.id && JSON.stringify(candidate) === JSON.stringify(member))) {
          throw new Error('The teammate configuration changed. Read team_members and retry the delegation.')
        }
      }
      requireCurrentMember()
      await ctx.agentTeams.setEnabled(parent, true, exec.signal)
      requireCurrentMember()
      const maxDepth = ctx.subagents.resolveMaxDepth()
      const childId = await admit(member.capabilities ?? { mcp: [], skills: [], databases: [] })
      requireCurrentMember()
      const activation = await ctx.subagents.startActivation({
        provider: 'spawn', parent, childId, label: `${member.name} · ${args.description}`,
        prompt: [{ type: 'text', text: `Team member: ${member.name}\n\nResponsibilities:\n${member.instructions}\n\nAssigned task:\n${args.prompt}` }],
        ...agentOptions ? { agentOptions } : {},
        ...maxDepth === undefined ? {} : { maxDepth },
        signal: exec.signal, delivery: 'parent',
      })
      return { kind: 'activation' as const, name: activation.name, member: member.id }
    },
  })

  ctx.effect(() => ctx.tools.register(roster, { when: ({ agent }) => available(agent) }), 'xlx-agent-team: member discovery')
  ctx.effect(() => ctx.tools.register(delegate, { when: ({ agent }) => available(agent) }), 'xlx-agent-team: delegation')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'xlx-agent-team',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
    text: ({ agent, scope, toolSet }) => {
      if (!agent || !available(agent) || ctx.tools.get('team_delegate', scope, toolSet) !== delegate) return ''
      return 'A user-configured agent team is available. Read team_members to learn the members and their responsibilities. As lead, divide suitable work and use team_delegate to assign tasks to those members. Include the necessary context and disjoint file scopes. Use send_message to continue an existing teammate, list_agents to inspect members, and the shared team task tools to track dependencies. Continue your own useful work while members run. When only their results remain, end the turn and let completion notifications resume you. Review and integrate every required result before giving the final answer.'
    },
  }), 'xlx-agent-team: lead guidance')
}

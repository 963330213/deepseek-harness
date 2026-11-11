/** Explicit Remote grants; new endpoints remain denied until reviewed. */
const globalActions = [
  'session/list', 'session/search', 'session/create', 'session/modelCatalog',
  'workspace/follow', 'settings/describe', 'permissionPresets/catalog',
  'agentPresets/list', 'agentPresets/read', 'llm/listModels', 'web/listProviders',
]
const sessionActions = [
  'session/list', 'session/search', 'workspace/follow',
  'session/create', 'session/follow', 'session/history', 'session/prompt',
  'session/cancel', 'session/rename', 'session/fork',
  'session/updateQueue', 'session/state', 'session/skillCatalog',
  'session/page', 'session/events', 'session/projections', 'session/observeEvent',
  'session/observeProjections', 'session/observeState', 'session/wait',
  'workspace/insertSessionBefore',
  'event:api-session/added', 'event:api-session/removed', 'event:api-session/status',
  'event:api-session/error', 'event:api-session/activity',
]
const workspaceActions = ['session/create', 'workspace/list', 'workspace/follow', 'workspace/rename', 'workspace/insertSessionBefore']

/** Build resource-specific grants from durable ownership.
 * @param {object} store Authorization database operations.
 * @param {object} user Current enabled account.
 * @returns {object[]} Native Remote access bindings.
 */
export function accountBindings(store, user) {
  const workspace = store.workspace(user.id)
  const sessionIds = store.sessions(user.id)
  const ownSessions = new Set(sessionIds)
  const condition = ({ action, args }) => {
    // Raw attachments use the shared Host store; ordinary accounts currently send text only.
    if ((action === 'session/prompt' || action === 'session/updateQueue') && args !== undefined) {
      const content = action === 'session/prompt' ? args.request?.content : args.request?.action?.content
      if (content?.some(part => part.type !== 'text')) return { kind: 'deny', reason: 'account-text-only' }
    }
    if (action === 'session/create' && args !== undefined) {
      const request = args.request
      if (!request || !workspace || request.workspaceId !== workspace.id
        || request.cwd !== undefined || (request.sessionId !== undefined && !ownSessions.has(request.sessionId))) {
        return { kind: 'deny', reason: 'account-workspace-required' }
      }
    }
    return { kind: 'allow' }
  }
  const binding = (kind, id, actions) => ({
    resource: kind === 'global' ? { kind } : { kind, id },
    role: { name: 'account', resource: kind, actions }, condition,
  })
  return [
    binding('global', undefined, globalActions),
    ...(workspace ? [binding('workspace', workspace.id, workspaceActions)] : []),
    ...sessionIds.map(id => binding('session', id, sessionActions)),
  ]
}

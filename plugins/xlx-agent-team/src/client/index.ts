/** Team configuration page registered beside the built-in Subagent page. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { TeamPage } from './page.tsx'
import { TeamPanel, TeamPanelIcon } from './panel.tsx'
import { ResourcesPanel, SkillsPanelIcon } from './resources-panel.tsx'
import { createTeamPage } from './controller.ts'
import { en, zh, type TeamLocaleKey } from './locales.ts'
import type { TeamSettings } from '../types.ts'
import { catalogRemote } from '../database-catalog-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Team member settings copy. */
    'settings.xlxAgentTeam': TeamLocaleKey
  }
}

/** Required browser services. */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session', 'remote.mcpManager']

/** Sidebar selection and its main-panel registration share this identity. */
const PANEL_ID = 'xlx-agent-team' as MainPanelId
const RESOURCES_PANEL_ID = 'xlx-team-skills' as MainPanelId

/**
 * Register the page only while its Host configuration is available to this user.
 * @param ctx - Browser plugin context.
 */
const registerPage = (ctx: Context): void => {
  ctx.effect(() => ctx.locale.register('settings.xlxAgentTeam', { zh, en }), 'xlx-agent-team: dictionaries')
  const page = createTeamPage(ctx, ctx.configForms.get<TeamSettings>('xlx-agent-team'))
  ctx.effect(() => () => page.dispose(), 'xlx-agent-team: settings state')
  ctx.effect(() => ctx.configForms.whileServed(['xlx-agent-team'], () => {
    page.face.refreshModels()
    return ctx.slots.inject('main', function* () {
      yield ctx.slots.register({
        name: 'main', key: PANEL_ID,
        locale: 'settings.xlxAgentTeam', inject: () => page.face,
      }, TeamPanel)
      yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: PANEL_ID, order: 5,
        label: () => ctx.locale.bind('settings.xlxAgentTeam')('title'),
        locale: 'settings.xlxAgentTeam',
      }, TeamPanelIcon))
      yield ctx.slots.register({
        name: 'main', key: RESOURCES_PANEL_ID, locale: 'settings.xlxAgentTeam', inject: () => page.face,
      }, ResourcesPanel)
      yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: RESOURCES_PANEL_ID, order: 7,
        label: () => ctx.locale.bind('settings.xlxAgentTeam')('resourcesPanel'), locale: 'settings.xlxAgentTeam',
      }, SkillsPanelIcon))
      yield ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item', id: 'xlx-agent-team', order: 11,
        label: () => ctx.locale.bind('settings.xlxAgentTeam')('title'),
        locale: 'settings.xlxAgentTeam', inject: () => page.face,
      }, TeamPage))
    })
  }), 'xlx-agent-team: settings page')
  ctx.on('connection/reset', () => page.face.refreshModels())
  ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => page.face.refreshModels()), 'xlx-agent-team: model directory')
}

/**
 * Mount the private metadata Remote before exposing the settings page.
 * @param ctx - Browser plugin context.
 * @returns After the settings page is registered.
 */
export const apply = async (ctx: Context): Promise<void> => {
  await ctx.remote.$mount(catalogRemote)
  await ctx.inject(['remote.xlxTeamCatalog'], registerPage)
}

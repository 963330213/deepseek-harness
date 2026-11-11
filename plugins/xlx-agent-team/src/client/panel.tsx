/** Sidebar navigation and a full-page host for the shared team editor. */
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TeamPageFace } from './controller.ts'
import { TeamPage } from './page.tsx'
import css from './page.module.css'

/**
 * Render the shared people icon at the sidebar's requested size.
 * @param props - Sidebar-owned icon dimensions and selection state.
 * @returns The non-interactive team glyph.
 */
export const TeamPanelIcon = ({ size }: PropsRuntime<'sidebar.panellist'>) => <IconUsersOutlineRegular size={size} />

/**
 * Open the same revision-aware editor independently of the Plugins page.
 * @param props - Framework-bound locale, roster state and actions.
 * @returns The team's scrollable main panel.
 */
export const TeamPanel = (props: PropsRuntime<'main'> & PropsLocale<'settings.xlxAgentTeam'> & InjectFace<TeamPageFace>) => <section className={css.panel}>
  <div className={css.panelContent}>
    <header className={css.panelHeader}>
      <h1>{props.t('title')}</h1>
      <p>{props.t('description')}</p>
    </header>
    <TeamPage {...props} view="page" />
  </div>
</section>

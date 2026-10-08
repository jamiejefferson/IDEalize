/**
 * The project half of the chat title: "in Casa Madrigal" after the chat's
 * name (JJ, 7 Oct 2026, after typing prompts into the wrong chat). Seated on
 * `conversation.session.header.context`; the title's own typography reaches
 * both runs through `data-session-title-part`, and the project is drawn a
 * step smaller than the chat's name, with "in" quieter still. A chat that
 * belongs to no project (Powell's, run from the home folder) says nothing.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ProjectContext.module.css'

export type ProjectContextProps = PropsRuntime<'conversation.session.header.context'>
  & PropsLocale<'idealize-bar'>

export function ProjectContext({ sessionId, useWorkspaces, t }: ProjectContextProps) {
  const project = useWorkspaces(state => state.items.find(item => item.sessionIds.includes(sessionId))?.title)
  if (project === undefined) return null
  return (
    <>
      <span className={css.joiner} data-session-title-part="joiner">{t('title.in')}</span>
      {' '}
      <span className={css.project} data-session-title-part="name">{project}</span>
    </>
  )
}

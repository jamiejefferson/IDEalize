/**
 * The shipped occupant of `conversation.hero.launcher`: the project row and
 * the recent-project cards as the shell hands them, nothing else. A
 * composition that wants a different welcome card shadows this seat with a
 * lower-priority registration.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Shipped launcher props: the owner share only. */
export type HeroLauncherDefaultProps = PropsRuntime<'conversation.hero.launcher'>

/**
 * Render the project row over the recent-project cards.
 * @param props - the owner share.
 * @returns the two rows.
 */
export function HeroLauncherDefault({ projectRow, recentProjects }: HeroLauncherDefaultProps) {
  return (
    <>
      {projectRow}
      {recentProjects}
    </>
  )
}

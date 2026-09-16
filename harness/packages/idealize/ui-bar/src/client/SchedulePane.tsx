/**
 * The Schedule drawer pane: `@idealize/ui-schedule`'s Week calendar, re-hosted
 * beside the conversation instead of inside the view ring. The calendar's
 * plugin publishes the component and its wired face as the `scheduleSection`
 * service (FORK.md), because the client bundle purity gate forbids importing
 * another plugin's value exports.
 *
 * The calendar is one calendar whichever chat it sits beside, so the pane
 * takes no session and remounts nothing on a chat switch; the plugin's own
 * store carries the navigated week and an open editor across the drawer's
 * unmounts.
 * @module @idealize/ui-bar/client/SchedulePane
 */
// Type-only: the calendar service's component and face types.
import type { ScheduleSectionHost } from '@idealize/ui-schedule/client'
import css from './SchedulePane.module.css'

/** The calendar plugin's section service as the drawer consumes it (index.ts binds it once). */
export interface ScheduleHost {
  /** The calendar component. */
  Component: ScheduleSectionHost['Component']
  /**
   * Wire the calendar.
   * @returns the wired face.
   */
  face: () => ReturnType<ScheduleSectionHost['face']>
}

export interface SchedulePaneProps {
  /** The re-hosted calendar. */
  host: ScheduleHost
}

/**
 * Render the calendar in the drawer.
 * @param props - the host.
 * @returns the calendar's element tree.
 */
export function SchedulePane({ host }: SchedulePaneProps) {
  const Calendar = host.Component
  return (
    <div className={css.root} data-schedule-pane="">
      <Calendar {...host.face()} />
    </div>
  )
}

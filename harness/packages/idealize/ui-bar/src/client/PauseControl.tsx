/**
 * Pause all agents, at the bottom of the sidebar (feedback 495cec0a; JJ,
 * 30 Oct 2026: "sidebar, at the bottom"). Running, the row is the Pause
 * button. Pressed, each working agent writes where it got to and stops, and
 * the row counts the agents still writing, with Stop now to cut the wait.
 * Paused, the row says so with Resume; it still says so after a restart,
 * because the host keeps the pause. Collapsed, the sidebar shows the same
 * control as one round button.
 * @module @idealize/ui-bar/client/PauseControl
 */
import { useEffect } from 'react'
import { IconPauseOutline16, IconPlayOutline16, IconStopFill16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-sidebar SlotMap merge that declares the foot seat.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PauseAction, PauseState } from './pause-store.ts'
import css from './PauseControl.module.css'

/** Glyph size, matching the sidebar foot's 16px icons. */
const ICON = 16

/** Registration-side face. */
export interface PauseControlInjected {
  /** Selector hook over the window's pause store. */
  usePause: <T>(selector: (state: PauseState) => T) => T
  /** Press one of the control's buttons. */
  press: (action: PauseAction) => Promise<void>
  /** Follow the host's pause while the control is mounted. */
  follow: () => () => void
}

export type PauseControlProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<PauseControlInjected>

/**
 * Render the control.
 * @param props - the foot seat's column state, the bar's locale seat and the wired face.
 * @returns the control, or null until the host has answered.
 */
export function PauseControl({ wide, usePause, press, follow, t }: PauseControlProps) {
  useEffect(() => follow(), [follow])
  const pause = usePause(state => state.pause)
  const busy = usePause(state => state.busy)
  const error = usePause(state => state.error)
  if (pause === null) return null

  const saving = pause.saving === 1 ? t('pause.saving.one') : t('pause.saving.other', { count: String(pause.saving) })
  const pressing = (action: PauseAction) => () => { void press(action) }

  if (!wide) {
    const [label, action, glyph] = pause.phase === 'running'
      ? [t('pause.pause'), 'pause', <IconPauseOutline16 size={ICON} />] as const
      : pause.phase === 'saving'
        ? [`${t('pause.stop')} · ${saving}`, 'stop', <IconStopFill16 size={ICON} />] as const
        : [t('pause.resumeAll'), 'resume', <IconPlayOutline16 size={ICON} />] as const
    return (
      <Tooltip label={label} delayMs={500}>
        <button type="button" className={css.rail} aria-label={label} data-pause-phase={pause.phase} disabled={busy} onClick={pressing(action)}>
          {glyph}
        </button>
      </Tooltip>
    )
  }

  const failure = error === null ? null : <p className={css.error} role="alert">{t('pause.failed', { error })}</p>

  if (pause.phase === 'running') {
    return (
      <div data-pause-phase="running">
        <button type="button" className={css.press} disabled={busy} onClick={pressing('pause')}>
          <span className={css.icon}><IconPauseOutline16 size={ICON} /></span>
          <span className={css.label}>{t('pause.pause')}</span>
        </button>
        {failure}
      </div>
    )
  }

  return (
    <div data-pause-phase={pause.phase}>
      <div className={pause.phase === 'saving' ? `${css.row} ${css.saving}` : css.row} role="status">
        <span className={css.label}>{pause.phase === 'saving' ? saving : t('pause.paused')}</span>
        {pause.phase === 'saving'
          ? <button type="button" className={css.action} disabled={busy} onClick={pressing('stop')}>{t('pause.stop')}</button>
          : <button type="button" className={css.resume} disabled={busy} onClick={pressing('resume')}>{t('pause.resume')}</button>}
      </div>
      {failure}
    </div>
  )
}

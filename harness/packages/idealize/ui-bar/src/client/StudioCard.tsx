/**
 * The pinned Studio card at the top of the sidebar, above every project. It
 * reads as one more chat row (JJ, 8 Sep 2026: "it should have the same look
 * as other chats but with a subtle rule between it and the projects"): the
 * rows' measurements and fills, a hairline under its own wrapper, no toggle
 * and no dismiss because the Studio is open at all times. The Studio spans
 * every project ("the studio is for all projects"), so the card's second line
 * says whether the Telegram remote is connected (JJ, 15 Sep 2026: "a status
 * line for 'Telegram - Connected' or 'Telegram - Not Connected'"), and the
 * card shows whether the Studio host answers, how many events the person
 * has not read and how many tasks across every project hold unresolved
 * attention, and opens the one Studio chat. The two counts are separate
 * records and read as separate marks: reading the Studio clears the unread
 * count and resolves nothing (FR-P0-19).
 *
 * The card polls the shared Studio store while mounted, so the dot and the
 * count stay live whether or not the Studio view is on screen.
 * @module @idealize/ui-bar/client/StudioCard
 */
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-workspace SlotMap merge that declares the pinned seat.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the Studio store's state.
import type { StudioViewState } from '@idealize/ui-studio/client'
import { SpaceIcon } from './SpaceIcon.tsx'
import css from './StudioCard.module.css'

/** Poll cadence; the Studio view uses the same. */
const POLL_MS = 3000

/** Registration-side face. */
export interface StudioCardInjected {
  /** Selector hook over the shared Studio store. */
  useStudio: <T>(selector: (state: StudioViewState) => T) => T
  /** Selector hook over the Telegram remote's standing: connected once a token is stored, a chat paired and nothing is wrong. */
  useTelegram: <T>(selector: (state: { connected: boolean }) => T) => T
  /** Selector hook over whether the Studio chat is the current chat and whether any project exists to hold it. */
  useTarget: <T>(selector: (state: { current: boolean; available: boolean }) => T) => T
  /** Read the overview (see the Studio store) and the Telegram remote's status. */
  sync: () => Promise<void>
  /** Open the Studio chat, minting it the first time. */
  open: () => Promise<void>
}

export type StudioCardProps =
  PropsRuntime<'sidebar.workspaces.pinned'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<StudioCardInjected>

/**
 * Render the card.
 * @param props - the pinned seat's props, the bar's locale seat and the wired face.
 * @returns the card, or null while no project is listed.
 */
export function StudioCard({ useStudio, useTelegram, useTarget, sync, open, t }: StudioCardProps) {
  const available = useTarget(state => state.available)
  const current = useTarget(state => state.current)
  const telegram = useTelegram(state => state.connected)
  const reachable = useStudio(state => state.loaded && state.error === null)
  const attention = useStudio(state => (
    state.projects.reduce((sum, project) => sum + project.state.tasks.filter(task => task.attention !== 'none').length, 0)
  ))
  const unread = useStudio(state => (
    state.projects.reduce((sum, project) => sum + Math.max(0, project.lastSeq - (state.read[project.project] ?? 0)), 0)
  ))

  useEffect(() => {
    if (!available) return
    const tick = (): void => { void sync() }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => { clearInterval(timer) }
  }, [sync, available])

  if (!available) return null
  return (
    <div className={css.wrap} data-studio-card-wrap="">
      <button
        type="button"
        className={css.card}
        data-studio-card=""
        data-current={current ? '' : undefined}
        aria-current={current ? 'page' : undefined}
        aria-label={t('studio.card.open')}
        onClick={() => { void open() }}
      >
        <span className={css.glyph} aria-hidden="true"><SpaceIcon space="studio" size={18} /></span>
        <span className={css.text}>
          <span className={css.title}>{t('studio.card.title')}</span>
          <span className={css.subtitle} data-studio-card-telegram={telegram ? 'connected' : 'disconnected'}>
            {t(telegram ? 'studio.card.telegram.connected' : 'studio.card.telegram.disconnected')}
          </span>
        </span>
        {unread > 0 && (
          <span className={css.unread} data-studio-card-unread={unread} title={t('studio.card.unread', { count: unread })}>{unread}</span>
        )}
        {attention > 0 && (
          <span className={css.attention} data-studio-card-attention={attention}>{attention}</span>
        )}
        <span
          className={css.dot}
          data-studio-card-presence={reachable ? 'reachable' : 'unreachable'}
          title={reachable ? t('studio.card.reachable') : t('studio.card.unreachable')}
        />
      </button>
    </div>
  )
}

/**
 * The plan-mode icon on the composer's tool row (Paper 18M-0: "need a plan
 * mode icon"). A 28px control in the dock's icon treatment beside the "+"
 * button; pressed while the session's effective plan target is on. Clicking
 * runs `/plan` or `/plan off` through the command channel, so the host's
 * plan-mode plugin stays the single owner of the state and the projection
 * drives the pressed look. Shadows ui-plan's text chip on the same seat.
 *
 * Plan mode belongs to the working chats: the icon renders while the ring's
 * active view is Chat or Terminal (or none yet) and stands down on the
 * generating spaces, where the brain has no tools a plan would sequence (JJ,
 * 8 Sep 2026: "plan mode only relevant in chat and terminal"). The tooltip
 * states the mode first and the click's effect second, since a pressed icon
 * captioned with the action alone read as the opposite state.
 */
import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the input.plan seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the `plan` projection key merge for useProjection.
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import css from './PlanToggle.module.css'

/** Registration-side face: the command verb. */
export interface PlanToggleInjected {
  /**
   * Enter or leave plan mode by command.
   * @param on - the target mode.
   * @returns null on admitted execution; a failure line otherwise.
   */
  setPlanMode: (on: boolean) => Promise<string | null>
}

export type PlanToggleProps =
  PropsRuntime<'conversation.input.plan'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<PlanToggleInjected>
  & {
    /** Selector hook over ui-conversation's chat store, whose `view` is the ring's active view id. */
    useStore: <T>(selector: (state: { view: string | null }) => T) => T
  }

/** The ring views the plan icon serves; a chat with no view chosen yet counts as Chat. */
export const PLAN_VIEWS: readonly string[] = ['chat', 'terminal']

/**
 * Render the plan-mode icon button.
 * @param props - composed slot props.
 * @returns the button, or null while the session has no plan capability or the ring sits on a generating space.
 */
export function PlanToggle({ useProjection, useStore, locked, setPlanMode, t }: PlanToggleProps) {
  const plan = useProjection('plan')
  const view = useStore(state => state.view)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  if (plan === undefined || (view !== null && !PLAN_VIEWS.includes(view))) return null
  const target = plan.pending ? !plan.active : plan.active

  const toggle = (): void => {
    setBusy(true)
    setError(null)
    void setPlanMode(!target).then((failure) => {
      if (!alive.current) return
      setBusy(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!alive.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const label = target ? t('plan.state.on') : t('plan.state.off')
  return (
    <span className={css.wrap}>
      <Tooltip label={label} side="top" delayMs={500}>
        <button
          type="button"
          className={css.button}
          aria-label={label}
          aria-pressed={target}
          data-plan-toggle=""
          disabled={locked || busy}
          onClick={toggle}
        >
          {/* Three ticked steps. The earlier glyph was a bordered page of
              ruled lines, which reads as a document and sat next to a
              document-shaped session-log button (JJ, 11 Sep 2026: "change
              plan mode icon so it looks like 'a plan'"). A checklist names
              the thing plan mode produces: ordered steps to work through. */}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M1.6 3.3l1 1 1.9-2M1.6 7.2l1 1 1.9-2M1.6 11.1l1 1 1.9-2M6.8 3.4h5.6M6.8 7.3h5.6M6.8 11.2h3.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Tooltip>
      {/* Failure copy stays English (error-surface policy: not localised). */}
      {error !== null && <span className={css.error} role="status" title={error}>plan mode failed</span>}
    </span>
  )
}

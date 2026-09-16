/**
 * V0's return-to-send toggle, resident in the composer's control strip: a
 * return-arrow glyph that gains a strike-through while plain Return inserts a
 * newline instead of sending. One click flips the same persisted preference
 * the General Settings row edits.
 */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ReturnToggle.module.css'

/** Registration-side preference face. */
export interface ReturnToggleInjected {
  hooks: {
    /** Persisted Enter-to-send preference bound as useEnterToSend. */
    enterToSend: SnapshotStore<boolean>
  }
  /** Change whether plain Enter submits. */
  setEnterToSend: (enabled: boolean) => void
}

/** Composer-strip toggle props over the preference face. */
export type ReturnToggleProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<'conversation'>
  & InjectFace<ReturnToggleInjected>

/**
 * Render the return-to-send toggle.
 * @param props - composed input.right slot props.
 * @returns the toggle button.
 */
export function ReturnToggle({ useEnterToSend, setEnterToSend, t }: ReturnToggleProps) {
  const enterToSend = useEnterToSend(value => value)
  const label = t(enterToSend ? 'input.return.sends' : 'input.return.newline')
  return (
    <Tooltip label={label} side="top" delayMs={400}>
      <button
        type="button"
        className={css.toggle}
        aria-label={label}
        aria-pressed={enterToSend}
        onClick={() => { setEnterToSend(!enterToSend) }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13 3v5a2 2 0 0 1-2 2H4.5M7 7l-3 3 3 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {!enterToSend && <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
        </svg>
      </button>
    </Tooltip>
  )
}

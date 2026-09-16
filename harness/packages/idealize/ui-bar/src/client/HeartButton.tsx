/**
 * The composer heart: V0's one-tap thank-you, rebuilt on the
 * conversation.input.right seat. With an empty draft it submits the
 * thank-you message as an ordinary turn; while a draft is being written it
 * stands down (disabled) so it can never clobber typed text.
 */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './HeartButton.module.css'

export type HeartButtonProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<'idealize-bar'>

export function HeartButton({ input, inputActions, t }: HeartButtonProps) {
  const idle = input.phase === 'plain' && input.draft.trim() === ''
  const send = (): void => {
    if (!idle) return
    inputActions.setDraft(t('heart.message'))
    inputActions.submit()
  }
  return (
    <Tooltip label={t('heart.label')} delayMs={400}>
      <button
        type="button"
        className={css.heart}
        aria-label={t('heart.label')}
        disabled={!idle}
        onClick={send}
      >
        <svg width="15" height="14" viewBox="0 0 24 22" fill="none" aria-hidden="true">
          <path
            d="M12 20.5C10.5 19.2 3 13.6 3 8.4 3 5.4 5.4 3 8.3 3c1.5 0 2.9.7 3.7 1.8C12.8 3.7 14.2 3 15.7 3 18.6 3 21 5.4 21 8.4c0 5.2-7.5 10.8-9 12.1z"
            fill="currentColor"
          />
        </svg>
      </button>
    </Tooltip>
  )
}

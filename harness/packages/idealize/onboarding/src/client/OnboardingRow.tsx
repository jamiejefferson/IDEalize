/** General Settings row re-arming the first-run wizard for the next launch. */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './OnboardingRow.module.css'

/** Registration-side face. */
export interface OnboardingRowInjected {
  /** Reset the onboarding section (`done: false`, `steps: {}`); the wizard re-arms on next launch. */
  rerun: () => void
}

export type OnboardingRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'idealize-onboarding'>
  & InjectFace<OnboardingRowInjected>

export function OnboardingRow({ rerun, t }: OnboardingRowProps) {
  const [armed, setArmed] = useState(false)
  return (
    <div data-onboarding-row className={css.row}>
      <div className={css.text}>
        <div className={css.title}>{t('settings.rerun.title')}</div>
        <div className={css.desc}>{t('settings.rerun.description')}</div>
      </div>
      {armed
        ? <span className={css.armed} data-onboarding-rerun-armed>{t('settings.rerun.armed')}</span>
        : (
          <button
            type="button"
            className={css.action}
            onClick={() => {
              rerun()
              setArmed(true)
            }}
            data-onboarding-rerun
          >
            {t('settings.rerun.action')}
          </button>
        )}
    </div>
  )
}

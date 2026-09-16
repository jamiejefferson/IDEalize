/**
 * The per-step celebration: a full-screen, click-through layer of expanding
 * conic rainbow rings over a soft radial flash, plus the toast line naming the
 * finished step. The motion is pure CSS keyframes (~800ms); the
 * reduced-motion variant swaps the rings for a brief static tint with the
 * same toast. The component owns its own lifetime and reports it through
 * `onDone`.
 */
import { useEffect } from 'react'
import type { OnboardingStepId } from './steps.ts'
import css from './RainbowBurst.module.css'

/** The burst's on-screen lifetime; mirrors the keyframe durations in RainbowBurst.module.css. */
export const BURST_LIFETIME_MS = 800

/** Props for {@link RainbowBurst}. */
export interface RainbowBurstProps {
  /** The completed step (per-step DOM hook). */
  step: OnboardingStepId
  /** The celebration line shown with the burst. */
  label: string
  /** True renders the static tint (no motion) instead of the rings. */
  reduced: boolean
  /** Called once the burst's lifetime ends. */
  onDone: () => void
}

export function RainbowBurst({ step, label, reduced, onDone }: RainbowBurstProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, BURST_LIFETIME_MS)
    return () => { clearTimeout(timer) }
  }, [onDone])
  return (
    <div className={css.burst} data-rainbow-burst data-burst-step={step} data-motion={reduced ? 'reduced' : 'full'}>
      <div className={css.visual} aria-hidden="true">
        {reduced
          ? <div className={css.tint} data-burst-tint />
          : (
            <>
              <div className={css.flash} data-burst-flash />
              <div className={`${css.ring} ${css.ringOne}`} data-burst-ring />
              <div className={`${css.ring} ${css.ringTwo}`} data-burst-ring />
              <div className={`${css.ring} ${css.ringThree}`} data-burst-ring />
            </>
          )}
      </div>
      <p className={css.toast} role="status">{label}</p>
    </div>
  )
}

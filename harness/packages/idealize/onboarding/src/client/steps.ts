/**
 * The wizard's pure step machine: which step a stored seed opens on, how one
 * step's outcome advances the flow, and the skip-all reduction. No React, no
 * services — the flow controller drives it and the unit spec pins it.
 * @module @idealize/onboarding/client/steps
 */

import { ONBOARDING_STEP_IDS } from '../step-ids.ts'
import type { OnboardingStepId, OnboardingStepOutcome } from '../step-ids.ts'

export { ONBOARDING_STEP_IDS } from '../step-ids.ts'
export type { OnboardingStepId, OnboardingStepOutcome } from '../step-ids.ts'

/** The seed fields the gate and the machine read (the host face owns the schema). */
export interface OnboardingSeedLike {
  /** True once the flow completed or was skipped wholesale. */
  done?: boolean
  /** Per-step outcome; a step with no key has not been resolved yet. */
  steps?: Partial<Record<OnboardingStepId, OnboardingStepOutcome>>
}

/**
 * Decide which step the wizard opens on: the first step without a recorded
 * outcome, or null when the flow is done (or every step carries an outcome —
 * a finished flow always pairs its finish resolution with `done`, so a
 * resolved-everything seed renders nothing).
 * @param seed - the resolved `idealize-onboarding` section, or undefined
 * before the section exists.
 * @returns the step to open on.
 */
export function deriveStep(seed: OnboardingSeedLike | undefined): OnboardingStepId | null {
  if (seed?.done === true) return null
  for (const id of ONBOARDING_STEP_IDS) {
    const outcome = seed?.steps?.[id]
    if (outcome !== 'done' && outcome !== 'skipped') return id
  }
  return null
}

/**
 * Record one step's outcome, returning the next seed; the input is not
 * mutated and sibling outcomes are preserved.
 * @param seed - the seed to extend.
 * @param step - the resolved step.
 * @param outcome - how the user resolved it.
 * @returns the next seed.
 */
export function advance(
  seed: OnboardingSeedLike | undefined,
  step: OnboardingStepId,
  outcome: OnboardingStepOutcome,
): OnboardingSeedLike {
  return { ...seed, steps: { ...seed?.steps, [step]: outcome } }
}

/**
 * The skip-all reduction: the whole flow counts as done and per-step outcomes
 * stay as recorded.
 * @param seed - the seed to close.
 * @returns the closed seed.
 */
export function skipAll(seed: OnboardingSeedLike | undefined): OnboardingSeedLike {
  return { ...seed, done: true }
}

/**
 * The step before one step in display order, or null on the first step
 * (Back hides there).
 * @param step - the current step.
 * @returns the previous step id.
 */
export function stepBefore(step: OnboardingStepId): OnboardingStepId | null {
  const index = ONBOARDING_STEP_IDS.indexOf(step)
  return index <= 0 ? null : ONBOARDING_STEP_IDS[index - 1] ?? null
}

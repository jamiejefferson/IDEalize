/**
 * The onboarding wizard's step vocabulary, shared by both faces: the host
 * schema validates stored step keys against it and the browser half's step
 * machine walks it in order. Pure data, so the client program can compile it
 * without the host face's imports.
 * @module @idealize/onboarding/step-ids
 */

/** Every wizard step, in display order. */
export const ONBOARDING_STEP_IDS = ['agents', 'tools', 'projects-folder', 'documentation-folder', 'skills-folder', 'finish'] as const

/** A wizard step id. */
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number]

/** The recorded outcome of one step. */
export type OnboardingStepOutcome = 'done' | 'skipped'

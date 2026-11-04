/**
 * The onboarding wizard's step vocabulary, shared by both faces: the host
 * schema validates stored step keys against it and the browser half's step
 * machine walks it in order. Pure data, so the client program can compile it
 * without the host face's imports.
 * @module @idealize/onboarding/step-ids
 */

/** Every wizard step, in display order. */
export const ONBOARDING_STEP_IDS = ['agents', 'projects-folder', 'documentation-folder', 'skills-folder', 'finish'] as const

/**
 * Steps the wizard no longer walks but a stored section can still name. The
 * models step went on 4 Nov 2026 (Paper "Brains rethink"): the welcome card now
 * starts every brain on a working model. An invalid stored section fails the
 * section's registration, so anyone who passed that step must stay valid.
 */
export const RETIRED_STEP_IDS = ['tools'] as const

/** Every key a stored section may carry. */
export const STORED_STEP_IDS = [...ONBOARDING_STEP_IDS, ...RETIRED_STEP_IDS] as const

/** A wizard step id. */
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number]

/** The recorded outcome of one step. */
export type OnboardingStepOutcome = 'done' | 'skipped'

/**
 * The wizard's flow controller: owns the view store the overlay renders and
 * the durable settings writes behind its actions. Kept free of cordis and
 * React so the overlay spec drives the real controller over a fake scope; the
 * client plugin only binds it to the settings scope and the tour hold.
 * @module @idealize/onboarding/client/flow
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { advance, deriveStep, skipAll, stepBefore } from './steps.ts'
import type { OnboardingSeedLike, OnboardingStepId, OnboardingStepOutcome } from './steps.ts'

/** One live celebration: the rainbow burst over the just-completed step. */
export interface OnboardingCelebration {
  /** The completed step the burst celebrates. */
  step: OnboardingStepId
  /** True on the finish completion: the burst's end closes the flow. */
  final: boolean
  /** Remount key so back-to-back celebrations replay their animation. */
  token: number
}

/** The overlay's store state. */
export interface OnboardingViewState {
  /** The visible step; null closes the wizard. */
  step: OnboardingStepId | null
  /** The live celebration; completions fire one, skips never do. */
  celebration: OnboardingCelebration | null
  /** Unsaved Tools choices retained while a recovery visits the Agents step. */
  toolDrafts: Record<string, string>
}

/**
 * What the flow needs from its surroundings. The plugin closure supplies both:
 * writes go to the `idealize-onboarding` settings scope, and the release ends
 * the tour's first-run hold.
 */
export interface OnboardingFlowDeps {
  /**
   * Persist one field of the durable section. Fire-and-forget: a failed write
   * replays the step next launch, so the flow never blocks on the wire.
   * @param field - the section field to write.
   * @param value - the JSON-shaped value to store.
   */
  persist: (field: 'done' | 'steps' | 'completedAt', value: unknown) => void
  /** Release the tour's first-run hold (idempotent). */
  releaseHold: () => void
}

/** The overlay's action surface plus its view store. */
export interface OnboardingFlow {
  /** The wizard state feeding the overlay. */
  view: SnapshotStore<OnboardingViewState>
  /**
   * Open the flow from the stored seed.
   * @param seed - the resolved section, or undefined before the section exists.
   * @returns false when the seed says the flow is closed (nothing renders).
   */
  open: (seed: OnboardingSeedLike | undefined) => boolean
  /** Mark one step done, fire its burst, and advance. */
  completeStep: (step: OnboardingStepId) => void
  /** Record one step as skipped and advance without a burst. */
  skipStep: (step: OnboardingStepId) => void
  /** Skip the whole flow: persist `done` and close. */
  quitAll: () => void
  /** Return to the previous step without touching recorded outcomes. */
  back: () => void
  /**
   * Retain the Tools choices across step-component lifetimes.
   * @param drafts - packed choices keyed by the six row ids.
   */
  setToolDrafts: (drafts: Record<string, string>) => void
  /** The finish step's completion: persist `done` + `completedAt`, final burst. */
  finish: () => void
  /** The burst's lifetime ended; a final burst closes the flow. */
  celebrationDone: () => void
}

/**
 * Create the wizard's flow controller.
 * @param deps - the settings write and the tour-hold release.
 * @returns the flow the client plugin wires into the overlay's inject face.
 */
export function createOnboardingFlow(deps: OnboardingFlowDeps): OnboardingFlow {
  const view = createSnapshotStore<OnboardingViewState>({ step: null, celebration: null, toolDrafts: {} })
  // Resolved outcomes mirror the durable `steps` field so the session's writes
  // accumulate without re-reading the scope (its snapshot lags the wire).
  let resolved: Partial<Record<OnboardingStepId, OnboardingStepOutcome>> = {}
  let celebrationToken = 0

  const close = (): void => {
    view.update((draft) => { draft.step = null })
    deps.releaseHold()
  }

  const completeStep = (step: OnboardingStepId): void => {
    const seed = advance({ steps: resolved }, step, 'done')
    resolved = { ...seed.steps }
    deps.persist('steps', resolved)
    const next = deriveStep(seed)
    view.update((draft) => {
      draft.celebration = { step, final: next === null, token: ++celebrationToken }
      // The finish completion keeps its step on stage beneath the final
      // burst; every other completion advances immediately.
      if (next !== null) draft.step = next
    })
  }

  return {
    view,

    open(seed) {
      resolved = { ...seed?.steps }
      const step = deriveStep(seed)
      if (step === null) return false
      view.update((draft) => { draft.step = step })
      return true
    },

    completeStep,

    skipStep(step) {
      const seed = advance({ steps: resolved }, step, 'skipped')
      resolved = { ...seed.steps }
      deps.persist('steps', resolved)
      const next = deriveStep(seed)
      if (next === null) {
        // Every step resolved without a finish: close quietly, no burst.
        close()
        return
      }
      view.update((draft) => { draft.step = next })
    },

    quitAll() {
      // The whole flow counts as done; per-step outcomes stay as recorded.
      const seed = skipAll({ steps: resolved })
      if (seed.done === true) deps.persist('done', true)
      close()
    },

    back() {
      view.update((draft) => {
        if (draft.step === null) return
        const previous = stepBefore(draft.step)
        if (previous !== null) draft.step = previous
      })
    },

    setToolDrafts(drafts) {
      view.update((state) => { state.toolDrafts = { ...drafts } })
    },

    finish() {
      completeStep('finish')
      deps.persist('done', true)
      deps.persist('completedAt', new Date().toISOString())
    },

    celebrationDone() {
      const closing = view.getSnapshot().celebration?.final === true
      view.update((draft) => {
        draft.celebration = null
        if (closing) draft.step = null
      })
      if (closing) deps.releaseHold()
    },
  }
}

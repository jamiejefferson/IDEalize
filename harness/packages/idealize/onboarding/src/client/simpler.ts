/**
 * The welcome sheet's controller. Someone whose wizard was already done when
 * the three-part set-up arrived has never seen it, so the sheet shows once:
 * `done` true and `simplerSeen` not yet true. Closing it by either button
 * records `simplerSeen` and releases the tour's first-run hold. Kept free of
 * cordis and React so the sheet's spec drives the real controller.
 * @module @idealize/onboarding/client/simpler
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { OnboardingSeedLike } from './steps.ts'

/** The sheet's store state. */
export interface SimplerSheetState {
  /** Whether the sheet is on screen. */
  open: boolean
}

/** What the sheet needs from its surroundings. */
export interface SimplerSheetDeps {
  /** Record `simplerSeen: true` in the durable section (fire-and-forget; a failed write shows the sheet again next launch). */
  markSeen: () => void
  /** Release the tour's first-run hold (idempotent). */
  releaseHold: () => void
}

/** The sheet's store and actions. */
export interface SimplerSheet {
  /** The state feeding the sheet. */
  view: SnapshotStore<SimplerSheetState>
  /**
   * Show the sheet when the stored seed calls for it.
   * @param seed - the resolved section, or undefined before the section exists.
   * @returns whether the sheet opened.
   */
  open: (seed: OnboardingSeedLike | undefined) => boolean
  /** Close the sheet for good: record it as seen and release the tour hold. */
  close: () => void
}

/**
 * Whether the welcome sheet is due: the wizard is done and the three-part
 * set-up has not been seen.
 * @param seed - the resolved `idealize-onboarding` section.
 * @returns true when the sheet should show.
 */
export function simplerSheetDue(seed: OnboardingSeedLike | undefined): boolean {
  return seed?.done === true && seed.simplerSeen !== true
}

/**
 * Create the welcome sheet's controller.
 * @param deps - the settings write and the tour-hold release.
 * @returns the controller the client plugin wires into the sheet's inject face.
 */
export function createSimplerSheet(deps: SimplerSheetDeps): SimplerSheet {
  const view = createSnapshotStore<SimplerSheetState>({ open: false })
  return {
    view,
    open(seed) {
      if (!simplerSheetDue(seed)) return false
      view.update((draft) => { draft.open = true })
      return true
    },
    close() {
      if (!view.getSnapshot().open) return
      view.update((draft) => { draft.open = false })
      deps.markSeen()
      deps.releaseHold()
    },
  }
}

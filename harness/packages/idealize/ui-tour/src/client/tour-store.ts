import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TourStep } from './tour-script.ts'

/** What the overlay seat shows: the tour run, the shortcuts sheet, or nothing. */
export interface TourViewState {
  /** The snapshotted steps of the run in progress, or null when no tour is up. */
  steps: TourStep[] | null
  /** Index into `steps`. */
  index: number
  /** Whether the ⌘/ sheet is open. */
  sheet: boolean
}

/** The overlay's view state plus its write set; apply-constructed, one per plugin. */
export class TourView {
  /** The snapshot the overlay renders from. */
  readonly store: SnapshotStore<TourViewState> = createSnapshotStore<TourViewState>({ steps: null, index: 0, sheet: false })

  /**
   * Read the current state without subscribing.
   * @returns the current state.
   */
  getSnapshot(): TourViewState {
    return this.store.getSnapshot()
  }

  /**
   * Begin a run over a snapshot of steps; the sheet closes.
   * @param steps - the steps to run (at least the opening card).
   */
  start(steps: TourStep[]): void {
    this.store.update((draft) => {
      draft.steps = steps
      draft.index = 0
      draft.sheet = false
    })
  }

  /** Advance; past the last step the run ends. */
  next(): void {
    this.store.update((draft) => {
      if (draft.steps === null) return
      if (draft.index >= draft.steps.length - 1) draft.steps = null
      else draft.index += 1
    })
  }

  /** Step back (no-op on the first step). */
  back(): void {
    this.store.update((draft) => { if (draft.index > 0) draft.index -= 1 })
  }

  /** End the run. */
  finish(): void {
    this.store.update((draft) => { draft.steps = null })
  }

  /** Open the ⌘/ sheet. */
  openSheet(): void {
    this.store.update((draft) => { draft.sheet = true })
  }

  /** Close the ⌘/ sheet. */
  closeSheet(): void {
    this.store.update((draft) => { draft.sheet = false })
  }

  /** Flip the ⌘/ sheet. */
  toggleSheet(): void {
    this.store.update((draft) => { draft.sheet = !draft.sheet })
  }
}

/**
 * The launch park/play state machine. Parked while any OTHER shell.overlay
 * occupant is actively rendering (first-run onboarding, the tour, the
 * shortcuts sheet), it plays exactly once when the last one clears: the body
 * arming attribute goes on (the injected sheet's and ui-bar's keyframes are
 * gated on it), and after the sequence budget the attribute comes off and the
 * phase settles to 'done', so the animations can never replay on a later
 * re-render. Under prefers-reduced-motion the machine starts settled: no logo
 * layer, no beats, panels render in their final state.
 *
 * "Actively rendering" is read from the DOM, not the slot registry: the tour
 * occupant stays registered from boot and renders null while idle, so entry
 * presence says nothing about visibility. The machine watches the
 * `div[data-slot="shell.overlay"]` container's element children — every child
 * other than this package's own layer root or a crash face is an active
 * occupant — which decouples the machine from any specific overlay package.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Park/play/settled states of one app launch. */
export type LaunchPhase = 'parked' | 'playing' | 'done'

/** The body attribute that arms the panel keyframes while it reads "playing". */
export const LAUNCH_BODY_ATTRIBUTE = 'data-idealize-launch'

/**
 * Attribute on this package's own layer root, excluded from the foreign-occupant
 * count. LaunchOverlay.tsx renders it; the overlay spec pins the pairing.
 */
export const LAUNCH_LAYER_ATTRIBUTE = 'data-idealize-launch-layer'

/** The slot outlet wrapper whose element children are the active overlay occupants. */
const CONTAINER_SELECTOR = 'div[data-slot="shell.overlay"]'

/** A crashed occupant's empty crash face must not park the launch forever. */
const CRASH_FACE_ATTRIBUTE = 'data-slot-error'

/** Beat the parked logo holds after the overlay clears, so the mark reads as a beat, not a flash. */
export const LAUNCH_DWELL_MS = 250

/**
 * From arming to the last panel beat's end (logo fade 350ms + staggered
 * slides; launch-sheet.ts and ui-bar's rail keyframe carry the matching values).
 */
export const LAUNCH_SEQUENCE_MS = 850

/** The machine's observable phase plus its lifecycle. */
export interface LaunchMachine {
  /** Phase store the overlay occupant reads through its injected hook. */
  readonly phases: SnapshotStore<LaunchPhase>
  /** Begin: park until the overlay container clears, or settle instantly under reduced motion. */
  start(): void
  /** Tear down observers, timers, and the body attribute. */
  dispose(): void
}

/** prefers-reduced-motion probe; jsdom has no matchMedia, so the guard doubles as the test seam. */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Create the machine. Observers and timers install on {@link LaunchMachine.start}.
 * @returns the machine behind the overlay occupant and the body arming attribute.
 */
export function createLaunchMachine(): LaunchMachine {
  const phases = createSnapshotStore<LaunchPhase>(reducedMotion() ? 'done' : 'parked')
  let observer: MutationObserver | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const clearWatch = (): void => {
    observer?.disconnect()
    observer = undefined
    clearTimer()
  }

  const finish = (): void => {
    if (stopped) return
    clearWatch()
    document.body.removeAttribute(LAUNCH_BODY_ATTRIBUTE)
    phases.set('done')
  }

  const play = (): void => {
    if (stopped || phases.getSnapshot() !== 'parked') return
    clearWatch()
    phases.set('playing')
    document.body.setAttribute(LAUNCH_BODY_ATTRIBUTE, 'playing')
    timer = setTimeout(finish, LAUNCH_SEQUENCE_MS)
  }

  const cleared = (container: Element): boolean =>
    Array.from(container.children).every(el => el.hasAttribute(LAUNCH_LAYER_ATTRIBUTE) || el.hasAttribute(CRASH_FACE_ATTRIBUTE))

  /** Play after the dwell while the container stays clear; a foreign arrival cancels the pending beat. */
  const armWhenClear = (container: Element): void => {
    if (stopped || phases.getSnapshot() !== 'parked') return
    if (cleared(container)) {
      timer ??= setTimeout(play, LAUNCH_DWELL_MS)
      return
    }
    clearTimer()
  }

  const watch = (): void => {
    if (stopped || phases.getSnapshot() !== 'parked') return
    clearWatch()
    const container = document.querySelector(CONTAINER_SELECTOR)
    if (container === null) {
      // React has not committed the frame yet: watch the document until the
      // overlay container itself appears, then switch to watching it.
      observer = new MutationObserver(watch)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      return
    }
    observer = new MutationObserver(() => { armWhenClear(container) })
    observer.observe(container, { childList: true })
    armWhenClear(container)
  }

  return {
    phases,
    start: watch,
    dispose: () => {
      stopped = true
      clearWatch()
      document.body.removeAttribute(LAUNCH_BODY_ATTRIBUTE)
    },
  }
}

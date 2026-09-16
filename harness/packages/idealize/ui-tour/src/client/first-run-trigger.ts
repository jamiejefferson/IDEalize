/**
 * The automatic first-run start: once the `idealize-tour` settings section is
 * ready and reports no seen tour, the showcase starts after a delay that lets
 * the frame's controls mount. A hold (`ctx.tour.holdFirstRun()`) keeps the
 * trigger quiet while it stands, and a hold taken while the delay is already
 * running disarms it, so the release re-evaluates from the start.
 *
 * The disarm exists because plugin order and settings readiness race: when
 * the settings snapshot is already ready as this plugin applies, the trigger
 * armed before first-run onboarding (which injects `tour`, so applies later)
 * took its hold, and on the packaged build the tour then started beneath the
 * wizard, computed its steps before the first project existed, and kept the
 * opening sequence parked (walked 14 Sep 2026, two boots of five).
 * @module @idealize/ui-tour/client/first-run-trigger
 */

/** The two reads the trigger makes of a settings snapshot. */
export interface FirstRunSettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: { hasSeenTour?: boolean } | undefined
}

/** A readable store the trigger subscribes to (the settings scope and the holds count). */
export interface FirstRunSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** What the trigger is wired to. */
export interface FirstRunTriggerDeps {
  /** The `idealize-tour` settings section. */
  scope: FirstRunSource<FirstRunSettingsSnapshot>
  /** The count of standing first-run holds. */
  holds: FirstRunSource<number>
  /** Start the showcase. */
  start: () => void
  /** Milliseconds between the trigger arming and the start. */
  delayMs: number
}

/**
 * Arm the first-run trigger over its sources.
 * @param deps - the sources, the start and the delay.
 * @returns the disposer, which also cancels a pending start.
 */
export function armFirstRunTrigger(deps: FirstRunTriggerDeps): () => void {
  let armed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = (): void => {
    if (deps.holds.getSnapshot() > 0) {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      armed = false
      return
    }
    const snapshot = deps.scope.getSnapshot()
    if (armed || snapshot.status !== 'ready') return
    armed = true
    if (snapshot.value?.hasSeenTour === true) return
    timer = setTimeout(() => { timer = undefined; deps.start() }, deps.delayMs)
  }
  const offScope = deps.scope.subscribe(check)
  const offHolds = deps.holds.subscribe(check)
  check()
  return () => {
    offScope()
    offHolds()
    if (timer !== undefined) clearTimeout(timer)
  }
}

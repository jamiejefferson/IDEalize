/**
 * Whether a terminal's CLI is working, read from the only signal a shell
 * gives: its output. A harness agent announces itself through `agent/status`,
 * so the bridge knows when it starts and stops. A terminal agent is somebody
 * else's program — Claude Code, Pi — running inside a pty, and it announces
 * nothing. The person reads the shell the same way this does: output means it
 * is doing something, and a stretch of quiet means it has stopped.
 *
 * Two thresholds keep ordinary use out of it. {@link QUIET_MS} of silence ends
 * a run, so a CLI thinking between lines stays one run rather than several.
 * A run shorter than {@link MIN_RUN_MS} is never reported, so typing at a
 * prompt — which echoes, and so is output — raises nothing.
 * @module @idealize/ui-terminal/activity
 */

/** Silence that ends a run. Fixed protocol timing, not a deployment tunable. */
export const QUIET_MS = 1_500

/**
 * The shortest run worth reporting. Echoed keystrokes and a prompt redraw are
 * output too; only a run outlasting this is the CLI working.
 */
export const MIN_RUN_MS = 4_000

/** One terminal's run, while it lasts. */
interface Run {
  /** When output first arrived. */
  startedAt: number
  /** The quiet timer that ends it. */
  timer: ReturnType<typeof setTimeout>
  /** True once the run was reported as started, so it is reported as finished exactly once. */
  announced: boolean
}

/** What a watcher reports, and what it reads the clock and the timer from. */
export interface ActivityOptions {
  /**
   * A terminal started working: its run has outlasted {@link MIN_RUN_MS} and
   * output is still arriving.
   * @param id - the terminal's id.
   */
  onWorking(id: string): void
  /**
   * A terminal stopped working: an announced run has fallen quiet.
   * @param id - the terminal's id.
   * @param ranForMs - how long the run lasted.
   */
  onDone(id: string, ranForMs: number): void
  /** The clock, injectable so a test can drive it. */
  now?: () => number
}

/**
 * Watch terminals for the runs their output describes.
 *
 * The watcher owns no subscription: the caller feeds it what the shell says
 * ({@link TerminalActivity.sawOutput}, {@link TerminalActivity.closed}), which
 * keeps the rule testable without a pty and lets one watcher serve every
 * terminal the shell opens.
 */
export class TerminalActivity {
  readonly #runs = new Map<string, Run>()
  readonly #options: ActivityOptions
  readonly #now: () => number

  /**
   * @param options - what the watcher reports and the clock it reads.
   */
  constructor(options: ActivityOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
  }

  /**
   * The terminals working right now, in no particular order.
   * @returns the ids of the terminals whose runs have been announced.
   */
  working(): string[] {
    return [...this.#runs.entries()].filter(([, run]) => run.announced).map(([id]) => id)
  }

  /**
   * Record that a terminal wrote output.
   * @param id - the terminal's id.
   */
  sawOutput(id: string): void {
    const existing = this.#runs.get(id)
    if (existing !== undefined) {
      clearTimeout(existing.timer)
      // A run that has now outlasted the floor is the CLI working, and says so
      // once — while the output is still arriving, not after it stops.
      if (!existing.announced && this.#now() - existing.startedAt >= MIN_RUN_MS) {
        existing.announced = true
        this.#options.onWorking(id)
      }
      existing.timer = this.#arm(id)
      return
    }
    this.#runs.set(id, { startedAt: this.#now(), timer: this.#arm(id), announced: false })
  }

  /**
   * Forget a terminal that has gone: an exit ends its run without reporting
   * one, because the shell closing is not the CLI finishing a piece of work.
   * @param id - the terminal's id.
   */
  closed(id: string): void {
    const run = this.#runs.get(id)
    if (run === undefined) return
    clearTimeout(run.timer)
    this.#runs.delete(id)
  }

  /** End every run without reporting; the watcher is being disposed. */
  stop(): void {
    for (const run of this.#runs.values()) clearTimeout(run.timer)
    this.#runs.clear()
  }

  /** Arm the quiet timer that ends one terminal's run. */
  #arm(id: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      const run = this.#runs.get(id)
      /* v8 ignore next -- the timer is cleared with the run it belongs to, so it only fires while that run stands. */
      if (run === undefined) return
      this.#runs.delete(id)
      // A run nobody was told about started never finished, so nothing to say.
      if (run.announced) this.#options.onDone(id, this.#now() - run.startedAt)
    }, QUIET_MS)
    // The watcher must never hold the process open on its own account.
    timer.unref()
    return timer
  }
}

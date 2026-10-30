/**
 * Whether a terminal's CLI is working, read from the only signal a shell
 * gives: its output. A harness agent announces itself through `agent/status`,
 * so the bridge knows when it starts and stops. A terminal agent is somebody
 * else's program — Claude Code, Pi — running inside a pty, and it announces
 * nothing. The person reads the shell the same way this does: output means it
 * is doing something, and a stretch of quiet means it has stopped.
 *
 * Three rules keep ordinary use out of it. {@link QUIET_MS} of silence ends
 * a run, so a CLI thinking between lines stays one run rather than several.
 * A run shorter than {@link MIN_RUN_MS} is never reported. And output within
 * {@link ECHO_MS} of the person's keystroke is their typing echoing back, so
 * it never counts towards that floor: typing a long prompt, or moving through
 * a CLI's menu, had raised a done chime at every pause (feedback 1047a635).
 *
 * A CLI that reports its own turns (`turns.ts`) is still watched here for its
 * working state; its done chime comes from its report.
 * @module @idealize/ui-terminal/activity
 */

/** Silence that ends a run. Fixed protocol timing, not a deployment tunable. */
export const QUIET_MS = 1_500

/**
 * The shortest run worth reporting. Echoed keystrokes and a prompt redraw are
 * output too; only a run outlasting this is the CLI working.
 */
export const MIN_RUN_MS = 4_000

/**
 * How long after a keystroke the terminal's output is still the person's: the
 * echo, and the redraw a CLI's prompt or menu makes round the key.
 */
export const ECHO_MS = 500

/** One terminal's run, while it lasts. */
interface Run {
  /** When output first arrived. */
  startedAt: number
  /** When output that was not the person's typing first arrived; the floor is measured from here. */
  workingSince: number | undefined
  /** When output last arrived; the quiet is measured from here. */
  lastOutputAt: number
  /** True when output has arrived since the quiet timer was last armed. */
  outputSinceArmed: boolean
  /** The one quiet timer that ends it, armed once and re-armed only when it fires early. */
  timer: ReturnType<typeof setTimeout>
  /** True once the run was reported as started, so it is reported as finished exactly once. */
  announced: boolean
  /** True when the host interrupted this run, so its end is not the CLI finishing a piece of work. */
  cut: boolean
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
   * @param cut - true when the host interrupted the run ({@link TerminalActivity.interrupted}).
   */
  onDone(id: string, ranForMs: number, cut: boolean): void
  /**
   * A terminal fell quiet after any run, announced or not, so a nudge held
   * back while it was printing can be tried again.
   * @param id - the terminal's id.
   */
  onQuiet?(id: string): void
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
  /** When each terminal last received a keystroke from the person. */
  readonly #typedAt = new Map<string, number>()
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
   * Whether a terminal has printed within the last {@link QUIET_MS}, announced
   * or not: a nudge typed then could land in the middle of a redraw.
   * @param id - the terminal's id.
   * @returns true while a run stands.
   */
  busy(id: string): boolean {
    return this.#runs.has(id)
  }

  /**
   * Record that the person typed into a terminal (a key, a paste, a click the
   * CLI asked to hear), so the output it brings back is known for theirs.
   * @param id - the terminal's id.
   */
  sawInput(id: string): void {
    this.#typedAt.set(id, this.#now())
    // The person has taken over: whatever this run becomes is theirs.
    const run = this.#runs.get(id)
    if (run !== undefined) run.cut = false
  }

  /**
   * Record that the host interrupted a terminal's run, so its end is reported
   * as cut. The mark lives on the run and ends with it; the next run starts
   * unmarked.
   * @param id - the terminal's id.
   */
  interrupted(id: string): void {
    const run = this.#runs.get(id)
    if (run !== undefined) run.cut = true
  }

  /**
   * Record that a terminal wrote output.
   * @param id - the terminal's id.
   */
  sawOutput(id: string): void {
    const now = this.#now()
    // Typed, the output is the person's: it keeps a run standing, so a nudge
    // still waits for the redraw, but it is not the CLI working.
    const typed = now - (this.#typedAt.get(id) ?? -Infinity) < ECHO_MS
    const existing = this.#runs.get(id)
    if (existing !== undefined) {
      // Output is the hot path, so it only notes the time: the standing timer
      // reads it when it fires and waits out whatever quiet is still owed.
      existing.lastOutputAt = now
      existing.outputSinceArmed = true
      if (existing.announced || typed) return
      existing.workingSince ??= now
      // A run that has now outlasted the floor is the CLI working, and says so
      // once — while the output is still arriving, not after it stops.
      if (now - existing.workingSince >= MIN_RUN_MS) {
        existing.announced = true
        this.#options.onWorking(id)
      }
      return
    }
    this.#runs.set(id, {
      startedAt: now,
      workingSince: typed ? undefined : now,
      lastOutputAt: now,
      outputSinceArmed: false,
      timer: this.#arm(id, QUIET_MS),
      announced: false,
      cut: false,
    })
  }

  /**
   * Forget a terminal that has gone: an exit ends its run without reporting
   * one, because the shell closing is not the CLI finishing a piece of work.
   * @param id - the terminal's id.
   */
  closed(id: string): void {
    this.#typedAt.delete(id)
    const run = this.#runs.get(id)
    if (run === undefined) return
    clearTimeout(run.timer)
    this.#runs.delete(id)
  }

  /** End every run without reporting; the watcher is being disposed. */
  stop(): void {
    for (const run of this.#runs.values()) clearTimeout(run.timer)
    this.#runs.clear()
    this.#typedAt.clear()
  }

  /**
   * Arm the quiet timer that ends one terminal's run. Firing after output has
   * arrived, it re-arms for the rest of that output's quiet, so the run ends
   * exactly {@link QUIET_MS} after the last output, as a per-chunk timer would.
   */
  #arm(id: string, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      const run = this.#runs.get(id)
      /* v8 ignore next -- the timer is cleared with the run it belongs to, so it only fires while that run stands. */
      if (run === undefined) return
      const owed = run.lastOutputAt + QUIET_MS - this.#now()
      if (run.outputSinceArmed && owed > 0) {
        run.outputSinceArmed = false
        run.timer = this.#arm(id, owed)
        return
      }
      this.#runs.delete(id)
      // A run nobody was told about started never finished, so nothing to say.
      if (run.announced) this.#options.onDone(id, this.#now() - (run.workingSince ?? run.startedAt), run.cut)
      this.#options.onQuiet?.(id)
    }, ms)
    // The watcher must never hold the process open on its own account.
    timer.unref()
    return timer
  }
}

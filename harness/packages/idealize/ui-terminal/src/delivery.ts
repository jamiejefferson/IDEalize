/**
 * Waiting for a terminal agent to answer one typed line. Pausing every agent
 * (feedback 495cec0a, JJ 30 Oct 2026) types "save your notes, then stop" into
 * each working Terminal chat and has to know when each has done so; the CLI
 * reports nothing, so the answer is read off the same output the activity
 * watcher reads.
 *
 * A line counts as answered once it has been typed and the run it set off has
 * been reported working and then finished. A line whose answer never shows as
 * a run (the agent replied in under the watcher's minimum, or did nothing)
 * counts as answered once {@link ANSWER_START_MS} pass after typing with no
 * run starting. A line dropped before it was typed, or a terminal that closes,
 * ends the wait with its own outcome.
 * @module @idealize/ui-terminal/delivery
 */

/** What became of one delivered line. */
export type TerminalDelivery = 'answered' | 'dropped' | 'gone'

/**
 * How long after typing a run may take to start before the line counts as
 * answered anyway. A CLI that is answering prints within seconds (Claude
 * Code's spinner draws at once); this only ends waits nothing will end.
 */
export const ANSWER_START_MS = 30_000

/** One delivery in flight, as {@link TerminalDeliveries.begin} hands it out. */
export interface DeliveryHandle {
  /** What became of the line. */
  outcome: Promise<TerminalDelivery>
  /** The nudger typed this line. */
  typed: () => void
  /** The nudger dropped this line untyped. */
  dropped: () => void
}

/** One line waiting for its answer. */
interface Waiter {
  settle: (outcome: TerminalDelivery) => void
  typed: boolean
  started: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

/** The waits, one per terminal; a later line replaces the earlier one's wait. */
export class TerminalDeliveries {
  readonly #waiters = new Map<string, Waiter>()

  /**
   * Start waiting for one terminal's next line to be answered. A wait already
   * open on the terminal ends as `dropped`: the nudger holds one line per
   * terminal, so the earlier line will not be typed. The handle's calls act on
   * this wait alone, so the nudger dropping the earlier line cannot end it.
   * @param id - the terminal's id.
   * @returns the wait's outcome and the two calls the nudger makes for this line.
   */
  begin(id: string): DeliveryHandle {
    this.#end(id, 'dropped')
    let settle: (outcome: TerminalDelivery) => void = () => {}
    const outcome = new Promise<TerminalDelivery>((resolve) => { settle = resolve })
    const waiter: Waiter = { settle, typed: false, started: false, timer: undefined }
    this.#waiters.set(id, waiter)
    return {
      outcome,
      typed: () => {
        if (this.#waiters.get(id) !== waiter || waiter.typed) return
        waiter.typed = true
        waiter.timer = setTimeout(() => {
          if (!waiter.started) this.#end(id, 'answered')
        }, ANSWER_START_MS)
        waiter.timer.unref()
      },
      dropped: () => {
        if (this.#waiters.get(id) === waiter) this.#end(id, 'dropped')
      },
    }
  }

  /**
   * The terminal started a run; after typing, that run is the answer.
   * @param id - the terminal's id.
   */
  working(id: string): void {
    const waiter = this.#waiters.get(id)
    if (waiter === undefined || !waiter.typed) return
    waiter.started = true
    clearTimeout(waiter.timer)
  }

  /**
   * The terminal's run finished; after typing, the answer is in.
   * @param id - the terminal's id.
   */
  done(id: string): void {
    const waiter = this.#waiters.get(id)
    if (waiter?.typed === true && waiter.started) this.#end(id, 'answered')
  }

  /**
   * End a terminal's wait without an answer: the line was interrupted.
   * @param id - the terminal's id.
   */
  dropped(id: string): void {
    this.#end(id, 'dropped')
  }

  /**
   * The terminal closed.
   * @param id - the terminal's id.
   */
  closed(id: string): void {
    this.#end(id, 'gone')
  }

  /** Settle one wait and forget it. */
  #end(id: string, outcome: TerminalDelivery): void {
    const waiter = this.#waiters.get(id)
    if (waiter === undefined) return
    this.#waiters.delete(id)
    clearTimeout(waiter.timer)
    waiter.settle(outcome)
  }
}

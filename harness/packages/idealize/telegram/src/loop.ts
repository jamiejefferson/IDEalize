/**
 * Restartable background loops for the poller and the approvals relay: one
 * run at a time, a restart aborts the current run and starts the next once
 * it has unwound, and waits end early when the run is stopped.
 * @module @idealize/telegram/loop
 */

/**
 * Wait, resolving early when the signal aborts.
 * @param ms - how long to wait.
 * @param signal - ends the wait early.
 * @returns once the time has passed or the signal has aborted.
 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Whether the signal has aborted, read when called. A run checks this after
 * every await; reading `signal.aborted` directly would be narrowed to the
 * value seen at the loop condition, which an await can change.
 * @param signal - the run's signal.
 * @returns whether the run was stopped.
 */
export function aborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Runs one background loop at a time. */
export class RestartableLoop {
  private controller: AbortController | undefined
  private running: Promise<void> | undefined

  /** @param body - one run; it must return once its signal aborts. */
  constructor(private readonly body: (signal: AbortSignal) => Promise<void>) {}

  /** Start a run, or stop the current one and start the next once it has unwound. */
  restart(): void {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const previous = this.running ?? Promise.resolve()
    this.running = previous.then(() => this.body(controller.signal))
  }

  /**
   * Stop the current run.
   * @returns once the run has unwound.
   */
  async stop(): Promise<void> {
    this.controller?.abort()
    this.controller = undefined
    await this.running
  }
}

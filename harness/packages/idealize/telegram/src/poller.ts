/**
 * The long-poll loop: hold `getUpdates` open, hand each update to the router
 * in order, advance the offset past it, and back off on failure. Telegram
 * forgets an update once a later poll names an offset past it, so a crash
 * mid-batch re-delivers only what was not yet acknowledged.
 * @module @idealize/telegram/poller
 */

import { TelegramApiError, type BotApi, type TelegramUpdate } from './api.ts'
import { abortableSleep, aborted, RestartableLoop } from './loop.ts'

/** Why the loop is not receiving messages. */
export type PollerProblem =
  /** No bot token is stored; the loop waits for one. */
  | { kind: 'no-token' }
  /** Another client polls this bot; the loop keeps retrying on its backoff without taking the updates. */
  | { kind: 'conflict' }
  /** Telegram refused the token; the loop waits for a new one. */
  | { kind: 'unauthorized'; message: string }
  /** A retryable failure. */
  | { kind: 'failed'; message: string }

/** What the loop needs from its owner. */
export interface PollerOptions {
  /** How long Telegram may hold each poll open, in seconds. */
  holdSeconds: number
  /** Waits between consecutive failures; the last entry repeats. */
  retryDelaysMs: readonly number[]
  /** A client for the current token, resolved before every poll; undefined when no token is stored. */
  bot(): Promise<BotApi | undefined>
  /** Handle one update. A rejection is reported through `onError` and the loop moves past the update. */
  onUpdate(update: TelegramUpdate): Promise<void>
  /** The loop's current problem; undefined once a poll succeeds. */
  onProblem(problem: PollerProblem | undefined): void
  /** An update handler failed. */
  onError(error: unknown): void
  /** Wait, resolving early when the signal aborts (tests replace it). */
  sleep?(ms: number, signal: AbortSignal): Promise<void>
}

/** Runs one polling loop at a time. */
export class Poller {
  private readonly loop = new RestartableLoop(signal => this.run(signal))

  constructor(private readonly options: PollerOptions) {}

  /** Start the loop, or restart it so the next poll uses the current token. */
  restart(): void {
    this.loop.restart()
  }

  /**
   * Stop the loop.
   * @returns once the in-flight poll has unwound.
   */
  async stop(): Promise<void> {
    await this.loop.stop()
  }

  private async run(signal: AbortSignal): Promise<void> {
    const sleep = (ms: number): Promise<void> => this.options.sleep?.(ms, signal) ?? abortableSleep(ms, signal)
    let offset = 0
    let failures = 0
    while (!aborted(signal)) {
      const bot = await this.options.bot()
      if (aborted(signal)) return
      if (bot === undefined) {
        this.options.onProblem({ kind: 'no-token' })
        return
      }
      let updates: TelegramUpdate[]
      try {
        updates = await bot.getUpdates(offset, this.options.holdSeconds, signal)
      } catch (error) {
        if (aborted(signal)) return
        const known = error instanceof TelegramApiError ? error : new TelegramApiError('failed', String(error))
        if (known.kind === 'unauthorized') {
          this.options.onProblem({ kind: 'unauthorized', message: known.message })
          return
        }
        this.options.onProblem(known.kind === 'conflict' ? { kind: 'conflict' } : { kind: 'failed', message: known.message })
        const delays = this.options.retryDelaysMs
        const delay = known.kind === 'rate-limited'
          ? (known.retryAfterSeconds ?? 1) * 1000
          : delays[Math.min(failures, delays.length - 1)] ?? 0
        failures += 1
        await sleep(delay)
        continue
      }
      failures = 0
      this.options.onProblem(undefined)
      for (const update of updates) {
        if (aborted(signal)) return
        offset = update.update_id + 1
        try {
          await this.options.onUpdate(update)
        } catch (error) {
          this.options.onError(error)
        }
      }
    }
  }
}

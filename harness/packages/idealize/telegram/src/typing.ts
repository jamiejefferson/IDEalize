/**
 * The "typing…" shown on the phone while the Studio coordinator works on a
 * note from there (JJ, 15 Sep 2026: "there's no 'typing' message in telegram
 * so it doesn't look like its working"). Telegram shows a chat action for
 * about five seconds, so the indicator is a repeated action: started when a
 * note reaches the coordinator, stopped when its reply is forwarded or its
 * turn ends, and capped so a turn that ends unseen cannot leave the phone
 * "typing" forever.
 * @module @idealize/telegram/typing
 */

import type { Messenger } from './ports.ts'

/** What the indicator needs from its owner. */
export interface TypingOptions {
  messenger: Pick<Messenger, 'typing'>
  /** Milliseconds between repeats; Telegram clears an action after about five seconds. */
  intervalMs?: number
  /** Milliseconds after which an indicator nobody stopped stops itself. */
  maxMs?: number
  /** Where a failed action goes; the indicator never throws into its caller. */
  onError: (error: unknown) => void
}

const DEFAULT_INTERVAL_MS = 4_000
const DEFAULT_MAX_MS = 120_000

/** One paired chat's typing indicator. */
export class Typing {
  private timer: ReturnType<typeof setInterval> | undefined
  private cap: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: TypingOptions) {}

  /** Show typing now and keep showing it until {@link stop} or the cap; a repeat start restarts the cap. */
  start(): void {
    this.stop()
    this.show()
    this.timer = setInterval(() => { this.show() }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS)
    this.cap = setTimeout(() => { this.stop() }, this.options.maxMs ?? DEFAULT_MAX_MS)
  }

  /** Stop repeating; the action Telegram already shows fades on its own. */
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    if (this.cap !== undefined) clearTimeout(this.cap)
    this.timer = undefined
    this.cap = undefined
  }

  /** Whether the indicator is running. */
  get active(): boolean {
    return this.timer !== undefined
  }

  private show(): void {
    this.options.messenger.typing().catch(this.options.onError)
  }
}

/**
 * Per-sender limits on what a chat's shell can send, so one chat that reads
 * hostile text or loops cannot flood other chats' inboxes, the Studio timeline
 * or the person's alerts. In memory: a limit is per launch, and restarting the
 * app clears it.
 * @module @idealize/comm/rate-limit
 */

/** One sliding window: at most `limit` sends in `windowMs`. */
export interface RateWindow {
  limit: number
  windowMs: number
}

const MINUTE = 60_000
const HOUR = 3_600_000

/**
 * The limit on notes per sending chat, shared by everything that lands in
 * another chat's inbox or on the timeline. A coordinator telling 20 workers one
 * thing each is 20 in a burst and fits inside a minute's 30; 300 an hour is
 * that coordinator exchanging 15 notes an hour with each of the 20 for a whole
 * hour. A sequential agent spends a model call per note, so only a script in a
 * loop gets near either number.
 */
export const NOTE_RATE: readonly RateWindow[] = [{ limit: 30, windowMs: MINUTE }, { limit: 300, windowMs: HOUR }]

/**
 * The limit per sending chat on lines that interrupt the person (`notify`,
 * `focus`, `reveal --open`). The coordinator's guide asks for one notification
 * per decision, so 10 an hour leaves room for a busy hour and keeps a loop from
 * turning into a stream of alerts.
 */
export const ATTENTION_RATE: readonly RateWindow[] = [{ limit: 10, windowMs: HOUR }]

/**
 * The image, sound and video chats one launch's chats may start between them.
 * A started chat can generate at the person's expense, so this bounds what a
 * chat reading hostile text can order. A project that needs more than 20 such
 * chats from its agents in one launch can start them from the space itself,
 * where the person is the one starting them.
 */
export const MEDIA_SPAWNS_PER_LAUNCH = 20

/** What a check answers. */
export type RateVerdict =
  | { ok: true }
  /** `first` is true once per spell of refusals, so the note log gets one line for a flood. */
  | { ok: false; retryAfterSeconds: number; first: boolean }

/** A set of sliding windows per sender. */
export class SenderLimiter {
  private readonly sent = new Map<string, number[]>()
  private readonly refusing = new Set<string>()

  constructor(private readonly windows: readonly RateWindow[]) {}

  /**
   * Count one send when it is within every window.
   * @param sender - the sending session.
   * @param now - the clock.
   * @returns whether the send may go.
   */
  take(sender: string, now: number = Date.now()): RateVerdict {
    const longest = Math.max(...this.windows.map(window => window.windowMs))
    const times = (this.sent.get(sender) ?? []).filter(time => now - time < longest)
    let wait = 0
    for (const window of this.windows) {
      const inside = times.filter(time => now - time < window.windowMs)
      const oldest = inside[0]
      if (inside.length >= window.limit && oldest !== undefined) wait = Math.max(wait, oldest + window.windowMs - now)
    }
    this.sent.set(sender, times)
    if (wait > 0) {
      const first = !this.refusing.has(sender)
      this.refusing.add(sender)
      return { ok: false, retryAfterSeconds: Math.ceil(wait / 1000), first }
    }
    this.refusing.delete(sender)
    times.push(now)
    return { ok: true }
  }
}

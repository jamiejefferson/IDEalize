/**
 * One-time pairing codes. The app shows a code; the person sends `/pair <code>`
 * to the bot; the chat that sent a live code becomes the only chat the bot
 * obeys. Codes are single-use, expire, and die after too many wrong guesses,
 * because anyone who learns the bot's username can message it.
 * @module @idealize/telegram/pairing
 */

import { randomInt } from 'node:crypto'

/** A code waiting to be claimed. */
export interface PairingCode {
  code: string
  /** Epoch milliseconds after which the code no longer pairs. */
  expiresAt: number
}

/** The outcome of one `/pair` attempt. */
export type PairingClaim = 'paired' | 'no-code' | 'expired' | 'wrong'

/** Issues and checks pairing codes. At most one code is live. */
export class Pairing {
  private live: PairingCode | undefined
  private wrongGuesses = 0

  /**
   * @param ttlMs - how long a code stays claimable.
   * @param maxWrongGuesses - wrong codes accepted before the live code is withdrawn.
   * @param now - the clock (tests pin it).
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxWrongGuesses: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Issue a fresh six-digit code, replacing any live one.
   * @returns the code and its expiry.
   */
  issue(): PairingCode {
    this.live = { code: String(randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: this.now() + this.ttlMs }
    this.wrongGuesses = 0
    return this.live
  }

  /**
   * The live code, when one is claimable.
   * @returns the code, or undefined when none is live or it has expired.
   */
  pending(): PairingCode | undefined {
    if (this.live !== undefined && this.now() > this.live.expiresAt) this.live = undefined
    return this.live
  }

  /** Withdraw the live code. */
  cancel(): void {
    this.live = undefined
  }

  /**
   * Try a code. A match consumes it.
   * @param code - what the person sent.
   * @returns whether it paired, or why not.
   */
  claim(code: string): PairingClaim {
    if (this.live === undefined) return 'no-code'
    if (this.now() > this.live.expiresAt) {
      this.live = undefined
      return 'expired'
    }
    if (code.trim() !== this.live.code) {
      this.wrongGuesses += 1
      if (this.wrongGuesses >= this.maxWrongGuesses) this.live = undefined
      return 'wrong'
    }
    this.live = undefined
    return 'paired'
  }
}

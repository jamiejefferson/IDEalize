/**
 * Types of the router's session events and their projection, kept free of
 * host imports so a client face can merge them.
 * @module @idealize/router/projection-types
 */

import type { StayReason } from './decide.ts'
import type { TaskType } from './tasks.ts'

/** A model as the badge names it. */
export interface RoutedModel { provider: string; model: string; label: string }

/** What one routed turn records. Stays with nothing to offer are logged to the file and not to the chat. */
export interface RouterEventData {
  /**
   * `switched`: the turn ran on `to`. `offer`: the router stayed and `to` is the user's to accept.
   * `reset`: the user took the model back, so an earlier switch no longer holds.
   */
  outcome: 'switched' | 'offer' | 'reset'
  at: string
  from: RoutedModel
  to: RoutedModel
  /** Why an offer was not taken by the router itself. */
  reason?: Extract<StayReason, 'needs-payment' | 'loses-context'> | undefined
  task?: TaskType | undefined
  rationale?: string | undefined
  /** Gain in weighted score, 0 to 1. */
  improvement?: number | undefined
}

/** A chat's lock: a locked chat is never routed. */
export interface RouterLockEventData { locked: boolean }

/** What clients read for the composer's badge. */
export interface RouterProjection {
  locked: boolean
  /** The latest switch or offer, absent once a reset follows it. */
  last?: RouterEventData | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One routed turn: a switch the router made, or one it left to the user.
     * Appended with the envelope's `ignorable` marker; a harness without the
     * router reads the log and runs the chat on the logged request headers.
     */
    'idealize/router': RouterEventData
    /** The chat's lock against routing. Latest wins. Ignorable for the same reason. */
    'idealize/router-lock': RouterLockEventData
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The chat's routing state, for the composer's badge and lock. */
    router: RouterProjection
  }
}

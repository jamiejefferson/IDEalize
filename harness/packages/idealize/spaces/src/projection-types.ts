/**
 * Types of the space and brain session events and their projections, kept free
 * of host imports so the client face can merge them (`@idealize/spaces/client`).
 * @module @idealize/spaces/projection-types
 */

import type { SpaceId } from './space-table.ts'

/** What the space event records. */
export interface SpaceEventData {
  /** The space this chat is, for the life of the chat. */
  space: SpaceId
}

/** What the brain event records. */
export interface BrainEventData {
  /** The agent preset id of the brain the chat is running. */
  brain: string
  /**
   * The brain's standing instructions, when it carries any. Present because
   * they are sent with every message the brain handles, and anything reaching a
   * model must be reconstructable from the log.
   */
  instructions?: string
}

/** What clients read: the chat's space, resolved through the legacy ladder. */
export interface SpaceProjection {
  /**
   * The chat's space. Always present: a chat with no `idealize/space` event
   * resolves through the derivation ladder, so the sidebar lane never has an
   * empty or "unknown" state.
   */
  space: SpaceId
}

/** What clients read: the brain the chat is running, once one is recorded. */
export interface BrainProjection {
  /** The current brain's agent preset id, absent until one is recorded. */
  brain?: string | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The space this chat is: Chat, Terminal, Gallery, Sound Stage or Motion.
     * Latest wins, though the space is fixed for the life of a chat in practice.
     * Appended with the envelope's `ignorable` marker: a chat with no record
     * still resolves a space through the derivation ladder, so a harness
     * without this vocabulary reads the log and shows Chat rather than refusing
     * it.
     */
    'idealize/space': SpaceEventData
    /**
     * The brain this chat is running: its agent preset id and the standing
     * instructions sent with every message it handles. Latest wins. Model-visible
     * through those instructions, which is why the switch logs rather than only
     * storing them. Appended with the envelope's `ignorable` marker: the preset
     * roster holds the brain's own definition, so a harness without this
     * vocabulary still reads the log.
     */
    'idealize/brain': BrainEventData
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The chat's space, for the sidebar's icon lane and the view ring's seed. */
    space: SpaceProjection
    /** The chat's brain, for the composer's brain switcher. */
    brain: BrainProjection
  }
}

/**
 * The chip-state fold: one pure function from what the host knows about an
 * agent to the design spec's visual state. Precedence: wrong, then
 * needs-input, then working (a turn is running), then ready (the agent is
 * loaded and waiting), then idle (the chat is cold).
 *
 * Attention outranks the rest (JJ, 8 Sep 2026): a chat whose task failed or
 * waits on the user owes that answer whether or not its agent is loaded, and
 * the Studio shows the same attention until it is resolved. `working` is
 * comm's `running`, true only while the agent runs a turn (JJ, 15 Sep 2026:
 * a chat answering read "Ready" with a still dot because the fold took
 * working only from a Studio task); a Studio task's own `working` state
 * counts too, so a coordinator between tool turns keeps its ring. `ready` is
 * a live agent between turns; `idle` is what a chat with nothing loaded and
 * nothing owed is — comm's own status word for it — where the earlier
 * `disconnected` read every quiet chat as broken. The host being unreachable
 * is the bar's error state, never a chip state. `listening` is client-local
 * and never folded here.
 * @module @idealize/askbar/src/chip-state
 */

import type { TaskAttention, TaskExecutionState } from '@idealize/studio'
import type { ChipState } from './types.ts'

/** comm's blocker vocabulary, structurally (no package dependency on comm). */
export type ChipBlocker = 'none' | 'stuck' | 'waiting-on-coordinator' | 'waiting-on-user'

/** Studio's task execution states; imported so the fold cannot drift from the timeline vocabulary. */
export type ChipExecution = TaskExecutionState

/** Studio's attention states; imported so the fold cannot drift from the timeline vocabulary. */
export type ChipAttention = TaskAttention

/** What the fold reads about one agent. */
export interface ChipStateInput {
  /** Whether the chat's agent is running a turn right now (or its terminal CLI is working). */
  running: boolean
  /** Whether an agent holds the session in this app run; false for a stored chat nothing has loaded. */
  live: boolean
  /** The agent's rung blockers across the project's pieces (comm board rows). */
  blockers: readonly ChipBlocker[]
  /** The Studio fold's active-task execution state, when a Studio timeline names one. */
  execution?: ChipExecution | undefined
  /** The Studio fold's active-task attention state, when one exists. */
  attention?: ChipAttention | undefined
}

/**
 * Fold one agent's signals into its visual chip state.
 * @param input - the host-side signals for one agent.
 * @returns the state the chip renders; never `listening`.
 */
export function chipStateOf(input: ChipStateInput): Exclude<ChipState, 'listening'> {
  if (input.attention === 'failure' || input.execution === 'failed' || input.blockers.includes('stuck')) return 'wrong'
  if (
    input.attention === 'needs-input'
    || input.attention === 'needs-action'
    || input.attention === 'blocked'
    || input.attention === 'handoff-ready'
    || input.blockers.includes('waiting-on-user')
  ) return 'needs-input'
  if (input.running) return 'working'
  if (!input.live) return 'idle'
  return input.execution === 'working' ? 'working' : 'ready'
}

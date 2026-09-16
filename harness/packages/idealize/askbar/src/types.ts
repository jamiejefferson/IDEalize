/**
 * Wire types shared by the Askbar's host routes and its renderer. The roster
 * payload is the bar's whole read model: one request answers who is present,
 * what each agent is doing and which timings the interactions use.
 * @module @idealize/askbar/src/types
 */

/**
 * The six visual chip states: the design spec's set with `idle` in place of
 * `disconnected` (a quiet chat is idle; only the host can be unreachable, and
 * that is the bar's error state). `listening` is client-local (a held
 * capture) and never appears in a roster payload.
 */
export type ChipState = 'listening' | 'working' | 'needs-input' | 'wrong' | 'ready' | 'idle'

/** The screen edge the bar docks to. */
export type AskbarEdge = 'left' | 'right'

/** Interaction timings and placement the renderer reads from host config. */
export interface AskbarConfigWire {
  /** Docked screen edge. */
  edge: AskbarEdge
  /** Hover delay before a chip reveals its destination card, in milliseconds. */
  hoverRevealMs: number
  /** Pending-send countdown after releasing a hold, in milliseconds (JJ, 1 Sep 2026: one second). */
  pendingSendMs: number
  /** Window transform animation duration, in milliseconds. */
  transformMs: number
  /** Roster poll interval, in milliseconds. */
  pollMs: number
}

/** One agent chip: a named chat of the active project with its folded state. */
export interface AskbarChip {
  /** The chat's session id — the address for panel sends and Studio owner keys. */
  id: string
  /** The agent's name (comm's drawn name, falling back to the chat title). */
  name: string
  /** The chat's title. */
  title: string
  /** comm role of the chat. */
  role: 'project-agent' | 'studio-agent' | 'chat'
  /** Whether a root agent is running the chat's session right now. */
  running: boolean
  /** Unread mailbox messages for the chat. */
  unread: number
  /** The folded visual state (never `listening`, which is client-local). */
  state: Exclude<ChipState, 'listening'>
  /** The displayed task's goal, when the Studio fold names one. */
  task: string | null
  /** The agent's most recent free-text status label, when one is set. */
  status: string | null
}

/**
 * One project's agents, for the sidebar rail's grouped column. The rail shows
 * every project's agents at once (JJ, 10 Sep 2026), separated by a rule
 * carrying no title, so a group states its project only through its position.
 */
export interface AskbarRosterGroup {
  /** The resolved project folder. */
  project: string
  /** The folder's last segment, which the rail's rollover panel names. */
  name: string
  /** The project's agents, in listing order. */
  chips: AskbarChip[]
}

/** The roster route's payload: everything the bar renders in one read. */
export interface AskbarRoster {
  /** The resolved project folder the roster describes. */
  project: string
  /** Interaction timings and placement. */
  config: AskbarConfigWire
  /** One chip per chat: the requested sessions in their requested order, else every comm chat of the project in listing order. */
  chips: AskbarChip[]
  /**
   * Every project's agents, grouped in project-path order, when the query
   * asked across projects (`all=1`). Absent otherwise, so a bar that follows
   * one project carries no other project's rows.
   */
  groups?: AskbarRosterGroup[]
}

/**
 * The bar's view state: which drawer pane is open, which tab of the Service
 * hatch pane shows, the file open in the deck, and whether the host has a
 * terminal to open. A bare snapshot store so
 * the plugin body (index.ts) is the single writer — it has to drive the pane
 * from outside React (the Appearance service's open flag, ⌘⌥A) — while the
 * rail, drawer and deck read it through one `useBarView` hook.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The drawer panes the rail opens. */
export type BarPanel = 'files' | 'terminal' | 'hatch' | 'models' | 'work' | 'feedback' | 'appearance' | 'trajectory' | 'schedule'

/** The Service hatch pane's tabs. */
export type HatchTab = 'service' | 'composition'

/**
 * What the Brains pane is being asked to do the next time it renders, set by
 * a surface outside the pane. The welcome card's brain step raises both:
 * `add-brain` when a space has no brains yet, `add-key` when no model can
 * serve one. The pane clears the request once it has acted on it.
 */
export type BrainsRequest =
  | { kind: 'add-brain'; space: string }
  | { kind: 'add-key' }

/**
 * A chat's pending "inspect this call" handoff. The chat view's Inspect button
 * writes the call into its own store and asks the ring for `'trajectory'`;
 * the ledger left the ring for the drawer, so ui-bar reads that field, records
 * the target here and opens the Trajectory pane on it. Cleared once the ledger
 * has revealed the record.
 */
export interface InspectRequest {
  /** The chat whose ledger holds the record. */
  sessionId: string
  /** The tool call to reveal. */
  callId: string
}

/**
 * A pending "show me this file" request for the Files pane: the absolute path
 * to reveal, and a nonce that makes revealing the same file twice two
 * requests. `ctx.idealizeBar.revealFile` writes it; the pane expands the
 * file's ancestors, selects its folder and highlights its row, then clears it.
 */
export interface RevealRequest {
  path: string
  nonce: number
}

/** The bar's whole view state; the plugin body is its only writer. */
export interface BarViewState {
  /** The open drawer pane (null = drawer closed). */
  panel: BarPanel | null
  /** The Service hatch pane's active tab. */
  hatchTab: HatchTab
  /** File open in the deck's viewer panel (null = deck empty). */
  file: string | null
  /** A pending request for the Brains pane (null = nothing outstanding). */
  brainsRequest: BrainsRequest | null
  /** A pending inspect handoff for the Trajectory pane (null = nothing outstanding). */
  inspect: InspectRequest | null
  /** A pending reveal for the Files pane (null = nothing outstanding). */
  reveal: RevealRequest | null
  /** Bumped when an artefact lands, so the Files pane re-lists every folder it has loaded. */
  filesReload: number
  /**
   * Whether this host serves an embedded terminal (the desktop shell). The
   * rail shows its Terminal entry only while true; a plain browser has no
   * shell to open.
   */
  terminalAvailable: boolean
}

/** The bar's observable view state. */
export type BarViewStore = SnapshotStore<BarViewState>

/**
 * Create the bar's view store.
 * @returns the store: drawer closed, Service tab, deck empty, nothing pending.
 */
export function createBarViewStore(): BarViewStore {
  return createSnapshotStore<BarViewState>({
    panel: null, hatchTab: 'service', file: null, brainsRequest: null, inspect: null, filesReload: 0, reveal: null, terminalAvailable: false,
  })
}

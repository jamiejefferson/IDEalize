/**
 * The sidebar's persisted row order, read from the browser storage
 * ui-workspace's view store persists to. The floating bar is a second page
 * on the same origin, so it reads the order the expanded sidebar last wrote
 * and shows the rows the way the sidebar does.
 * @module @idealize/askbar/src/client/sidebar-order
 */

import type { SidebarOrder } from './selection.ts'

/** The localStorage key of ui-workspace's view store (`createWorkspaceViewStore`, `persist`). */
export const SIDEBAR_VIEW_KEY = 'dsh.workspace.view.v5'

/** The fields of the persisted view store the bar reads, before validation. */
interface PersistedView {
  orderBy?: unknown
  sessionOrderByAccount?: unknown
  sessionUpdatedAtByAccount?: unknown
}

/** The subset of `Storage` the read needs, so tests pass a plain object. */
export interface OrderStorage {
  /** `Storage.getItem`. */
  getItem(key: string): string | null
}

/**
 * The sidebar's persisted view, or an empty one when the store has not
 * persisted yet, the value does not parse, or the page has no storage (a
 * node run of the client tree). A malformed entry is skipped rather than
 * trusted: the value crosses a durable boundary.
 * @param storage - where the view store persists; defaults to the page's localStorage.
 * @returns the order and last-seen activity per account, empty when nothing usable is stored.
 */
export function readSidebarOrder(storage: OrderStorage | undefined = defaultStorage()): SidebarOrder {
  const parsed = readJson(storage, SIDEBAR_VIEW_KEY) as PersistedView | null
  if (typeof parsed !== 'object' || parsed === null) return {}
  const view: { -readonly [K in keyof SidebarOrder]: SidebarOrder[K] } = {}
  if (parsed.orderBy === 'manual' || parsed.orderBy === 'updated') view.orderBy = parsed.orderBy
  if (typeof parsed.sessionOrderByAccount === 'object' && parsed.sessionOrderByAccount !== null) {
    const order: Record<string, readonly string[]> = {}
    for (const [key, value] of Object.entries(parsed.sessionOrderByAccount)) {
      if (Array.isArray(value) && value.every(id => typeof id === 'string')) order[key] = value
    }
    view.sessionOrderByAccount = order
  }
  if (typeof parsed.sessionUpdatedAtByAccount === 'object' && parsed.sessionUpdatedAtByAccount !== null) {
    const seen: Record<string, Readonly<Record<string, number>>> = {}
    for (const [key, value] of Object.entries(parsed.sessionUpdatedAtByAccount)) {
      if (typeof value !== 'object' || value === null) continue
      const times = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      seen[key] = Object.fromEntries(times)
    }
    view.sessionUpdatedAtByAccount = seen
  }
  return view
}

/** The localStorage key of the client runtime's session selection store (`dsh-client-runtime` sessions service). */
export const CURRENT_SESSION_KEY = 'dsh.sessions.current'

/**
 * The chat the main window has open, as its selection store persisted it.
 * The floating bar's page keeps its own selection from load, so it reads the
 * main window's to show the same New Session row the sidebar shows.
 * @param storage - where the selection store persists; defaults to the page's localStorage.
 * @returns the current session id, or none when nothing usable is stored.
 */
export function readCurrentSession(storage: OrderStorage | undefined = defaultStorage()): string | undefined {
  const id = (readJson(storage, CURRENT_SESSION_KEY) as { sessionId?: unknown } | null)?.sessionId
  return typeof id === 'string' ? id : undefined
}

/** One stored JSON value, or null when storage is absent, denies the read, holds nothing, or holds what is not JSON. */
function readJson(storage: OrderStorage | undefined, key: string): unknown {
  if (storage === undefined) return null
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    // Storage access throws in private mode or under a denied storage policy; the bar then keeps its own state.
    return null
  }
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    // A truncated or foreign value under the key is not a store's state; the bar then keeps its own state.
    return null
  }
}

function defaultStorage(): OrderStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

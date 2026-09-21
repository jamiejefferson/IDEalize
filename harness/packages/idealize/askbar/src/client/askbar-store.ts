/**
 * The bar's read model: one snapshot store fed by polling the roster route
 * for the current selection (project plus the sidebar's session rows), with
 * the host-bridge SSE stream as a hurry-up (any bridge event triggers an
 * immediate refresh, so `agent-finished` and mail land without waiting for
 * the next poll). A new selection refreshes at once; a new project also drops
 * the old roster so the bar never shows another project's agents. The store
 * is the single writer; components read it through `useSyncExternalStore`.
 * @module @idealize/askbar/src/client/askbar-store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AskbarRoster } from '../types.ts'
import { type BridgeFeedAttachment, followBridgeFeed } from './bridge-feed.ts'
import { type RosterSelection, sameSelection } from './selection.ts'

/** What the bar renders: the selection it follows, the latest roster, or why there is none yet. */
export interface AskbarView {
  /** The project folder the bar follows; '' while no project exists. */
  project: string
  /** The latest roster for that project; null before the first successful read. */
  roster: AskbarRoster | null
  /** The latest read failure, cleared by the next success; null while healthy. */
  error: string | null
}

/** The observable bar view. */
export type AskbarStore = SnapshotStore<AskbarView>

/** The running store: its view, the selection setter, and the disposer. */
export interface AskbarStoreHandle {
  /** The observable bar view. */
  store: AskbarStore
  /**
   * Follow another selection; an unchanged one is a no-op.
   * @param next - the project and its sidebar rows.
   */
  select: (next: RosterSelection) => void
  /** Stop polling and close the stream. */
  stop: () => void
}

/** What a store's reads ask for beyond the selection itself. */
export interface AskbarStoreOptions {
  /**
   * Ask each read for every project's agents grouped. Both homes ask for it,
   * with the sidebar's rows riding along so the groups cover those rows and
   * no other (JJ, 13 Sep 2026: one set of agents in all three states).
   */
  allProjects?: boolean
}

/** Poll cadence used until the first roster carries the configured one. */
const BOOT_POLL_MS = 2000

/** SSE refreshes collapse into one read per this window. */
const REFRESH_DEBOUNCE_MS = 150

/**
 * The roster URL for one selection. An empty project asks for the timings
 * alone (the route serves no chips for it); otherwise the sidebar's rows ride
 * along so the host covers exactly those.
 * @param selection - the project and its sessions.
 * @param allProjects - true to ask for every project's agents grouped as well (the sidebar rail).
 * @returns the roster route with its query.
 */
export function rosterUrl(selection: RosterSelection, allProjects = false): string {
  const base = `/idealize/askbar/roster?project=${encodeURIComponent(selection.project)}`
  const all = allProjects ? '&all=1' : ''
  if (selection.project === '') return `${base}${all}`
  return `${base}&sessions=${encodeURIComponent(selection.sessionIds.join(','))}${all}`
}

/**
 * Create the store and start its poll plus SSE hurry-up.
 * @param initial - the selection the bar starts on.
 * @param options - what the reads ask for beyond the selection.
 * @returns the store, the selection setter, and the disposer.
 */
export function startAskbarStore(initial: RosterSelection, options: AskbarStoreOptions = {}): AskbarStoreHandle {
  let selection = initial
  const store = createSnapshotStore<AskbarView>({ project: initial.project, roster: null, error: null })
  let timer: ReturnType<typeof setTimeout> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  /** The body of the last roster published, to tell a poll that changed nothing. */
  let lastText: string | undefined

  const refresh = async (): Promise<void> => {
    const asked = selection
    try {
      const response = await fetch(rosterUrl(asked, options.allProjects === true))
      if (!response.ok) throw new Error(`roster read failed: ${response.status}`)
      const roster = await response.json() as AskbarRoster
      // A read for a superseded selection is stale: the refresh it triggered lands next.
      if (!stopped && asked === selection) {
        // Most polls answer what the last one did. Publishing an equal roster
        // as a fresh object re-renders every subscriber for nothing.
        const shown = store.getSnapshot()
        const text = JSON.stringify(roster)
        const unchanged = text === lastText && shown.roster !== null && shown.error === null && shown.project === asked.project
        lastText = text
        if (!unchanged) store.set({ project: asked.project, roster, error: null })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!stopped && asked === selection) store.set({ ...store.getSnapshot(), error: message })
    }
    if (stopped) return
    const pollMs = store.getSnapshot().roster?.config.pollMs ?? BOOT_POLL_MS
    clearTimeout(timer)
    timer = setTimeout(tick, pollMs)
  }

  // A hidden window shows nobody the roster, so its poll waits: the timer
  // keeps its cadence without reading, a bridge event still hurries a read,
  // and the window reads at once when it shows again.
  const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden'
  const tick = (): void => {
    if (!hidden()) { void refresh(); return }
    const pollMs = store.getSnapshot().roster?.config.pollMs ?? BOOT_POLL_MS
    timer = setTimeout(tick, pollMs)
  }
  const onVisibility = (): void => {
    if (!stopped && !hidden()) void refresh()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

  const hurry = (): void => {
    if (stopped) return
    clearTimeout(debounce)
    debounce = setTimeout(() => { void refresh() }, REFRESH_DEBOUNCE_MS)
  }

  void refresh()
  // The window's one bridge feed connection; the poll alone stays correct without it.
  let feed: BridgeFeedAttachment | undefined
  void followBridgeFeed(hurry).then((attachment) => {
    if (stopped) attachment?.close()
    else feed = attachment
  })

  return {
    store,
    select: (next) => {
      if (stopped || sameSelection(selection, next)) return
      const projectChanged = next.project !== selection.project
      selection = next
      if (projectChanged) store.set({ project: next.project, roster: null, error: null })
      hurry()
    },
    stop: () => {
      stopped = true
      clearTimeout(timer)
      clearTimeout(debounce)
      feed?.close()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}

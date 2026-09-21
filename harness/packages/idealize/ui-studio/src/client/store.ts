/**
 * The Studio view's state, held outside React because leaving the Studio chat
 * unmounts the view: coming back must land on the same state without a blank
 * flash, and an in-flight sync must not write over a newer one.
 *
 * The store is created once per plugin fiber. Sync reads two loopback
 * routes: `GET /idealize/studio/overview` (every stored project's folded
 * state — the fold is the authority — and its recent timeline) and
 * `GET /idealize/notify/attention` (where the person has read to, and what
 * became of each alert). The Studio spans every project (JJ, 3 Sep 2026), so
 * there is no project to select.
 *
 * Read position is the only thing this store writes, and it writes it to
 * `@idealize/notify`: viewing the Studio is what marks its events read.
 * Nothing here resolves a request — that is the fold's record (FR-P0-19).
 * @module @idealize/ui-studio/client/store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { OverviewResponse, ProjectView } from './studio-model.ts'

/** The Studio's view: every project's folded state and recent timeline. */
export interface StudioViewState {
  /** Every project with a timeline, in path order; empty before the first read or while nothing is recorded. */
  projects: ProjectView[]
  /** True from mount until the first settle. */
  loading: boolean
  /** True once a read has succeeded; the card's presence dot reads it. */
  loaded: boolean
  /** The last sync failure, or null; stale data stays visible under it. */
  error: string | null
  /** Newest seq the person has read, per project folder; a project absent here is wholly unread. */
  read: Record<string, number>
  /** A Studio event the view should land on, until the view takes it. */
  focus: string | null
}

/** The view state plus its complete write set. */
export interface StudioStore {
  /** The observable state (arrives at the component as the `useStudio` hook). */
  state: SnapshotStore<StudioViewState>
  /**
   * Read the overview and the attention ledger. Concurrent calls settle
   * newest-wins; a superseded response is dropped.
   */
  sync: () => Promise<void>
  /**
   * Land the view on one Studio event (an opened alert names it). The view
   * takes it on its next render.
   */
  focus: (studioEvent: string) => void
  /** Take the pending focus target, leaving none behind. */
  takeFocus: () => string | null
  /**
   * Record that the person has seen a project's timeline up to `seq`. A
   * position never moves backwards, in the store or on the host.
   */
  markRead: (project: string, seq: number) => Promise<void>
}

/**
 * Create the Studio store.
 * @returns the store: nothing loaded.
 */
export function createStudioStore(): StudioStore {
  const state = createSnapshotStore<StudioViewState>({
    projects: [],
    loading: true,
    loaded: false,
    error: null,
    read: {},
    focus: null,
  })

  // Newest sync wins: responses carrying an older token are dropped.
  let token = 0

  /**
   * The ledger's read positions. A composition without `@idealize/notify`
   * answers nothing, and everything then reads as unread, which is honest:
   * no record says otherwise.
   */
  const readPositions = async (): Promise<Record<string, number>> => {
    try {
      const response = await fetch('/idealize/notify/attention')
      if (!response.ok) return {}
      return (await response.json() as { read?: Record<string, number> }).read ?? {}
    } catch {
      return {}
    }
  }

  /** The last overview and read positions published, serialised, to tell a poll that changed nothing. */
  let lastAnswered: string | undefined

  const sync = async (): Promise<void> => {
    const mine = ++token
    try {
      const response = await fetch('/idealize/studio/overview')
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const overview = await response.json() as OverviewResponse
      const read = await readPositions()
      if (mine !== token) return
      // Most polls answer what the last one did; replacing equal projects
      // with fresh objects re-renders and re-sorts the whole view for nothing.
      const answered = JSON.stringify([overview.projects, read])
      const shown = state.getSnapshot()
      if (answered === lastAnswered && shown.loaded && !shown.loading && shown.error === null) return
      lastAnswered = answered
      state.update((draft) => {
        draft.projects = overview.projects
        draft.read = read
        draft.loading = false
        draft.loaded = true
        draft.error = null
      })
    } catch (error) {
      if (mine !== token) return
      state.update((draft) => {
        draft.loading = false
        draft.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  const focus = (studioEvent: string): void => {
    state.update((draft) => { draft.focus = studioEvent })
  }

  const takeFocus = (): string | null => {
    const pending = state.getSnapshot().focus
    if (pending !== null) state.update((draft) => { draft.focus = null })
    return pending
  }

  const markRead = async (project: string, seq: number): Promise<void> => {
    if (seq <= (state.getSnapshot().read[project] ?? 0)) return
    // The position shown now runs ahead of the last answer; the next sync publishes whatever the host holds.
    lastAnswered = undefined
    state.update((draft) => { draft.read = { ...draft.read, [project]: seq } })
    try {
      await fetch('/idealize/notify/attention/read', {
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ project, seq }),
      })
    } catch {
      // the host went away; the next sync re-reads the stored position
    }
  }

  return { state, sync, focus, takeFocus, markRead }
}

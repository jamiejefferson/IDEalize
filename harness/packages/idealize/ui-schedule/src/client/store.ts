/**
 * The Schedule view's own state, held outside React because the drawer
 * unmounts a closed pane: without this store, closing the drawer and
 * reopening it would reset the week to today and throw away an in-progress
 * edit (SCH-09's ring unmounts; the drawer pane behaves the same way).
 *
 * The store is created once per plugin fiber and shared by every chat, so the
 * calendar reads the same way whichever conversation the pane sits beside.
 * Nothing persists to storage: a calendar is expected to reopen on today, in
 * the Day view the wireframe leads with.
 * @module @idealize/ui-schedule/client/store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { Schedule, TaskDraft } from './schedule-model.ts'

/** Which of the view's three states renders: the calendar, the task editor, or Create-with-chat. */
export type ScheduleMode =
  | { kind: 'calendar' }
  | { kind: 'edit'; draft: TaskDraft; nextFireAt?: string }
  | { kind: 'create'; schedule?: Schedule }

/**
 * The calendar's grain: the hour lane of one day, the seven-column week, or
 * the month grid, which picks a day rather than showing the work on it.
 */
export type ScheduleGrain = 'day' | 'week' | 'month'

/** The Schedule view's position: its navigated day, its grain and its open state. */
export interface ScheduleViewState {
  /** The navigated day as epoch milliseconds; null means today, re-read on each mount. */
  dateMs: number | null
  /** Which calendar renders: the Day lane (the default) or the Week grid. */
  grain: ScheduleGrain
  /** The calendar, the editor with its draft, or Create-with-chat with its seeded slot. */
  mode: ScheduleMode
}

/** The view's state plus its complete write set (the component writes through these only). */
export interface ScheduleStore {
  /** The observable state (arrives at the component as the `useSchedule` selector hook). */
  state: SnapshotStore<ScheduleViewState>
  /**
   * Navigate to a day; the calendar shows that day's week.
   * @param dateMs - the day as epoch milliseconds, or null for today.
   */
  setDate: (dateMs: number | null) => void
  /**
   * Open the calendar, the editor, or Create-with-chat.
   * @param mode - the state to show.
   */
  setMode: (mode: ScheduleMode) => void
  /**
   * Switch the calendar between the Day lane and the Week grid.
   * @param grain - the grain to show.
   */
  setGrain: (grain: ScheduleGrain) => void
}

/**
 * Create the Schedule view's store.
 * @returns the store: today, the Day lane, and the calendar showing.
 */
export function createScheduleStore(): ScheduleStore {
  const state = createSnapshotStore<ScheduleViewState>({
    dateMs: null,
    grain: 'day',
    mode: { kind: 'calendar' },
  })
  return {
    state,
    setDate: (dateMs) => { state.update((draft) => { draft.dateMs = dateMs }) },
    setMode: (mode) => { state.update((draft) => { draft.mode = mode }) },
    setGrain: (grain) => { state.update((draft) => { draft.grain = grain }) },
  }
}

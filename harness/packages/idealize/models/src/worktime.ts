/**
 * Working time for the Time & cost pane: a pure fold of session logs into
 * the spans a project's chats spent answering. Every turn opens with a
 * `turn/start` event and closes with `turn/end`; the span between them is
 * time the chat was working, and a turn still open counts up to now. A
 * project's working time is the union of its chats' spans (two chats
 * answering at once in one project count once), with any pause shorter than
 * {@link WORK_GAP_MS} between spans bridged as working, because that is the
 * person reading the answer and typing the next message.
 *
 * Totals are reported in whole seconds for today, this month to date, and
 * all time. The calendar is the host machine's local clock, which is the
 * person's own day.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** A pause between two turns shorter than this counts as working time. */
export const WORK_GAP_MS = 5 * 60_000

/** One stretch of working time, as unix epoch milliseconds. */
export interface WorkSpan {
  start: number
  end: number
}

/** Working seconds per period. */
export interface WorkTotals {
  today: number
  month: number
  all: number
}

/** The instants that bound the reporting periods (ms). */
export interface WorkBounds {
  /** The instant an open turn counts up to, and the end of every period. */
  now: number
  /** Midnight at the start of today. */
  dayStart: number
  /** Midnight at the start of the first of this month. */
  monthStart: number
}

/**
 * The reporting bounds for an instant, on the local calendar.
 * @param now - the instant (ms).
 * @returns today's and this month's start, with `now`.
 */
export function workBounds(now: number): WorkBounds {
  const at = new Date(now)
  return {
    now,
    dayStart: new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime(),
    monthStart: new Date(at.getFullYear(), at.getMonth(), 1).getTime(),
  }
}

/**
 * One session's turn spans, in log order.
 * A `turn/start` while a turn is already open closes the earlier one at the
 * new start, so a log that lost a `turn/end` never counts to now twice; a
 * turn open at the end of the log counts up to `now`.
 * @param events - the session's events.
 * @param now - the instant an open turn counts up to (ms).
 * @returns the spans, unmerged.
 */
export function turnSpans(events: readonly SessionEvent[], now: number): WorkSpan[] {
  const spans: WorkSpan[] = []
  let open: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (open !== undefined && event.time > open) spans.push({ start: open, end: event.time })
      open = event.time
    } else if (event.type === 'turn/end' && open !== undefined) {
      if (event.time > open) spans.push({ start: open, end: event.time })
      open = undefined
    }
  }
  if (open !== undefined && now > open) spans.push({ start: open, end: now })
  return spans
}

/**
 * The union of spans, with pauses shorter than `gapMs` bridged.
 * @param spans - spans from any number of sessions, in any order.
 * @param gapMs - the longest pause that still counts as working.
 * @returns non-overlapping spans in start order.
 */
export function mergeSpans(spans: readonly WorkSpan[], gapMs: number = WORK_GAP_MS): WorkSpan[] {
  const sorted = [...spans].sort((left, right) => left.start - right.start)
  const merged: WorkSpan[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.start - last.end < gapMs) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/** The milliseconds of `spans` that fall inside [from, to]. */
function within(spans: readonly WorkSpan[], from: number, to: number): number {
  let total = 0
  for (const span of spans) {
    const start = Math.max(span.start, from)
    const end = Math.min(span.end, to)
    if (end > start) total += end - start
  }
  return total
}

/**
 * Period totals over merged spans.
 * @param spans - the merged spans ({@link mergeSpans}).
 * @param bounds - the period bounds ({@link workBounds}).
 * @returns whole seconds for today, this month, and all time.
 */
export function workTotals(spans: readonly WorkSpan[], bounds: WorkBounds): WorkTotals {
  return {
    today: Math.round(within(spans, bounds.dayStart, bounds.now) / 1000),
    month: Math.round(within(spans, bounds.monthStart, bounds.now) / 1000),
    all: Math.round(within(spans, 0, bounds.now) / 1000),
  }
}

/**
 * Fold any number of session logs into one set of working spans: every
 * session's turns, unioned and gap-bridged as one project.
 * @param logs - the sessions' event lists.
 * @param now - the instant an open turn counts up to (ms).
 * @returns the merged spans.
 */
export function foldWorkSpans(logs: readonly (readonly SessionEvent[])[], now: number): WorkSpan[] {
  return mergeSpans(logs.flatMap(events => turnSpans(events, now)))
}

/**
 * Fold session logs straight to period totals.
 * @param logs - the sessions' event lists.
 * @param bounds - the period bounds ({@link workBounds}).
 * @returns whole seconds for today, this month, and all time.
 */
export function foldWorkTime(logs: readonly (readonly SessionEvent[])[], bounds: WorkBounds): WorkTotals {
  return workTotals(foldWorkSpans(logs, bounds.now), bounds)
}

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldWorkSpans, foldWorkTime, mergeSpans, turnSpans, WORK_GAP_MS, workBounds, workTotals } from '../src/worktime.ts'

const MIN = 60_000
// A fixed local calendar: 21 Aug 2026, 12:00 on the host clock.
const NOW = new Date(2026, 7, 21, 12).getTime()
const BOUNDS = workBounds(NOW)

function turn(start: number, end?: number): SessionEvent[] {
  const events = [{ type: 'turn/start', time: start, data: { turn: 1 } } as unknown as SessionEvent]
  if (end !== undefined) events.push({ type: 'turn/end', time: end, data: { turn: 1, reason: 'success' } } as unknown as SessionEvent)
  return events
}

describe('turnSpans', () => {
  it('pairs each turn start with its end, and counts an open turn up to now', () => {
    const events = [...turn(NOW - 10 * MIN, NOW - 8 * MIN), ...turn(NOW - 3 * MIN)]
    expect(turnSpans(events, NOW)).toEqual([
      { start: NOW - 10 * MIN, end: NOW - 8 * MIN },
      { start: NOW - 3 * MIN, end: NOW },
    ])
  })

  it('closes a turn that lost its end at the next start, so a broken log never counts to now twice', () => {
    const events = [...turn(NOW - 30 * MIN), ...turn(NOW - 20 * MIN, NOW - 19 * MIN)]
    expect(turnSpans(events, NOW)).toEqual([
      { start: NOW - 30 * MIN, end: NOW - 20 * MIN },
      { start: NOW - 20 * MIN, end: NOW - 19 * MIN },
    ])
  })

  it('ignores an end with no start and a zero-length turn', () => {
    const stray = [{ type: 'turn/end', time: NOW - MIN, data: { turn: 1, reason: 'success' } }] as unknown as SessionEvent[]
    expect(turnSpans(stray, NOW)).toEqual([])
    expect(turnSpans(turn(NOW - MIN, NOW - MIN), NOW)).toEqual([])
  })
})

describe('mergeSpans', () => {
  it('unions overlapping spans so two chats answering at once count once', () => {
    const spans = [
      { start: 0, end: 10 * MIN },
      { start: 5 * MIN, end: 12 * MIN },
      { start: 30 * MIN, end: 31 * MIN },
    ]
    expect(mergeSpans(spans)).toEqual([{ start: 0, end: 12 * MIN }, { start: 30 * MIN, end: 31 * MIN }])
  })

  it('bridges a pause under five minutes and keeps one of five minutes or more', () => {
    const spans = [
      { start: 0, end: 10 * MIN },
      { start: 10 * MIN + WORK_GAP_MS - 1, end: 20 * MIN },
      { start: 20 * MIN + WORK_GAP_MS, end: 21 * MIN + WORK_GAP_MS },
    ]
    expect(mergeSpans(spans)).toEqual([
      { start: 0, end: 20 * MIN },
      { start: 20 * MIN + WORK_GAP_MS, end: 21 * MIN + WORK_GAP_MS },
    ])
  })

  it('takes spans in any order and leaves its input alone', () => {
    const spans = [{ start: 20 * MIN, end: 21 * MIN }, { start: 0, end: 10 * MIN }]
    expect(mergeSpans(spans)).toEqual([{ start: 0, end: 10 * MIN }, { start: 20 * MIN, end: 21 * MIN }])
    expect(spans[0]).toEqual({ start: 20 * MIN, end: 21 * MIN })
  })
})

describe('workTotals', () => {
  it('clips a span to each period, so work that straddles midnight or the month start splits correctly', () => {
    const spans = [
      // 90 minutes across the month boundary: 60 in July, 30 in August.
      { start: BOUNDS.monthStart - 60 * MIN, end: BOUNDS.monthStart + 30 * MIN },
      // 40 minutes across last midnight: 30 yesterday, 10 today.
      { start: BOUNDS.dayStart - 30 * MIN, end: BOUNDS.dayStart + 10 * MIN },
      // 20 minutes this morning.
      { start: NOW - 20 * MIN, end: NOW },
    ]
    // Today: 10 + 20. This month: 30 + 40 + 20. All time: 90 + 40 + 20.
    expect(workTotals(spans, BOUNDS)).toEqual({ today: 30 * 60, month: 90 * 60, all: 150 * 60 })
  })

  it('reports whole seconds and nothing past now', () => {
    expect(workTotals([{ start: NOW - 1500, end: NOW + 60 * MIN }], BOUNDS)).toEqual({ today: 2, month: 2, all: 2 })
  })
})

describe('foldWorkSpans and foldWorkTime', () => {
  it('folds several chats of one project into one union with gaps bridged, an open turn counting to now', () => {
    const chatA = [...turn(NOW - 30 * MIN, NOW - 25 * MIN), ...turn(NOW - 2 * MIN)]
    const chatB = turn(NOW - 27 * MIN, NOW - 21 * MIN)
    expect(foldWorkSpans([chatA, chatB], NOW)).toEqual([
      { start: NOW - 30 * MIN, end: NOW - 21 * MIN },
      { start: NOW - 2 * MIN, end: NOW },
    ])
    expect(foldWorkTime([chatA, chatB], BOUNDS)).toEqual({ today: 11 * 60, month: 11 * 60, all: 11 * 60 })
  })

  it('counts nothing for a log with no turns', () => {
    expect(foldWorkTime([[]], BOUNDS)).toEqual({ today: 0, month: 0, all: 0 })
  })
})

describe('workBounds', () => {
  it('starts today and this month at local midnight', () => {
    expect(new Date(BOUNDS.dayStart).toLocaleString('en-GB')).toBe(new Date(2026, 7, 21).toLocaleString('en-GB'))
    expect(new Date(BOUNDS.monthStart).toLocaleString('en-GB')).toBe(new Date(2026, 7, 1).toLocaleString('en-GB'))
    expect(BOUNDS.now).toBe(NOW)
  })
})

/**
 * What a terminal agent is doing, read from its output: a run outlasting the
 * floor is the CLI working, a stretch of quiet ends it, and typing at a
 * prompt — which echoes — raises nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeRun } from '../src/index.ts'
import { MIN_RUN_MS, QUIET_MS, TerminalActivity } from '../src/activity.ts'

afterEach(() => { vi.useRealTimers() })

/**
 * Keep one terminal's run alive for a stretch, feeding output more often than
 * the quiet that would end it — which is what a working CLI does.
 * @param activity - the watcher.
 * @param id - the terminal.
 * @param ms - how long to keep it going.
 */
function busyFor(activity: TerminalActivity, id: string, ms: number): void {
  const step = QUIET_MS - 100
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    activity.sawOutput(id)
    vi.advanceTimersByTime(step)
  }
  activity.sawOutput(id)
}

/** A watcher over fake timers, recording what it reports. */
function watcher() {
  vi.useFakeTimers()
  const working: string[] = []
  const done: { id: string; ranForMs: number }[] = []
  const activity = new TerminalActivity({
    onWorking: id => working.push(id),
    onDone: (id, ranForMs) => done.push({ id, ranForMs }),
  })
  return { activity, working, done }
}

describe('a terminal agent working', () => {
  it('says so once the run outlasts the floor, and says it stopped after the quiet', () => {
    const { activity, working, done } = watcher()
    activity.sawOutput('t1')
    // Still inside the floor: output, but nothing anybody should hear about.
    vi.advanceTimersByTime(1_000)
    activity.sawOutput('t1')
    expect(working).toEqual([])
    expect(activity.working()).toEqual([])

    busyFor(activity, 't1', MIN_RUN_MS)
    expect(working).toEqual(['t1'])
    expect(activity.working()).toEqual(['t1'])

    vi.advanceTimersByTime(QUIET_MS)
    expect(done).toHaveLength(1)
    expect(done[0]?.id).toBe('t1')
    expect(done[0]?.ranForMs).toBeGreaterThanOrEqual(MIN_RUN_MS)
    expect(activity.working()).toEqual([])
  })

  it('says it once however much output arrives', () => {
    const { activity, working } = watcher()
    busyFor(activity, 't1', MIN_RUN_MS * 3)
    expect(working).toEqual(['t1'])
  })

  it('holds one run across the pauses a CLI thinks in', () => {
    const { activity, working, done } = watcher()
    activity.sawOutput('t1')
    for (let tick = 0; tick < 6; tick += 1) {
      vi.advanceTimersByTime(QUIET_MS - 100)
      activity.sawOutput('t1')
    }
    expect(working).toEqual(['t1'])
    expect(done).toEqual([])
    vi.advanceTimersByTime(QUIET_MS)
    expect(done).toHaveLength(1)
  })

  it('watches each terminal on its own', () => {
    const { activity, working, done } = watcher()
    const step = QUIET_MS - 100
    for (let elapsed = 0; elapsed <= MIN_RUN_MS; elapsed += step) {
      activity.sawOutput('t1')
      activity.sawOutput('t2')
      vi.advanceTimersByTime(step)
    }
    activity.sawOutput('t1')
    activity.sawOutput('t2')
    expect(working.sort()).toEqual(['t1', 't2'])
    vi.advanceTimersByTime(QUIET_MS)
    expect(done.map(row => row.id).sort()).toEqual(['t1', 't2'])
  })
})

describe('what raises nothing', () => {
  it('keeps typing at a prompt quiet: the echo is output, but the run is too short', () => {
    const { activity, working, done } = watcher()
    for (const _key of 'hello world') {
      activity.sawOutput('t1')
      vi.advanceTimersByTime(120)
    }
    vi.advanceTimersByTime(QUIET_MS)
    expect(working).toEqual([])
    expect(done).toEqual([])
  })

  it('reports nothing for a shell that exits mid-run: closing is not finishing', () => {
    const { activity, working, done } = watcher()
    busyFor(activity, 't1', MIN_RUN_MS)
    expect(working).toEqual(['t1'])
    activity.closed('t1')
    vi.advanceTimersByTime(QUIET_MS * 4)
    expect(done).toEqual([])
    expect(activity.working()).toEqual([])
  })

  it('forgets a terminal it never watched, and reports nothing after it stops', () => {
    const { activity, done } = watcher()
    activity.closed('never-seen')
    busyFor(activity, 't1', MIN_RUN_MS)
    activity.stop()
    vi.advanceTimersByTime(QUIET_MS * 4)
    expect(done).toEqual([])
    expect(activity.working()).toEqual([])
  })
})

describe('describeRun', () => {
  it('reads seconds under a minute and minutes and seconds over one', () => {
    expect(describeRun(45_000)).toBe('45s')
    expect(describeRun(59_400)).toBe('59s')
    expect(describeRun(150_000)).toBe('2m 30s')
    expect(describeRun(3_600_000)).toBe('60m 0s')
  })
})

/**
 * Waiting for a terminal agent to answer a typed line (pausing every agent,
 * feedback 495cec0a): typed, then a reported run that finishes, is an answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANSWER_START_MS, TerminalDeliveries, type TerminalDelivery } from '../src/delivery.ts'

/** Collect a wait's outcome as it settles. */
function watch(outcome: Promise<TerminalDelivery>): { value: TerminalDelivery | undefined } {
  const seen: { value: TerminalDelivery | undefined } = { value: undefined }
  void outcome.then((value) => { seen.value = value })
  return seen
}

describe('TerminalDeliveries', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('answers once the line is typed and the run it set off finishes', async () => {
    const deliveries = new TerminalDeliveries()
    const handle = deliveries.begin('t-1')
    const seen = watch(handle.outcome)
    // A run that finishes before the line is typed is the agent's earlier work.
    deliveries.working('t-1')
    deliveries.done('t-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.value).toBeUndefined()
    handle.typed()
    deliveries.working('t-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.value).toBeUndefined()
    deliveries.done('t-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.value).toBe('answered')
  })

  it('counts a typed line as answered when no run starts within the grace', async () => {
    const deliveries = new TerminalDeliveries()
    const handle = deliveries.begin('t-1')
    const seen = watch(handle.outcome)
    handle.typed()
    await vi.advanceTimersByTimeAsync(ANSWER_START_MS - 1)
    expect(seen.value).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(seen.value).toBe('answered')
  })

  it('keeps waiting through a long answer once its run has started', async () => {
    const deliveries = new TerminalDeliveries()
    const handle = deliveries.begin('t-1')
    const seen = watch(handle.outcome)
    handle.typed()
    deliveries.working('t-1')
    await vi.advanceTimersByTimeAsync(ANSWER_START_MS * 4)
    expect(seen.value).toBeUndefined()
    deliveries.done('t-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.value).toBe('answered')
  })

  it('ends a wait as dropped or gone, and a later line replaces an earlier wait', async () => {
    const deliveries = new TerminalDeliveries()
    const first = deliveries.begin('t-1')
    const firstSeen = watch(first.outcome)
    const second = deliveries.begin('t-1')
    const secondSeen = watch(second.outcome)
    // The nudger dropping the replaced line reaches the replaced wait only.
    first.dropped()
    await vi.advanceTimersByTimeAsync(0)
    expect(firstSeen.value).toBe('dropped')
    expect(secondSeen.value).toBeUndefined()
    deliveries.closed('t-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(secondSeen.value).toBe('gone')

    const third = deliveries.begin('t-1')
    const thirdSeen = watch(third.outcome)
    deliveries.dropped('t-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(thirdSeen.value).toBe('dropped')
  })
})

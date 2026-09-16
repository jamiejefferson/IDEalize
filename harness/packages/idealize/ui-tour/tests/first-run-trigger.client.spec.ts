// The automatic first-run start against its two sources: the settings section
// and the holds count. The hold-after-arming case is the packaged-build race
// (14 Sep 2026): the section was ready before the onboarding plugin held.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armFirstRunTrigger, type FirstRunSettingsSnapshot, type FirstRunSource } from '../src/client/first-run-trigger.ts'

function source<T>(initial: T): FirstRunSource<T> & { set(next: T): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => { value = next; for (const listener of listeners) listener() },
  }
}

const ready = (hasSeenTour?: boolean): FirstRunSettingsSnapshot => ({ status: 'ready', value: hasSeenTour === undefined ? {} : { hasSeenTour } })

describe('the first-run trigger', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts after the delay once the section is ready with no seen tour, and never for a seen one', () => {
    const scope = source<FirstRunSettingsSnapshot>({ status: 'loading', value: undefined })
    const start = vi.fn()
    const dispose = armFirstRunTrigger({ scope, holds: source(0), start, delayMs: 1400 })
    vi.advanceTimersByTime(5000)
    expect(start).not.toHaveBeenCalled()
    scope.set(ready())
    vi.advanceTimersByTime(1399)
    expect(start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(start).toHaveBeenCalledTimes(1)
    dispose()

    const seen = vi.fn()
    armFirstRunTrigger({ scope: source(ready(true)), holds: source(0), start: seen, delayMs: 1400 })
    vi.advanceTimersByTime(5000)
    expect(seen).not.toHaveBeenCalled()
  })

  it('waits for a hold that stands before the section is ready, and starts after its release', () => {
    const scope = source<FirstRunSettingsSnapshot>({ status: 'loading', value: undefined })
    const holds = source(1)
    const start = vi.fn()
    armFirstRunTrigger({ scope, holds, start, delayMs: 1400 })
    scope.set(ready())
    vi.advanceTimersByTime(5000)
    expect(start).not.toHaveBeenCalled()
    holds.set(0)
    vi.advanceTimersByTime(1400)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('disarms a pending start when a hold is taken after arming, then starts once from the release', () => {
    // The section is ready as the plugin applies; the wizard's hold lands later.
    const holds = source(0)
    const start = vi.fn()
    armFirstRunTrigger({ scope: source(ready()), holds, start, delayMs: 1400 })
    vi.advanceTimersByTime(1000)
    holds.set(1)
    vi.advanceTimersByTime(5000)
    expect(start).not.toHaveBeenCalled()
    holds.set(0)
    vi.advanceTimersByTime(1399)
    expect(start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('the disposer cancels a pending start', () => {
    const start = vi.fn()
    const dispose = armFirstRunTrigger({ scope: source(ready()), holds: source(0), start, delayMs: 1400 })
    dispose()
    vi.advanceTimersByTime(5000)
    expect(start).not.toHaveBeenCalled()
  })
})

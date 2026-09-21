// @vitest-environment jsdom
// The bar's read model: the poll loop with the configured cadence, the error
// path that keeps the last roster, the SSE hurry-up debounce, a selection
// change refreshing at once (and a project change dropping the old roster),
// and stop() silencing every late arrival.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rosterUrl, startAskbarStore } from '../src/client/askbar-store.ts'
import { closeBridgeFeed } from '../src/client/bridge-feed.ts'
import type { AskbarRoster } from '../src/types.ts'

const ROSTER: AskbarRoster = {
  project: '/work/demo',
  config: { edge: 'right', hoverRevealMs: 150, pendingSendMs: 1000, transformMs: 200, pollMs: 5000 },
  chips: [],
}

const DEMO = { project: '/work/demo', sessionIds: ['s-juno', 's-nova'] }
const DEMO_URL = '/idealize/askbar/roster?project=%2Fwork%2Fdemo&sessions=s-juno%2Cs-nova'

/** EventSource stand-in: records listeners and closes, dispatches on demand. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners: (() => void)[] = []
  closed = false
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener)
  }

  close(): void {
    this.closed = true
  }

  onmessage: ((message: { data: string }) => void) | null = null
  private seq = 0

  emit(): void {
    this.seq += 1
    this.onmessage?.({ data: JSON.stringify({ seq: this.seq, kind: 'agent-finished' }) })
    for (const listener of this.listeners) listener()
  }
}

function ok(roster: AskbarRoster = ROSTER) {
  return { ok: true, json: async () => roster }
}

/** How many times the roster was read; the window's one bridge feed read is not the store's. */
function rosterReads(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter(call => String(call[0]).startsWith('/idealize/askbar/roster')).length
}

/** Stub fetch so the window's bridge feed read answers an empty tail and every other read reaches `mock`. */
function stubFetch(mock: (...args: unknown[]) => unknown): void {
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => input.startsWith('/idealize/events/')
    ? Promise.resolve({ ok: true, json: async () => [] })
    : (init === undefined ? mock(input) : mock(input, init)))
}

afterEach(() => {
  closeBridgeFeed()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeEventSource.instances = []
})

describe('rosterUrl', () => {
  it('carries the project and its sidebar rows, and only the project when none exists', () => {
    expect(rosterUrl(DEMO)).toBe(DEMO_URL)
    expect(rosterUrl({ project: '/work/demo', sessionIds: [] })).toBe('/idealize/askbar/roster?project=%2Fwork%2Fdemo&sessions=')
    expect(rosterUrl({ project: '', sessionIds: [] })).toBe('/idealize/askbar/roster?project=')
    // The grouped read rides the same query, with the rows still named.
    expect(rosterUrl(DEMO, true)).toBe(`${DEMO_URL}&all=1`)
    expect(rosterUrl({ project: '', sessionIds: [] }, true)).toBe('/idealize/askbar/roster?project=&all=1')
  })
})

describe('startAskbarStore', () => {
  it('waits while the window is hidden and reads at once when it shows again', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(ok())
    stubFetch(fetchMock)
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const { stop } = startAskbarStore(DEMO)
    await vi.advanceTimersByTimeAsync(0)
    expect(rosterReads(fetchMock)).toBe(1)
    visibility.mockReturnValue('hidden')
    await vi.advanceTimersByTimeAsync(15000)
    expect(rosterReads(fetchMock)).toBe(1)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(rosterReads(fetchMock)).toBe(2)
    stop()
    visibility.mockRestore()
  })

  it('publishes a poll only when the roster changed', async () => {
    vi.useFakeTimers()
    const changed: AskbarRoster = { ...ROSTER, config: { ...ROSTER.config, edge: 'left' } }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ ...ROSTER }))
      .mockResolvedValueOnce(ok({ ...ROSTER }))
      .mockResolvedValue(ok(changed))
    stubFetch(fetchMock)
    const { store, stop } = startAskbarStore(DEMO)
    await vi.advanceTimersByTimeAsync(0)
    const first = store.getSnapshot()
    await vi.advanceTimersByTimeAsync(5000)
    expect(rosterReads(fetchMock)).toBe(2)
    expect(store.getSnapshot()).toBe(first)
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.getSnapshot().roster).toEqual(changed)
    stop()
  })

  it('reads the roster for the selection, then polls at the configured cadence', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(ok())
    stubFetch(fetchMock)
    const { store, stop } = startAskbarStore(DEMO)
    expect(store.getSnapshot()).toEqual({ project: '/work/demo', roster: null, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledWith(DEMO_URL)
    expect(store.getSnapshot()).toEqual({ project: '/work/demo', roster: ROSTER, error: null })
    await vi.advanceTimersByTimeAsync(5000)
    expect(rosterReads(fetchMock)).toBe(2)
    stop()
  })

  it('records a failed read and keeps polling at the boot cadence', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockRejectedValueOnce('socket gone')
      .mockResolvedValue(ok())
    stubFetch(fetchMock)
    const { store, stop } = startAskbarStore(DEMO)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ project: '/work/demo', roster: null, error: 'roster read failed: 500' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.getSnapshot().error).toBe('socket gone')
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.getSnapshot()).toEqual({ project: '/work/demo', roster: ROSTER, error: null })
    stop()
  })

  it('hurries one refresh per debounce window on SSE events, and not after stop', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(ok())
    stubFetch(fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
    const { stop } = startAskbarStore(DEMO)
    await vi.advanceTimersByTimeAsync(0)
    expect(rosterReads(fetchMock)).toBe(1)
    const stream = FakeEventSource.instances[0]
    if (stream === undefined) throw new Error('no stream opened')
    expect(stream.url).toBe('/idealize/events/stream?since=0')
    stream.emit()
    stream.emit()
    await vi.advanceTimersByTimeAsync(150)
    expect(rosterReads(fetchMock)).toBe(2)
    stop()
    expect(stream.closed).toBe(true)
    stream.emit()
    await vi.advanceTimersByTimeAsync(150)
    expect(rosterReads(fetchMock)).toBe(2)
  })

  it('follows a new selection at once: same project keeps the roster, a new project drops it', async () => {
    vi.useFakeTimers()
    const other: AskbarRoster = { ...ROSTER, project: '/work/other' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValue(ok(other))
    stubFetch(fetchMock)
    const { store, select, stop } = startAskbarStore(DEMO)
    await vi.advanceTimersByTimeAsync(0)
    // An unchanged selection is a no-op; a new row set refreshes without clearing.
    select({ project: '/work/demo', sessionIds: ['s-juno', 's-nova'] })
    await vi.advanceTimersByTimeAsync(150)
    expect(rosterReads(fetchMock)).toBe(1)
    select({ project: '/work/demo', sessionIds: ['s-juno'] })
    expect(store.getSnapshot().roster).toEqual(ROSTER)
    await vi.advanceTimersByTimeAsync(150)
    expect(fetchMock).toHaveBeenLastCalledWith('/idealize/askbar/roster?project=%2Fwork%2Fdemo&sessions=s-juno')
    // A new project clears the view until its roster lands.
    select({ project: '/work/other', sessionIds: [] })
    expect(store.getSnapshot()).toEqual({ project: '/work/other', roster: null, error: null })
    await vi.advanceTimersByTimeAsync(150)
    expect(store.getSnapshot()).toEqual({ project: '/work/other', roster: other, error: null })
    stop()
    select({ project: '/work/third', sessionIds: [] })
    expect(store.getSnapshot().project).toBe('/work/other')
  })

  it('drops a read that lands for a superseded selection', async () => {
    vi.useFakeTimers()
    let release: (value: { ok: boolean; json: () => Promise<AskbarRoster> }) => void = () => {}
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
      .mockRejectedValueOnce(new Error('late failure'))
      .mockResolvedValue(ok({ ...ROSTER, project: '/work/other' }))
    stubFetch(fetchMock)
    const { store, select, stop } = startAskbarStore(DEMO)
    select({ project: '/work/other', sessionIds: [] })
    release(ok())
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().roster).toBeNull()
    // The superseded failure is dropped too; the selection's own read then lands.
    await vi.advanceTimersByTimeAsync(150)
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.getSnapshot()).toEqual({ project: '/work/other', roster: { ...ROSTER, project: '/work/other' }, error: null })
    stop()
  })

  it('ignores a read that lands after stop', async () => {
    vi.useFakeTimers()
    let release: (value: { ok: boolean; json: () => Promise<AskbarRoster> }) => void = () => {}
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { release = resolve }))
    stubFetch(fetchMock)
    const { store, stop } = startAskbarStore(DEMO)
    stop()
    release(ok())
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ project: '/work/demo', roster: null, error: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a failure that lands after stop', async () => {
    vi.useFakeTimers()
    let refuse: (reason: Error) => void = () => {}
    const fetchMock = vi.fn().mockReturnValue(new Promise((_resolve, reject) => { refuse = reject }))
    stubFetch(fetchMock)
    const { store, stop } = startAskbarStore(DEMO)
    stop()
    refuse(new Error('too late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ project: '/work/demo', roster: null, error: null })
  })
})

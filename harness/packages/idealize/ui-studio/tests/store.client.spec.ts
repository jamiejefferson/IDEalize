// @vitest-environment jsdom
/**
 * The store's sync against the overview route: every project lands in one
 * read, a failure keeps stale data visible under its cause, and a slow
 * response superseded by a newer one is dropped rather than written. Plus the
 * two records the pane holds beside it: where the person has read to, and the
 * event an opened alert asks the view to land on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStudioStore } from '../src/client/store.ts'
import type { EventRow, ProjectView, StateResponse } from '../src/client/studio-model.ts'

const FOLD: StateResponse = { tasks: [], agents: {}, deliveries: {}, presence: {} }

const row = (project: string, seq: number): EventRow => ({
  id: `se-${String(seq)}`, seq, at: '2026-09-01T10:00:00.000Z', project, author: 'user', kind: 'message',
})

const project = (path: string, seqs: number[]): ProjectView => ({
  project: path, lastSeq: seqs.at(-1) ?? 0, state: FOLD, recent: seqs.map(seq => row(path, seq)),
})

/** One fetch stub answering the overview route. */
function answer(projects: ProjectView[]) {
  return vi.fn(async (_url: string | URL) => new Response(JSON.stringify({ projects }), { status: 200 }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('the Studio store', () => {
  it('reads every project in one overview call', async () => {
    const store = createStudioStore()
    const fetchStub = answer([project('/a', [1, 2]), project('/b', [1])])
    vi.stubGlobal('fetch', fetchStub)
    expect(store.state.getSnapshot().loading).toBe(true)
    await store.sync()
    expect(String(fetchStub.mock.calls[0]?.[0])).toBe('/idealize/studio/overview')
    const snapshot = store.state.getSnapshot()
    expect(snapshot.projects.map(view => [view.project, view.recent.length])).toEqual([['/a', 2], ['/b', 1]])
    expect(snapshot.loaded).toBe(true)
    expect(snapshot.loading).toBe(false)
  })

  it('keeps stale data visible under a failure and recovers on the next tick', async () => {
    const store = createStudioStore()
    vi.stubGlobal('fetch', answer([project('/a', [1])]))
    await store.sync()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })))
    await store.sync()
    const failed = store.state.getSnapshot()
    expect(failed.error).toContain('500')
    expect(failed.projects).toHaveLength(1)
    vi.stubGlobal('fetch', answer([project('/a', [1, 2])]))
    await store.sync()
    expect(store.state.getSnapshot().error).toBeNull()
    expect(store.state.getSnapshot().projects[0]?.recent).toHaveLength(2)
  })

  it('reads the stored read positions beside the overview', async () => {
    const store = createStudioStore()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => (
      String(url) === '/idealize/notify/attention'
        ? new Response(JSON.stringify({ read: { '/a': 2 }, notifications: [] }), { status: 200 })
        : new Response(JSON.stringify({ projects: [project('/a', [1, 2, 3])] }), { status: 200 })
    )))
    await store.sync()
    expect(store.state.getSnapshot().read).toEqual({ '/a': 2 })
  })

  it('reads everything as unread when no ledger answers', async () => {
    const store = createStudioStore()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => (
      String(url) === '/idealize/notify/attention'
        ? new Response('no route', { status: 404 })
        : new Response(JSON.stringify({ projects: [project('/a', [1])] }), { status: 200 })
    )))
    await store.sync()
    expect(store.state.getSnapshot().read).toEqual({})
    // An unreachable host answers the same way: no record says it was read.
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      if (String(url) === '/idealize/notify/attention') throw new Error('offline')
      return new Response(JSON.stringify({ projects: [project('/a', [1])] }), { status: 200 })
    }))
    await store.sync()
    expect(store.state.getSnapshot().read).toEqual({})
  })

  it('moves a read position forward only, and records it once', async () => {
    const store = createStudioStore()
    const calls: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(init.body as string) })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
    await store.markRead('/a', 4)
    expect(store.state.getSnapshot().read).toEqual({ '/a': 4 })
    await store.markRead('/a', 3)
    await store.markRead('/a', 4)
    expect(calls.filter(call => call.url === '/idealize/notify/attention/read')).toEqual([
      { url: '/idealize/notify/attention/read', body: { project: '/a', seq: 4 } },
    ])
  })

  it('keeps the position it showed when the host refuses the write', async () => {
    const store = createStudioStore()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await store.markRead('/a', 2)
    expect(store.state.getSnapshot().read).toEqual({ '/a': 2 })
  })

  it('holds one focus target until the view takes it', () => {
    const store = createStudioStore()
    expect(store.takeFocus()).toBeNull()
    store.focus('se-9')
    expect(store.state.getSnapshot().focus).toBe('se-9')
    expect(store.takeFocus()).toBe('se-9')
    expect(store.takeFocus()).toBeNull()
  })

  it('drops a slow response superseded by a newer read', async () => {
    const store = createStudioStore()
    let releaseSlow: (() => void) | undefined
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        await slow
        return new Response(JSON.stringify({ projects: [project('/slow', [9])] }), { status: 200 })
      }
      return new Response(JSON.stringify({ projects: [project('/fast', [1])] }), { status: 200 })
    }))
    const slowSync = store.sync()
    await store.sync()
    releaseSlow?.()
    await slowSync
    expect(store.state.getSnapshot().projects.map(view => view.project)).toEqual(['/fast'])
  })
})

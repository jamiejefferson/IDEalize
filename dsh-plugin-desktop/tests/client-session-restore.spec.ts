// Session survival across the mode-change restart: the client half records
// the selection on the Host's view-state route and re-opens the recorded
// session on boot, without ever overriding a live selection.
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installSessionRestore } from '../src/client/session-restore.ts'

interface ListState {
  current: string | undefined
  byId: Record<string, object>
}

function sessionsDouble(init: ListState) {
  let state = init
  const listeners = new Set<() => void>()
  const opened: string[] = []
  const sessions = {
    open: (id: string) => { opened.push(id) },
    list: {
      getSnapshot: () => state,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
  }
  const set = (next: ListState): void => {
    state = next
    for (const fn of [...listeners]) fn()
  }
  return { ctx: { sessions } as unknown as ClientContext, set, opened }
}

function fetchDouble(stored: unknown) {
  const posts: unknown[] = []
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return { ok: true, json: async () => ({}) }
    }
    return { ok: true, json: async () => stored }
  }) as unknown as typeof globalThis.fetch
  return { request, posts }
}

const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('session restore across mode restarts', () => {
  it('re-opens the recorded session once the list carries it', async () => {
    const { ctx, set, opened } = sessionsDouble({ current: undefined, byId: {} })
    const { request } = fetchDouble({ sessionId: 'session-9' })
    installSessionRestore(ctx, request)
    await settle()
    expect(opened).toEqual([])

    set({ current: undefined, byId: { 'session-9': {} } })
    expect(opened).toEqual(['session-9'])

    // The restore fires once; later list refreshes do not re-open.
    set({ current: undefined, byId: { 'session-9': {} } })
    expect(opened).toEqual(['session-9'])
  })

  it('never overrides a selection that exists before the stored state arrives', async () => {
    const { ctx, opened } = sessionsDouble({ current: 'session-1', byId: { 'session-1': {} } })
    const { request, posts } = fetchDouble({ sessionId: 'session-9' })
    installSessionRestore(ctx, request)
    await settle()
    expect(opened).toEqual([])
    expect(posts).toEqual([{ sessionId: 'session-1' }])
  })

  it('records each selection change once', async () => {
    const { ctx, set } = sessionsDouble({ current: undefined, byId: {} })
    const { request, posts } = fetchDouble({})
    installSessionRestore(ctx, request)
    set({ current: 'session-1', byId: { 'session-1': {} } })
    set({ current: 'session-1', byId: { 'session-1': {} } })
    set({ current: 'session-2', byId: { 'session-2': {} } })
    await settle()
    expect(posts).toEqual([{ sessionId: 'session-1' }, { sessionId: 'session-2' }])
  })

  it('tolerates a failing route and a disposal before the response', async () => {
    const { ctx, set, opened } = sessionsDouble({ current: undefined, byId: {} })
    const failing = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof globalThis.fetch
    const dispose = installSessionRestore(ctx, failing)
    await settle()
    dispose()
    set({ current: undefined, byId: { 'session-9': {} } })
    expect(opened).toEqual([])
  })
})

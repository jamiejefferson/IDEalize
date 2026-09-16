// @vitest-environment jsdom
/**
 * The ring seeded from the space. The conversation header renders no tab row,
 * so the only thing that puts a chat onto its space's view is its `space`
 * projection, written once per chat per page into the SAME per-session store
 * instance the rendered ring reads (`hostFace().storeOf`, on the real
 * `createChatStore` and a real SlotRegistry).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { createSpaceSeed, type ErasedSlots, type SeedSessionList } from '../src/client/view-switch.ts'

// The chat store persists under its declared key; clear so one case's seeded
// view cannot rehydrate into the next.
beforeEach(() => { localStorage.clear() })

/** A real SlotRegistry with ui-conversation's chat entry, and optionally the Gallery entry, on the ring. */
async function ring(views: readonly string[] = ['gallery']) {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} },
    currentProvideInfo: () => undefined,
  } as never)
  ctx.provide('workspaces', {
    list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} },
  } as never)
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  }, (_p: { renderSlot?: unknown }) => null)
  slots.register(
    { name: 'conversation.view', id: 'chat', order: 0, store: createChatStore() } as never,
    (() => null) as never,
  )
  for (const [index, id] of views.entries()) {
    slots.register({ name: 'conversation.view', id, order: index + 1 } as never, (() => null) as never)
  }
  return { slots: slots as unknown as ErasedSlots, registry: slots }
}

/** The chat-store instance the rendered ring would read for one chat. */
function chatStore(slots: ErasedSlots, sessionId: string) {
  const entry = slots.entries('conversation.view').find(candidate => candidate.options.id === 'chat')!
  return slots.hostFace().storeOf(entry, sessionId)!
}

/** One session list whose current chat sits in `space`. */
function sessions(current: string | undefined, space: string | undefined) {
  const byId: Record<string, { projectionValues?: { space?: { space: string } } }> = {}
  if (current !== undefined) byId[current] = space === undefined ? {} : { projectionValues: { space: { space } } }
  return createSnapshotStore<SeedSessionList>({ current, byId })
}

/** Ring registration notifications are microtask-batched; one tick delivers them. */
const ringChanged = (): Promise<void> => new Promise((resolve) => { queueMicrotask(resolve) })

const view = (slots: ErasedSlots, id: string): string | null =>
  (chatStore(slots, id).getSnapshot() as { view: string | null }).view

describe('the ring seeded from the space', () => {
  it('puts the current chat onto its space\'s view with nothing remembered', async () => {
    const { slots } = await ring()
    const list = sessions('s1', 'gallery')
    const dispose = createSpaceSeed(slots, { list }).start()
    expect(view(slots, 's1')).toBe('gallery')
    dispose()
  })

  it('waits for the projection, then seeds when it lands', async () => {
    const { slots } = await ring()
    const list = sessions('s1', undefined)
    const dispose = createSpaceSeed(slots, { list }).start()
    expect(view(slots, 's1')).toBeNull()
    list.set({ current: 's1', byId: { s1: { projectionValues: { space: { space: 'gallery' } } } } })
    expect(view(slots, 's1')).toBe('gallery')
    dispose()
  })

  it('seeds once per chat: a later launch write on the same store is not fought', async () => {
    const { slots } = await ring()
    const list = sessions('s1', 'chat')
    const dispose = createSpaceSeed(slots, { list }).start()
    expect(view(slots, 's1')).toBe('chat')
    // The welcome card launches this chat into Gallery after the seed ran.
    chatStore(slots, 's1').actions.setView('gallery')
    list.set({ current: 's1', byId: { s1: { projectionValues: { space: { space: 'chat' } } } } })
    expect(view(slots, 's1')).toBe('gallery')
    dispose()
  })

  it('follows a launch rather than the space the projection still names', async () => {
    const { slots } = await ring()
    // A blank chat carrying an earlier launch's Gallery record.
    const list = sessions('s1', 'gallery')
    const seed = createSpaceSeed(slots, { list })
    const dispose = seed.start()
    expect(view(slots, 's1')).toBe('gallery')
    // The welcome card relaunches the same chat into Chat. The record reaches
    // the projection a beat later, so the list still says Gallery here.
    seed.noteLaunch('s1', 'chat')
    expect(view(slots, 's1')).toBe('chat')
    list.set({ current: 's1', byId: { s1: { projectionValues: { space: { space: 'gallery' } } } } })
    expect(view(slots, 's1')).toBe('chat')
    // The same answer the Studio card and the welcome card read: what this
    // page launched, not what the projection still says.
    expect(seed.launchedSpace('s1')).toBe('chat')
    expect(seed.launchedSpace('s2')).toBeUndefined()
    dispose()
  })

  it('places a launched chat whose ring entry arrives after the launch', async () => {
    const { slots, registry } = await ring([])
    const list = sessions('s1', 'chat')
    const seed = createSpaceSeed(slots, { list })
    const dispose = seed.start()
    seed.noteLaunch('s1', 'gallery')
    // The Gallery view is not on the ring yet, so the launch lands on Chat.
    expect(view(slots, 's1')).toBe('chat')
    registry.register({ name: 'conversation.view', id: 'gallery', order: 5 } as never, (() => null) as never)
    await ringChanged()
    expect(view(slots, 's1')).toBe('gallery')
    dispose()
  })

  it('lands a space whose view the ring does not serve here on Chat, and places it once that view registers', async () => {
    const { slots, registry } = await ring([])
    const list = sessions('s1', 'terminal')
    chatStore(slots, 's1').actions.setView('stale-view')
    const dispose = createSpaceSeed(slots, { list }).start()
    expect(view(slots, 's1')).toBe('chat')
    registry.register({ name: 'conversation.view', id: 'terminal', order: 5 } as never, (() => null) as never)
    await ringChanged()
    expect(view(slots, 's1')).toBe('terminal')
    dispose()
  })

  it('seeds each chat as it becomes current, and only the current one', async () => {
    const { slots } = await ring()
    const list = sessions('s1', 'gallery')
    const dispose = createSpaceSeed(slots, { list }).start()
    expect(view(slots, 's2')).toBeNull()
    list.set({
      current: 's2',
      byId: {
        s1: { projectionValues: { space: { space: 'gallery' } } },
        s2: { projectionValues: { space: { space: 'chat' } } },
      },
    })
    expect(view(slots, 's2')).toBe('chat')
    expect(view(slots, 's1')).toBe('gallery')
    dispose()
  })

  it('waits for the chat ring entry, retrying when the ring changes', async () => {
    const ctx = new Context()
    const bare = new SlotRegistry(ctx)
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} },
      currentProvideInfo: () => undefined,
    } as never)
    ctx.provide('workspaces', {
      list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} },
    } as never)
    bare.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    const slots = bare as unknown as ErasedSlots
    const list = sessions('s1', 'gallery')
    const dispose = createSpaceSeed(slots, { list }).start()
    bare.register(
      { name: 'conversation.view', id: 'chat', order: 0, store: createChatStore() } as never,
      (() => null) as never,
    )
    bare.register({ name: 'conversation.view', id: 'gallery', order: 1 } as never, (() => null) as never)
    await ringChanged()
    expect(view(slots, 's1')).toBe('gallery')
    dispose()
  })

  it('stops seeding once disposed', async () => {
    const { slots } = await ring()
    const list = sessions(undefined, undefined)
    const dispose = createSpaceSeed(slots, { list }).start()
    dispose()
    list.set({ current: 's1', byId: { s1: { projectionValues: { space: { space: 'gallery' } } } } })
    expect(view(slots, 's1')).toBeNull()
  })
})

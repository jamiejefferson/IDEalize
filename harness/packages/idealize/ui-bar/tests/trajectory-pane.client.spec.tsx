// @vitest-environment jsdom
/**
 * Trajectory as a rail pane, and the handoff that would otherwise be lost.
 *
 * A tool row's Inspect button writes `{callId}` into the chat's own store and
 * then asks the conversation ring for its `'trajectory'` entry. That entry left
 * the ring, and ui-conversation's own comment says an unregistered id is
 * "safe": the ring falls back to Chat and the click does nothing visible. So
 * ui-bar reads the store field instead — through the SAME per-session instance
 * the rendered chat reads (`hostFace().storeOf`), on the real
 * `createChatStore` and a real SlotRegistry, not a stand-in.
 *
 * The pane half is covered here too: which chat's ledger renders, that a chat
 * switch remounts it, and the statement shown with no chat open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { en } from '../src/client/locales.ts'
import { watchInspect, type ErasedSlots } from '../src/client/view-switch.ts'
import { TrajectoryPane, type TrajectoryHost } from '../src/client/TrajectoryPane.tsx'
// Type-only: the locale-namespace and slot-key merges the props types read.
import type {} from '../src/client/index.ts'

const t = makeTranslate(en, commonEn)
const SID = 's1' as SessionId

afterEach(cleanup)

/** A real SlotRegistry with ui-conversation's real chat store on the ring. */
async function ring() {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  // hostFace() is the render-side face: it refuses to build before the
  // runtime's own services are up, which in the app is guaranteed boot order.
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
  return { ctx, slots: slots as unknown as ErasedSlots, registry: slots }
}

/** The chat-store instance the rendered ring would read for one chat. */
function chatStore(slots: ErasedSlots, sessionId: string) {
  const entry = slots.entries('conversation.view').find(candidate => candidate.options.id === 'chat')!
  return slots.hostFace().storeOf(entry, sessionId)!
}

describe('the chat inspect handoff', () => {
  it('reports the requested call and clears the field, so one click fires once', async () => {
    const { slots } = await ring()
    const seen: string[] = []

    const dispose = watchInspect(slots, SID, (callId) => { seen.push(callId) })
    const store = chatStore(slots, SID)
    store.actions.setInspect({ callId: 'call-7' })

    expect(seen).toEqual(['call-7'])
    expect((store.getSnapshot() as { inspect: unknown }).inspect).toBeNull()

    // A later snapshot change on the same store must not replay the target.
    store.actions.setView('chat')
    expect(seen).toEqual(['call-7'])

    dispose?.()
  })

  it('reads the same store instance the rendered ring reads', async () => {
    const { slots } = await ring()
    const seen: string[] = []
    const dispose = watchInspect(slots, SID, (callId) => { seen.push(callId) })

    // A parallel instance minted by handle.create() is the failure this guards:
    // the write below goes through the framework's per-session cache, which is
    // what the ring renders from.
    chatStore(slots, SID).actions.setInspect({ callId: 'call-9' })

    expect(seen).toEqual(['call-9'])
    dispose?.()
  })

  it('watches per chat: another chat\'s inspect write is not this chat\'s', async () => {
    const { slots } = await ring()
    const seen: string[] = []
    const dispose = watchInspect(slots, SID, (callId) => { seen.push(callId) })

    chatStore(slots, 's2').actions.setInspect({ callId: 'call-elsewhere' })

    expect(seen).toEqual([])
    dispose?.()
  })

  it('declines to watch until the chat ring entry is registered', async () => {
    const ctx = new Context()
    const bare = new SlotRegistry(ctx)
    bare.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)

    expect(watchInspect(bare as unknown as ErasedSlots, SID, vi.fn())).toBeUndefined()
  })

  it('stops reporting once disposed', async () => {
    const { slots } = await ring()
    const seen: string[] = []
    const dispose = watchInspect(slots, SID, (callId) => { seen.push(callId) })
    dispose?.()

    chatStore(slots, SID).actions.setInspect({ callId: 'call-after-dispose' })

    expect(seen).toEqual([])
  })
})

/** A stand-in ledger recording the props the pane hands it. */
function host() {
  const seen: { sessionId: string; inspect: unknown }[] = []
  const mounts: string[] = []
  const Component = vi.fn(({ sessionId, inspect }: { sessionId: string; inspect: unknown }) => {
    seen.push({ sessionId, inspect })
    return <div data-testid="ledger">{sessionId}</div>
  }) as unknown as TrajectoryHost['Component']
  const trajectoryHost: TrajectoryHost = {
    Component,
    face: sessionId => (sessionId === 'missing'
      ? undefined
      : { sessionId, mounts } as never),
  }
  return { trajectoryHost, seen, mounts }
}

describe('TrajectoryPane', () => {
  it('renders the ledger for the current chat with its inspect target', () => {
    const { trajectoryHost, seen } = host()
    const view = render(
      <TrajectoryPane
        host={trajectoryHost}
        sessionId={SID}
        inspect={{ callId: 'call-3' }}
        onInspectDone={vi.fn()}
        t={t}
      />,
    )

    expect(view.getByTestId('ledger').textContent).toBe(SID)
    expect(view.container.querySelector(`[data-trajectory-pane="${SID}"]`)).toBeTruthy()
    expect(seen).toEqual([{ sessionId: SID, inspect: { callId: 'call-3' } }])
  })

  it('states the no-chat case rather than rendering an empty ledger', () => {
    const { trajectoryHost } = host()
    const view = render(
      <TrajectoryPane
        host={trajectoryHost}
        sessionId={undefined}
        inspect={null}
        onInspectDone={vi.fn()}
        t={t}
      />,
    )

    expect(view.queryByTestId('ledger')).toBeNull()
    expect(view.getByText('Open a chat to see its trajectory.')).toBeTruthy()
  })

  it('states the no-chat case while the chat has no binding yet', () => {
    const { trajectoryHost } = host()
    const view = render(
      <TrajectoryPane
        host={trajectoryHost}
        sessionId={'missing' as SessionId}
        inspect={null}
        onInspectDone={vi.fn()}
        t={t}
      />,
    )

    expect(view.queryByTestId('ledger')).toBeNull()
    expect(view.getByText('Open a chat to see its trajectory.')).toBeTruthy()
  })

  it('remounts the ledger per chat, so folds and search never carry across', () => {
    const { trajectoryHost } = host()
    const mounted = createSnapshotStore<string[]>([])
    const Component = ((props: { sessionId: string }) => {
      // A mount counter is the only way to see a remount from outside.
      mounted.set([...mounted.getSnapshot(), props.sessionId])
      return <div data-testid="ledger">{props.sessionId}</div>
    }) as unknown as TrajectoryHost['Component']
    const pane = (sessionId: SessionId) => (
      <TrajectoryPane
        host={{ ...trajectoryHost, Component }}
        sessionId={sessionId}
        inspect={null}
        onInspectDone={vi.fn()}
        t={t}
      />
    )
    const view = render(pane(SID))
    view.rerender(pane('s2' as SessionId))

    expect(mounted.getSnapshot()).toEqual([SID, 's2'])
    expect(view.getByTestId('ledger').textContent).toBe('s2')
  })
})

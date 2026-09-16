// @vitest-environment jsdom
// Composition, two homes: in the Askbar window (the URL marker) apply marks
// the page, takes the root slot with the locale seat, polls the roster for
// every row the expanded sidebar lists (grouped by project), and follows the
// session store as the main window moves; in every other window it leaves
// the page untouched and seats the rail in the sidebar's `sidebar.rail` slot
// once the sidebar declares it, with a chip opening its chat through the
// sessions store and the Studio entry raising the in-window request.
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply } from '../src/client/index.ts'
import type { SelectionSessions, SelectionWorkspaces } from '../src/client/selection.ts'
import type { SidebarRailInjected } from '../src/client/SidebarRail.tsx'
import { onStudioRequest } from '../src/client/studio-request.ts'

const DEMO = { workspaceId: 'ws-demo', path: '/work/demo', sessionIds: ['s-juno', 's-nova'] }
const OTHER = { workspaceId: 'ws-other', path: '/work/other', sessionIds: ['s-rye'] }

function sessionsOf(current: string | undefined, ids: string[]): SelectionSessions {
  return { current, ids, byId: Object.fromEntries(ids.map(id => [id, { blank: false, updatedAt: 1 }])) }
}

/** One catalogue row a fake keybinds service took. */
interface TakenBind { id: string; label: string; chords: readonly { key: string; modifiers: readonly string[] }[]; run: () => void }

async function bench(
  search: string,
  sessions0: SelectionSessions = sessionsOf('s-juno', ['s-juno', 's-nova', 's-rye']),
  workspaces0: SelectionWorkspaces = { items: [DEMO, OTHER], archivedSessionIds: [] },
  options: { declareRail?: boolean; chips?: unknown[]; keybinds?: boolean } = {},
) {
  window.history.replaceState(null, '', `/${search}`)
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ project: '/work/demo', config: { edge: 'right', hoverRevealMs: 150, pendingSendMs: 1000, transformMs: 200, pollMs: 60_000 }, chips: options.chips ?? [] }) })
  vi.stubGlobal('fetch', fetchMock)
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const sessions = createSnapshotStore(sessions0)
  const workspaces = createSnapshotStore(workspaces0)
  const open = vi.fn()
  ctx.provide('sessions', { list: sessions, open } as never)
  ctx.provide('workspaces', { list: workspaces } as never)
  const binds: TakenBind[] = []
  if (options.keybinds === true) {
    ctx.provide('keybinds', {
      register: (binding: TakenBind) => {
        binds.push(binding)
        return () => { binds.splice(binds.indexOf(binding), 1) }
      },
    } as never)
  }
  const slots = ctx.get('slots') as SlotRegistry
  // The main window's sidebar declares the seat; the root's shell stands in for it here.
  if (options.declareRail === true) {
    slots.register({ name: 'root', children: { 'sidebar.rail': { kind: 'single', scope: 'root' } } } as never, () => null)
  }
  await ctx.plugin({ name: 'idealize-askbar-client', inject: ['slots', 'locale', 'sessions', 'workspaces'], apply })
  await new Promise(resolve => setTimeout(resolve, 0))
  return { ctx, slots, fetchMock, sessions, workspaces, open, binds }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('askbar client apply', () => {
  it('outside the Askbar window it leaves the page alone, takes no root, and waits for a sidebar to declare the rail seat', async () => {
    const { ctx, fetchMock } = await bench('?dsh-desktop-mode=mini')
    expect(document.body.dataset['dshDesktopMode']).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect((ctx.get('slots') as SlotRegistry).entriesOfSlot('root')).toHaveLength(0)
    // The copy is registered for both homes.
    expect((ctx.get('locale') as LocaleRuntime).bind('idealize-askbar')('studio.openHere')).toBe('Studio — open it')
  })

  it('in the main window it seats the rail once the sidebar declares the seat, polling the roster for the current project’s rows', async () => {
    const { ctx, slots, fetchMock, open } = await bench('', undefined, undefined, { declareRail: true })
    expect(document.body.dataset['dshDesktopMode']).toBeUndefined()
    expect(slots.entriesOfSlot('root')).toHaveLength(1)
    const entry = slots.entriesOfSlot('sidebar.rail')[0]
    expect(entry?.locale).toBe('idealize-askbar')
    // The same read the floating bar makes: every project's rows in the
    // sidebar's order, grouped (JJ, 13 Sep 2026: one set of agents in all
    // three sidebar states).
    expect(fetchMock).toHaveBeenCalledWith('/idealize/askbar/roster?project=%2Fwork%2Fdemo&sessions=s-juno%2Cs-nova%2Cs-rye&all=1')
    const injected = (entry?.inject as unknown as () => SidebarRailInjected)()
    expect(injected.store.getSnapshot().project).toBe('/work/demo')
    // A chip opens its chat through the sessions store.
    injected.openSession('s-nova')
    expect(open).toHaveBeenCalledWith('s-nova')
    // The Studio entry raises the in-window request the bar's client answers.
    const requested = vi.fn()
    const off = onStudioRequest(requested)
    injected.openStudio()
    expect(requested).toHaveBeenCalledOnce()
    off()
    // Dispose stops following and unseats the rail.
    vi.useFakeTimers()
    await ctx.fiber.dispose()
    expect(slots.entriesOfSlot('sidebar.rail')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('marks the Askbar window, registers its copy, and polls the roster for every project’s rows', async () => {
    const { ctx, fetchMock } = await bench('?dsh-desktop-mode=askbar')
    expect(document.body.dataset['dshDesktopMode']).toBe('askbar')
    expect(fetchMock).toHaveBeenCalledWith('/idealize/askbar/roster?project=%2Fwork%2Fdemo&sessions=s-juno%2Cs-nova%2Cs-rye&all=1')
    const slots = ctx.get('slots') as SlotRegistry
    const entry = slots.entriesOfSlot('root')[0]
    expect(entry?.locale).toBe('idealize-askbar')
    const injected = entry?.inject?.() as { store: { getSnapshot: () => { project: string } } } | undefined
    expect(injected?.store.getSnapshot().project).toBe('/work/demo')
    expect((ctx.get('locale') as LocaleRuntime).bind('idealize-askbar')('studio.title')).toBe('Studio')
    await ctx.fiber.dispose()
    expect(document.body.dataset['dshDesktopMode']).toBeUndefined()
  })

  it('follows the main window to another project, keeping every row, and stops following on dispose', async () => {
    const { ctx, fetchMock, sessions } = await bench('?dsh-desktop-mode=askbar')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    sessions.set(sessionsOf('s-rye', ['s-juno', 's-nova', 's-rye']))
    await vi.advanceTimersByTimeAsync(150)
    // The rows are the same set; only the project the panel names moves.
    expect(fetchMock).toHaveBeenLastCalledWith('/idealize/askbar/roster?project=%2Fwork%2Fother&sessions=s-juno%2Cs-nova%2Cs-rye&all=1')
    await ctx.fiber.dispose()
    sessions.set(sessionsOf('s-juno', ['s-juno', 's-nova', 's-rye']))
    await vi.advanceTimersByTimeAsync(150)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('walks the rail on ⌥⌘↑ / ⌥⌘↓ and on ⇧↑ / ⇧↓, wrapping at both ends', async () => {
    const chips = [
      { id: 's-juno', name: 'Juno', state: 'idle', unread: 0 },
      { id: 's-nova', name: 'Nova', state: 'idle', unread: 0 },
      { id: 's-rye', name: 'Rye', state: 'idle', unread: 0 },
    ]
    const { ctx, binds, open, sessions } = await bench('', undefined, undefined, { declareRail: true, chips, keybinds: true })
    expect(binds.map(bind => bind.id)).toEqual(['idealize.agentNext', 'idealize.agentPrevious'])
    // Both chords per row: one that survives a focused composer, one for everywhere else.
    expect(binds[0]?.chords).toEqual([
      { key: 'ArrowDown', modifiers: ['alt', 'meta'] },
      { key: 'ArrowDown', modifiers: ['shift'] },
    ])
    expect(binds[0]?.label).toBe('Next agent')
    binds[0]?.run()
    expect(open).toHaveBeenLastCalledWith('s-nova')
    // The current chat is the first row, so stepping back wraps to the last.
    binds[1]?.run()
    expect(open).toHaveBeenLastCalledWith('s-rye')
    // Opening a blank chat can leave the runtime on a session the roster does
    // not name (the reuse scan mints a fresh one); the walk carries on from
    // where it was rather than restarting at the top.
    sessions.set(sessionsOf('s-minted', ['s-juno', 's-nova', 's-rye']))
    binds[0]?.run()
    expect(open).toHaveBeenLastCalledWith('s-juno')
    binds[0]?.run()
    expect(open).toHaveBeenLastCalledWith('s-nova')
    // Dispose takes both rows off the catalogue.
    await ctx.fiber.dispose()
    expect(binds).toHaveLength(0)
  })

  it('carries no shortcut where no keybind catalogue is mounted', async () => {
    const { binds } = await bench('', undefined, undefined, { declareRail: true })
    expect(binds).toHaveLength(0)
  })

  it('polls with an empty project when no session or workspace names a folder', async () => {
    const { fetchMock } = await bench('?dsh-desktop-mode=askbar', sessionsOf(undefined, []), { items: [], archivedSessionIds: [] })
    expect(fetchMock).toHaveBeenCalledWith('/idealize/askbar/roster?project=&all=1')
  })
})

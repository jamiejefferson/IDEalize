/**
 * The composition bench the apply specs share: every service `inject` names,
 * stubbed to the shape the plugin body reads, plus the frame's slot
 * declarations the rail, drawer and deck registrations wait for.
 */
import { Context } from '@deepseek-ai/cordis'
import { vi } from 'vitest'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

/** What the bench's session and workspace lists report; empty by default. */
export interface BenchWorld {
  sessions?: { current?: string; ids: string[]; byId: Record<string, { id: string; cwd?: string }> }
  workspaces?: { items: { workspaceId: string; path: string; sessionIds: string[] }[]; archivedSessionIds: string[] }
}

/**
 * Boot a Context carrying every service the plugin injects.
 * @param world - what the session and workspace lists report.
 * @returns the context, its slot registry, and the spies the specs assert on.
 */
export async function bench(world: BenchWorld = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  // Typed spies: the bench is exported, so its inferred type must name only
  // vitest's public `Mock`, which a bare `vi.fn()` does not.
  const layout = {
    toggleSidebar: vi.fn<() => void>(),
    openDetails: vi.fn<() => void>(),
    closeDetails: vi.fn<() => void>(),
    openDrawer: vi.fn<() => void>(),
    closeDrawer: vi.fn<() => void>(),
    openDeck: vi.fn<() => void>(),
    closeDeck: vi.fn<() => void>(),
  }
  ctx.provide('layout', layout as never)
  const sessions = world.sessions ?? { ids: [], byId: {} }
  ctx.provide('sessions', {
    list: { getSnapshot: () => sessions, subscribe: () => () => {} },
    open: vi.fn(),
    binding: () => undefined,
  } as never)
  // Ordered against the brain write below, so a test can prove the marker is
  // set before the write rather than after the projection it produces.
  const order: string[] = []
  const lift = vi.fn(() => { order.push('lift') })
  const noteSessionConfigured = vi.fn(() => { order.push('note'); return lift })
  const workspaces = world.workspaces ?? { items: [], archivedSessionIds: [] }
  ctx.provide('workspaces', {
    list: { getSnapshot: () => workspaces, subscribe: () => () => {} },
    create: vi.fn(),
    connectWorkspace: vi.fn(),
    noteSessionConfigured,
  } as never)
  // The launcher's closures live behind ctx.inject(['activityPills']); without
  // this seat the whole hero-launcher block never runs.
  ctx.provide('activityPills', {
    face: () => ({
      load: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => Promise.resolve()),
      hooks: { activityPills: { getSnapshot: () => ({ pills: [], error: null }), subscribe: () => () => {} } },
    }),
  } as never)
  ctx.provide('modelsSettingsSection', { Component: () => null, face: () => ({}) } as never)
  ctx.provide('trajectorySection', { Component: () => null, face: () => undefined } as never)
  ctx.provide('scheduleSection', { Component: () => null, face: () => ({}) } as never)
  ctx.provide('studioSection', {
    Component: () => null,
    face: () => ({}),
    store: { state: createSnapshotStore({ project: null, state: null, error: null }), sync: vi.fn() },
  } as never)
  const appearanceStore = createSnapshotStore({ open: false })
  const appearance = {
    open: vi.fn(() => { appearanceStore.update((draft) => { draft.open = true }) }),
    close: vi.fn(() => { appearanceStore.update((draft) => { draft.open = false }) }),
    toggle: vi.fn<() => void>(),
    isOpen: () => appearanceStore.getSnapshot().open,
    Component: () => null,
    face: () => ({ hooks: {} }),
    store: appearanceStore,
  }
  ctx.provide('appearance', appearance as never)
  ctx.provide('conversation', {
    input: {
      for: () => ({
        state: { getSnapshot: () => ({ draft: '' }), subscribe: () => () => {} },
        setDraft: vi.fn(),
      }),
    },
  } as never)
  // The welcome card's media launch writes the chat's agent preset through
  // the api client, so the bench serves a connection.
  const agentPresets = { select: vi.fn(() => { order.push('select'); return Promise.resolve({ result: { ok: false } }) }) }
  ctx.provide('connection', { api: { agentPresets } } as never)
  const commands = { execute: vi.fn() }
  ctx.provide('remote', { commands } as never)
  ctx.provide('remote.commands', commands as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, layout, appearance, appearanceStore, order, lift, noteSessionConfigured, agentPresets }
}

/** The frame's declarations, which the rail/drawer/deck registrations wait for. */
export function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.rail': { kind: 'single', scope: 'root' },
      'shell.drawer': { kind: 'single', scope: 'root' },
      'shell.deck': { kind: 'single', scope: 'root' },
      'settings.trigger': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
      'conversation.hero.launcher': { kind: 'single', scope: 'session' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

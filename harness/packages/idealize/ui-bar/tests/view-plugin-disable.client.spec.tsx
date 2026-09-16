// @vitest-environment jsdom
/**
 * AC-02, on the view side: disabling one mode plugin removes its contribution
 * and leaves the rest of the app working.
 *
 * The Gallery and Sound Stage client plugins are mounted for real on a real
 * SlotRegistry beside a stand-in chat ring entry. Disposing the Gallery fiber
 * is what disabling its row does at runtime, so its ring seat and its composer
 * dock entry must both go while Sound Stage and Chat keep theirs.
 *
 * The welcome card is rendered alongside, because the space roster is now
 * DECLARED rather than derived from the ring: a space whose view package is
 * gone keeps its tile, with its brain count, and says what is missing on the
 * brain step. That is the rule the ring can no longer break.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ConversationEventRegistry, ConversationViewRegistry, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SpaceRosterEntry } from '@idealize/spaces/client'
import * as Gallery from '@idealize/ui-gallery/src/client/index.ts'
import * as Soundstage from '@idealize/ui-soundstage/src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { HeroLauncher } from '../src/client/HeroLauncher.tsx'
import type { HeroLauncherInjected, HeroLauncherProps } from '../src/client/HeroLauncher.tsx'
// Type-only: the locale-namespace and slot-key merges the props type reads.
import type {} from '../src/client/index.ts'

const t: HeroLauncherProps['t'] = makeTranslate(en, commonEn)
const unused = (() => undefined) as unknown as HeroLauncherProps['useSessions'] & HeroLauncherProps['useWorkspaces']

/** The roster the host serves, unchanged by anything the ring does. */
const ROSTER: SpaceRosterEntry[] = [
  { id: 'chat', brainCount: 1, brains: [{ id: 'coding', name: 'Coding', default: true }], models: 'some' },
  { id: 'terminal', brainCount: 1, brains: [{ id: 'coding', name: 'Coding', default: true }], models: 'some' },
  { id: 'gallery', brainCount: 1, brains: [{ id: 'gallery', name: 'Gallery', default: true }], models: 'some' },
  { id: 'soundstage', brainCount: 1, brains: [{ id: 'soundstage', name: 'Sound Stage', default: true }], models: 'some' },
  { id: 'motion', brainCount: 0, brains: [], models: 'none', reason: 'no-backend', recovery: 'No generation backend is running.' },
]

afterEach(cleanup)

/** A client root carrying the services the two view plugins inject. */
async function mountHost() {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()
  slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
    },
  }, (_p: { renderSlot?: unknown }) => null)
  ctx.provide('sessions', { binding: () => undefined })
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const locale = await import('@deepseek-ai/dsh-client-locale/client')
  await ctx.plugin({ inject: [...locale.inject], apply: locale.apply }).await()
  // ui-conversation's own chat ring entry: the seat the media settings rows
  // share their store with.
  slots.register(
    { name: 'conversation.view', id: 'chat', order: 0, store: { scope: 'session' } } as never,
    (() => null) as never,
  )
  return { ctx, slots }
}

/** The welcome card over the declared roster. */
function renderLauncher() {
  const injected: HeroLauncherInjected = {
    currentSession: () => ({ id: 's1', blank: true }),
    spaces: {
      load: () => Promise.resolve(ROSTER),
      access: () => Promise.resolve({}),
      terminalLaunches: () => Promise.resolve(undefined),
      enter: () => Promise.resolve(true),
      addBrain: vi.fn(),
      addKey: vi.fn(),
      signIn: vi.fn(),
    },
  }
  const props = {
    projectRow: <span>idealize-v1</span>,
    projectOpen: true,
    recentProjects: null,
    onNewProject: vi.fn(),
    onFindProject: vi.fn(),
    t,
    ...injected,
    useSessions: unused,
    useWorkspaces: unused,
  } as unknown as HeroLauncherProps
  return render(<HeroLauncher {...props} />)
}

/** The tiles the card currently offers, in row order. */
function tiles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-space]')].map(node => node.getAttribute('data-space') ?? '')
}

// The host mount imports the locale runtime dynamically; under coverage
// instrumentation that first import outruns the 5 s default (pre-existing flake, 8 Sep 2026).
describe('AC-02: disabling a mode plugin removes its contribution', { timeout: 30_000 }, () => {
  it('drops the Gallery ring seat and its dock entry, and leaves every space tile standing', async () => {
    const { ctx, slots } = await mountHost()
    const gallery = ctx.plugin(Gallery)
    await gallery.await()
    const soundstage = ctx.plugin(Soundstage)
    await soundstage.await()

    const view = renderLauncher()
    await act(async () => { await Promise.resolve() })
    // Two seats from one plugin since 4 Sep 2026: Images (order 6) and Video
    // (order 8) render the same grid over one row source, with the Sound Stage
    // (order 7) between them. Disabling the row must drop both of them.
    expect(slots.entries('conversation.view').map(entry => entry.options.id))
      .toEqual(['chat', 'gallery', 'soundstage', 'motion'])
    expect(tiles(view.container)).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])

    // Disabling the row: the Gallery fiber goes, and everything it registered
    // goes with it.
    await act(async () => { await gallery.dispose() })
    expect(slots.entries('conversation.view').map(entry => entry.options.id))
      .toEqual(['chat', 'soundstage'])
    // The Sound Stage's length select lives in the Gallery plugin's settings
    // strip (7 Sep 2026), so no dock entry of its own survives it.
    expect(slots.entries('conversation.input.dock').map(entry => entry.options.id)).toEqual([])
    expect((ctx.get('conversationViews') as ConversationViewRegistry).entries()).toEqual([])
    // The roster is declared, so the chooser still offers Gallery: what is
    // missing belongs on the brain step, never on a dimmed or dropped tile.
    expect(tiles(view.container)).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    expect(view.container.querySelector('[data-space="gallery"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('leaves the ring with Chat alone once both media plugins are disabled, tiles untouched', async () => {
    const { ctx, slots } = await mountHost()
    const gallery = ctx.plugin(Gallery)
    await gallery.await()
    const soundstage = ctx.plugin(Soundstage)
    await soundstage.await()

    const view = renderLauncher()
    await act(async () => { await Promise.resolve() })
    await act(async () => { await gallery.dispose() })
    await act(async () => { await soundstage.dispose() })

    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['chat'])
    expect((ctx.get('conversationEvents') as ConversationEventRegistry).entries()).toEqual([])
    expect(tiles(view.container)).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
  })
})

// @vitest-environment jsdom
/**
 * The pinned Studio card (JJ, 3 Sep 2026: "it's like the lead agent in v0",
 * "the studio is for all projects"): the component shows presence and the
 * attention summed across projects, and opens on click; the plugin seats it
 * above the projects and its open verb finds the one Studio chat or mints it
 * — a blank chat given the `studio` space before it is opened, so the seed
 * lands it on the Studio view.
 */
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { requestStudio } from '@idealize/askbar/src/client/studio-request.ts'
import { apply, inject, StudioCard, type StudioCardInjected } from '../src/client/index.ts'

usePinnedBrowserLanguages('en')
afterEach(cleanup)

const unused = (): never => { throw new Error('unused hook') }
const t = (key: string): string => key

interface StudioStub {
  projects: { project: string; lastSeq: number; state: { tasks: { id: string; attention: string }[] } }[]
  loading: boolean
  loaded: boolean
  error: string | null
  read: Record<string, number>
}

function card(overrides: Partial<StudioCardInjected> = {}) {
  const studio = createSnapshotStore<StudioStub>({
    projects: [
      { project: '/w/alpha', lastSeq: 7, state: { tasks: [{ id: 't1', attention: 'needs-clarification' }, { id: 't2', attention: 'none' }] } },
      { project: '/w/beta', lastSeq: 3, state: { tasks: [{ id: 't3', attention: 'blocked' }] } },
    ],
    loading: false,
    loaded: true,
    error: null,
    read: { '/w/alpha': 5, '/w/beta': 3 },
  })
  const target = createSnapshotStore<{ current: boolean; available: boolean }>({ current: false, available: true })
  const telegram = createSnapshotStore<{ connected: boolean }>({ connected: false })
  const open = vi.fn(() => Promise.resolve())
  const face = {
    useStudio: bindSnapshotSelector(studio),
    useTelegram: bindSnapshotSelector(telegram),
    useTarget: bindSnapshotSelector(target),
    sync: vi.fn(() => Promise.resolve()),
    open,
    ...overrides,
  } as unknown as StudioCardInjected
  const view = render(<StudioCard {...face} t={t as never} useSessions={unused} useWorkspaces={unused} />)
  return { view, studio, target, telegram, open, sync: face.sync }
}

describe('StudioCard', () => {
  it('watches every project: marks the Studio reachable, sums unresolved attention across projects, and opens on click', () => {
    const { view, open } = card()
    const button = view.getByRole('button', { name: 'studio.card.open' })
    expect(button.textContent).toContain('studio.card.title')
    expect(button.textContent).toContain('studio.card.telegram.disconnected')
    expect(view.container.querySelector('[data-studio-card-presence]')?.getAttribute('data-studio-card-presence')).toBe('reachable')
    expect(view.container.querySelector('[data-studio-card-attention]')?.textContent).toBe('2')
    expect(button.hasAttribute('data-current')).toBe(false)
    fireEvent.click(button)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('reads the Telegram remote on its second line: not connected until a token is stored and a chat paired', () => {
    const { view, telegram } = card()
    const line = (): HTMLElement | null => view.container.querySelector('[data-studio-card-telegram]')
    expect(line()?.getAttribute('data-studio-card-telegram')).toBe('disconnected')
    act(() => { telegram.set({ connected: true }) })
    expect(line()?.getAttribute('data-studio-card-telegram')).toBe('connected')
    expect(line()?.textContent).toBe('studio.card.telegram.connected')
  })

  it('reads as a row: its own wrapper carries the rule under it, and the button holds glyph, text, both marks and the dot alone', () => {
    const { view } = card()
    const wrap = view.container.querySelector('[data-studio-card-wrap]')
    expect(wrap?.firstElementChild?.hasAttribute('data-studio-card')).toBe(true)
    expect(wrap?.childElementCount).toBe(1)
    const button = view.getByRole('button')
    // No accent bar: glyph, text, the unread mark, the attention badge, the presence dot.
    expect(button.childElementCount).toBe(5)
    expect(button.firstElementChild?.querySelector<HTMLElement>('[data-space-icon]')?.style.getPropertyValue('--space-icon'))
      .toBe('url(/idealize/spaces/icons/studio.svg)')
  })

  it('counts unread apart from attention, and drops the mark once the Studio has been read', () => {
    const { view, studio } = card()
    // Two events past the stored position on alpha, none on beta.
    expect(view.container.querySelector('[data-studio-card-unread]')?.textContent).toBe('2')
    expect(view.container.querySelector('[data-studio-card-attention]')?.textContent).toBe('2')
    act(() => { studio.update((draft) => { draft.read = { '/w/alpha': 7, '/w/beta': 3 } }) })
    // Reading the Studio clears the unread mark and resolves nothing.
    expect(view.container.querySelector('[data-studio-card-unread]')).toBeNull()
    expect(view.container.querySelector('[data-studio-card-attention]')?.textContent).toBe('2')
  })

  it('shows unreachable under an error or before the first read, and current while the Studio chat is open', () => {
    const { view, studio, target } = card()
    act(() => { studio.update((draft) => { draft.error = 'state 503' }) })
    expect(view.container.querySelector('[data-studio-card-presence]')?.getAttribute('data-studio-card-presence')).toBe('unreachable')
    // Stale coordination beats none: the last good count stays under the error.
    expect(view.container.querySelector('[data-studio-card-attention]')?.textContent).toBe('2')
    act(() => { studio.set({ projects: [], loading: true, loaded: false, error: null, read: {} }) })
    expect(view.container.querySelector('[data-studio-card-presence]')?.getAttribute('data-studio-card-presence')).toBe('unreachable')
    expect(view.container.querySelector('[data-studio-card-attention]')).toBeNull()
    act(() => { target.update((draft) => { draft.current = true }) })
    expect(view.getByRole('button').hasAttribute('data-current')).toBe(true)
  })

  it('polls the overview while mounted and renders nothing while no project exists', () => {
    vi.useFakeTimers()
    try {
      const { view, sync, target } = card()
      expect(sync).toHaveBeenCalledTimes(1)
      act(() => { vi.advanceTimersByTime(3000) })
      expect(sync).toHaveBeenCalledTimes(2)
      act(() => { target.set({ current: false, available: false }) })
      expect(view.container.querySelector('[data-studio-card]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

interface Summary {
  id: string
  cwd: string
  blank: boolean
  projectionValues?: { space?: { space: string } }
}

async function plugin(summaries: Summary[], current?: string) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('layout', {
    toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn(),
    openDrawer: vi.fn(), closeDrawer: vi.fn(), openDeck: vi.fn(), closeDeck: vi.fn(),
  } as never)
  const sessionList = createSnapshotStore({
    ids: summaries.map(summary => summary.id),
    byId: Object.fromEntries(summaries.map(summary => [summary.id, summary])),
    current,
  })
  const open = vi.fn()
  ctx.provide('sessions', { list: sessionList, open, binding: () => undefined } as never)
  const workspaceList = createSnapshotStore({
    items: [
      { workspaceId: 'alpha', path: '/w/alpha', title: 'Alpha', sessionIds: summaries.map(summary => summary.id) },
      { workspaceId: 'beta', path: '/w/beta', title: 'Beta', sessionIds: [] },
    ],
    archivedSessionIds: [] as string[],
  })
  const connectWorkspace = vi.fn(() => Promise.resolve('s-fresh'))
  // The Studio's fresh chat is marked as put to work before its space record
  // lands, so New chat cannot take the project's one group chat meanwhile.
  const noteSessionConfigured = vi.fn(() => () => {})
  const create = vi.fn((input: { path: string }) => Promise.resolve({ workspaceId: `ws-${input.path}`, path: input.path }))
  const startSession = vi.fn()
  ctx.provide('workspaces', { list: workspaceList, create, startSession, connectWorkspace, noteSessionConfigured } as never)
  ctx.provide('modelsSettingsSection', { Component: () => null, face: () => ({}) } as never)
  ctx.provide('trajectorySection', { Component: () => null, face: () => undefined } as never)
  ctx.provide('scheduleSection', { Component: () => null, face: () => ({}) } as never)
  const studioState = createSnapshotStore({ projects: [], loading: true, loaded: false, error: null })
  ctx.provide('studioSection', { Component: () => null, face: () => ({}), store: { state: studioState, sync: vi.fn() } } as never)
  const appearanceStore = createSnapshotStore({ open: false })
  ctx.provide('appearance', {
    open: vi.fn(), close: vi.fn(), toggle: vi.fn(), isOpen: () => false, Component: () => null,
    face: () => ({ hooks: {} }), store: appearanceStore,
  } as never)
  ctx.provide('conversation', { input: { for: () => ({ state: createSnapshotStore({ draft: '' }), setDraft: vi.fn() }) } } as never)
  ctx.provide('connection', { api: { agentPresets: { select: vi.fn() } } } as never)
  const commands = { execute: vi.fn() }
  ctx.provide('remote', { commands } as never)
  ctx.provide('remote.commands', commands as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'shell.rail': { kind: 'single', scope: 'root' },
      'shell.drawer': { kind: 'single', scope: 'root' },
      'shell.deck': { kind: 'single', scope: 'root' },
      'settings.trigger': { kind: 'single', scope: 'root' },
      'sidebar.workspaces.pinned': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = slots.entries('sidebar.workspaces.pinned')[0]
  if (entry === undefined) throw new Error('the Studio card is not seated')
  const face = (entry.inject as unknown as () => StudioCardInjected)()
  return { face, fiber, open, create, startSession, connectWorkspace, noteSessionConfigured, sessionList, workspaceList }
}

describe('the Studio card in the plugin', () => {
  it('knows when the Studio chat is current and whether a project exists to hold one', async () => {
    const { face, sessionList, workspaceList } = await plugin([
      { id: 's-chat', cwd: '/w/beta', blank: false },
      { id: 's-studio', cwd: '/w/beta', blank: true, projectionValues: { space: { space: 'studio' } } },
    ], 's-chat')
    const read = <T,>(selector: (state: { current: boolean; available: boolean }) => T): T => {
      let value: T | undefined
      const Probe = (): null => { value = face.useTarget(selector); return null }
      render(<Probe />)
      return value as T
    }
    expect(read(state => state)).toEqual({ current: false, available: true })
    sessionList.update((draft) => { draft.current = 's-studio' })
    cleanup()
    expect(read(state => state.current)).toBe(true)
    workspaceList.update((draft) => { draft.items = [] })
    cleanup()
    expect(read(state => state.available)).toBe(false)
  })

  it('reads the Telegram status with the overview: connected once a token is stored, a chat paired and nothing is wrong', async () => {
    let answer: string | { status: number } = '{"error":"not composed"}'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/idealize/telegram/status') return Promise.resolve(new Response('[]'))
      return Promise.resolve(typeof answer === 'string' ? new Response(answer) : new Response('', answer))
    })
    try {
      const { face, fiber } = await plugin([])
      const read = (): boolean => {
        let value = false
        const Probe = (): null => { value = face.useTelegram(state => state.connected); return null }
        render(<Probe />)
        cleanup()
        return value
      }
      answer = JSON.stringify({ configured: true, paired: false, problem: '' })
      await face.sync()
      expect(read()).toBe(false)
      answer = JSON.stringify({ configured: true, paired: true, problem: '' })
      await face.sync()
      expect(read()).toBe(true)
      answer = JSON.stringify({ configured: true, paired: true, problem: 'Telegram refused the token.' })
      await face.sync()
      expect(read()).toBe(false)
      // The route is not composed, or the host is away: the line reads not connected.
      answer = { status: 404 }
      await face.sync()
      expect(read()).toBe(false)
      fetchSpy.mockRejectedValue(new Error('offline'))
      await face.sync()
      expect(read()).toBe(false)
      await fiber.dispose()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('opens the existing Studio chat, whichever project holds it, without minting another', async () => {
    const { face, open, connectWorkspace } = await plugin([
      { id: 's-studio', cwd: '/w/beta', blank: true, projectionValues: { space: { space: 'studio' } } },
    ])
    await face.open()
    expect(open).toHaveBeenCalledWith('s-studio')
    expect(connectWorkspace).not.toHaveBeenCalled()
  })

  it('leaves a Studio chat whose project was removed and mints a fresh one in the first listed project', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'))
    try {
      const { face, open, connectWorkspace, workspaceList } = await plugin([
        { id: 's-orphan', cwd: '/w/gone', blank: true, projectionValues: { space: { space: 'studio' } } },
      ])
      // No listed project holds the chat: its project was removed after it was minted.
      workspaceList.update((draft) => { for (const item of draft.items) item.sessionIds = [] })
      await face.open()
      expect(connectWorkspace).toHaveBeenCalledWith('alpha')
      expect(open).toHaveBeenCalledWith('s-fresh')
      expect(open).not.toHaveBeenCalledWith('s-orphan')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('opens the Studio when the Askbar asks over the bridge feed', async () => {
    const sources: FakeEventSource[] = []
    class FakeEventSource {
      onmessage: ((message: { data: string }) => void) | null = null
      constructor(readonly url: string) { sources.push(this) }
      close(): void {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('/idealize/events/recent')) return Promise.resolve(new Response('[{"seq":7}]'))
      return Promise.resolve(new Response('{"ok":true}'))
    })
    try {
      const { open } = await plugin([
        { id: 's-studio', cwd: '/w/alpha', blank: true, projectionValues: { space: { space: 'studio' } } },
      ])
      await vi.waitFor(() => { expect(sources).toHaveLength(1) })
      // Attached past the retained tail, so an old request never replays.
      expect(sources[0]!.url).toBe('/idealize/events/stream?since=7')
      sources[0]!.onmessage?.({ data: JSON.stringify({ kind: 'notify', title: 'x', body: '' }) })
      expect(open).not.toHaveBeenCalled()
      sources[0]!.onmessage?.({ data: JSON.stringify({ kind: 'open-studio', project: '/w/nowhere' }) })
      await vi.waitFor(() => { expect(open).toHaveBeenCalledWith('s-studio') })
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('idealizes a folder when Finder asks over the bridge feed', async () => {
    const sources: { url: string; onmessage: ((message: { data: string }) => void) | null }[] = []
    class FakeEventSource {
      onmessage: ((message: { data: string }) => void) | null = null
      constructor(readonly url: string) { sources.push(this) }
      close(): void {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('/idealize/events/recent')) return Promise.resolve(new Response('[{"seq":3}]'))
      return Promise.resolve(new Response('{"ok":true}'))
    })
    try {
      const { create, startSession, fiber } = await plugin([])
      await vi.waitFor(() => { expect(sources).toHaveLength(1) })
      sources[0]!.onmessage?.({ data: JSON.stringify({ kind: 'open-folder', folder: '/Users/jj/Notes' }) })
      await vi.waitFor(() => { expect(create).toHaveBeenCalledWith({ path: '/Users/jj/Notes' }) })
      expect(startSession).toHaveBeenCalledWith('ws-/Users/jj/Notes')
      await fiber.dispose()
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('takes a folder request that arrived while the window was still starting, and leaves a stale one alone', async () => {
    class FakeEventSource {
      onmessage: ((message: { data: string }) => void) | null = null
      constructor(readonly url: string) {}
      close(): void {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const tail = (at: string): string => JSON.stringify([{ seq: 4, kind: 'open-folder', folder: '/Users/jj/Cold', at }])
    const respond = (at: string) => vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('/idealize/events/recent')) return Promise.resolve(new Response(tail(at)))
      return Promise.resolve(new Response('{"ok":true}'))
    })
    // The Quick Action started the app, so the request is seconds old.
    let fetchSpy = respond(new Date().toISOString())
    try {
      const fresh = await plugin([])
      await vi.waitFor(() => { expect(fresh.create).toHaveBeenCalledWith({ path: '/Users/jj/Cold' }) })
      await fresh.fiber.dispose()
    } finally {
      fetchSpy.mockRestore()
    }
    // A reload an hour later must not idealize the same folder again.
    fetchSpy = respond(new Date(Date.now() - 3_600_000).toISOString())
    try {
      const later = await plugin([])
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(later.create).not.toHaveBeenCalled()
      await later.fiber.dispose()
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('opens the Studio when the sidebar rail asks in-window, and stops listening on dispose', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'))
    try {
      const { open, fiber } = await plugin([
        { id: 's-studio', cwd: '/w/alpha', blank: true, projectionValues: { space: { space: 'studio' } } },
      ])
      requestStudio()
      await vi.waitFor(() => { expect(open).toHaveBeenCalledWith('s-studio') })
      await fiber.dispose()
      requestStudio()
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('mints the Studio chat the first time, in the first listed project: a blank chat, the studio space recorded, then opened', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'))
    try {
      const { face, open, connectWorkspace, noteSessionConfigured } = await plugin([])
      await face.open()
      expect(connectWorkspace).toHaveBeenCalledWith('alpha')
      // Marked before the record below: the reuse scan's studio exclusion
      // reads the projection that record produces, one round trip later.
      expect(noteSessionConfigured).toHaveBeenCalledWith('s-fresh')
      const select = fetchSpy.mock.calls.find(([url]) => url === '/idealize/spaces/select')
      expect(select).toBeDefined()
      expect(JSON.parse((select?.[1] as RequestInit).body as string)).toEqual({ sessionId: 's-fresh', space: 'studio' })
      expect(open).toHaveBeenCalledWith('s-fresh')
      // The chat opens before the record: a chat the host has not got live
      // refuses the record, and opening it is what makes it live.
      const selectIndex = fetchSpy.mock.calls.findIndex(([url]) => url === '/idealize/spaces/select')
      expect(open.mock.invocationCallOrder[0]!).toBeLessThan(fetchSpy.mock.invocationCallOrder[selectIndex]!)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('retries the space record while the host is still resuming a cold chat, and gives up on any other refusal', async () => {
    const statuses = [404, 404, 200]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/idealize/spaces/select') return Promise.resolve(new Response('[]'))
      const status = statuses.shift() ?? 200
      return Promise.resolve(new Response('{}', { status }))
    })
    try {
      const { face } = await plugin([])
      await face.open()
      const selects = fetchSpy.mock.calls.filter(([url]) => url === '/idealize/spaces/select')
      expect(selects).toHaveLength(3)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('stops recording the space when the host refuses for any reason other than a chat it has not got live', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/idealize/spaces/select') return Promise.resolve(new Response('[]'))
      return Promise.resolve(new Response('{"error":"body is not JSON"}', { status: 400 }))
    })
    try {
      const { face } = await plugin([])
      await face.open()
      expect(fetchSpy.mock.calls.filter(([url]) => url === '/idealize/spaces/select')).toHaveLength(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

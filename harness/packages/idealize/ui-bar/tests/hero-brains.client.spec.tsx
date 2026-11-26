// @vitest-environment jsdom
// The three views under the hero composer: Chat, Coding and Studio. A blank
// chat is a Chat already; the other two tiles move it. Every refusal is stated
// with a way forward, and nothing is ever dimmed or disabled.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SpaceRosterEntry } from '@idealize/spaces/client'
import { en } from '../src/client/locales.ts'
import { CORE_PRESET, HeroBrains, STUDIO_ENTRY, viewPreset, type HeroBrainsProps } from '../src/client/HeroBrains.tsx'
import type { BrainAccess, HeroLauncherInjected, LauncherSession, TerminalLaunches } from '../src/client/HeroLauncher.tsx'
import { suggestSpace } from '../src/client/suggest-space.ts'
// Type-only: the locale-namespace and slot-key merges the props type reads.
import type {} from '../src/client/index.ts'

const t: HeroBrainsProps['t'] = makeTranslate(en, commonEn)
const unused = (() => undefined) as unknown as HeroBrainsProps['useSessions'] & HeroBrainsProps['useWorkspaces']

const CHAT: SpaceRosterEntry = {
  id: 'chat',
  brainCount: 3,
  brains: [
    { id: 'coding', name: 'Coding', default: true },
    { id: 'design', name: 'Design', model: { provider: 'openai', model: 'gpt-5' } },
    { id: 'mine', name: 'Mine' },
  ],
  models: 'some',
}
const LONE_GALLERY: SpaceRosterEntry = {
  id: 'gallery',
  brainCount: 1,
  brains: [{ id: 'gallery', name: 'Gallery', default: true, model: { provider: 'fal', model: 'flux' } }],
  models: 'some',
}
const KEYLESS_GALLERY: SpaceRosterEntry = {
  id: 'gallery',
  brainCount: 1,
  brains: [{ id: 'gallery', name: 'Gallery', default: true }],
  models: 'none',
  reason: 'no-compatible-model',
  recovery: 'No connected provider offers a compatible image model.',
  keyMissing: true,
}
const TERMINAL: SpaceRosterEntry = {
  id: 'terminal',
  brainCount: 3,
  brains: [
    { id: 'coding', name: 'Coding', default: true, model: { provider: 'openai', model: 'gpt-5' } },
    { id: 'design', name: 'Design', model: { provider: 'openai-codex', model: 'gpt-5.6-terra' } },
    { id: 'admin', name: 'Admin' },
  ],
  models: 'some',
}
const CORE = { id: 'core', name: 'IDEalize' }
/** The roster once the core preset is seeded: it leads Chat and Coding. */
const CORE_ROSTER: SpaceRosterEntry[] = [
  { ...CHAT, brainCount: 4, brains: [...CHAT.brains, CORE] },
  { ...TERMINAL, brainCount: 4, brains: [...TERMINAL.brains, CORE] },
  LONE_GALLERY,
]
const ROSTER: SpaceRosterEntry[] = [
  CHAT,
  TERMINAL,
  LONE_GALLERY,
  { id: 'soundstage', brainCount: 0, brains: [], models: 'some' },
  {
    id: 'motion',
    brainCount: 0,
    brains: [],
    models: 'none',
    reason: 'no-compatible-model',
    recovery: 'No connected provider offers a compatible video model. Store the provider’s API key in Settings.',
    keyMissing: true,
  },
]

interface MountOptions {
  roster?: readonly SpaceRosterEntry[]
  access?: Readonly<Record<string, BrainAccess>>
  launches?: TerminalLaunches
  session?: LauncherSession
  draft?: string
  projectOpen?: boolean
  enter?: () => Promise<boolean>
}

function mount(options: MountOptions = {}) {
  const roster = options.roster ?? ROSTER
  const enter = vi.fn(options.enter ?? (() => Promise.resolve(true)))
  const prepare = vi.fn(() => Promise.resolve())
  const noteTyping = vi.fn()
  const addBrain = vi.fn()
  const addKey = vi.fn()
  const signIn = vi.fn()
  const setDraft = vi.fn()
  const load = vi.fn(() => Promise.resolve(roster))
  let session: LauncherSession = options.session ?? { id: 's1', blank: true }
  const spaces: HeroLauncherInjected['spaces'] = {
    load,
    access: () => Promise.resolve(options.access ?? {}),
    enter,
    prepare,
    noteTyping,
    addBrain,
    addKey,
    signIn,
    terminalLaunches: () => Promise.resolve(options.launches),
  }
  const element = (draft: string) => (
    <HeroBrains
      t={t}
      useSessions={unused}
      useWorkspaces={unused}
      spaces={spaces}
      currentSession={() => session}
      projectOpen={options.projectOpen ?? true}
      draft={draft}
      setDraft={setDraft}
    />
  )
  const view = render(element(options.draft ?? ''))
  return {
    view, enter, prepare, noteTyping, addBrain, addKey, signIn, setDraft, load,
    rerender: (draft: string, next?: LauncherSession) => {
      if (next !== undefined) session = next
      view.rerender(element(draft))
    },
  }
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const tile = (view: ReturnType<typeof mount>['view'], id: 'chat' | 'coding' | 'studio'): HTMLElement =>
  view.container.querySelector<HTMLElement>(`[data-view-tile="${id}"]`)!

const LAUNCHES: TerminalLaunches = {
  default: 'claude',
  byActivity: {},
  catalog: [
    { id: 'claude-code', label: 'Claude Code', command: 'claude', installed: true },
    { id: 'codex', label: 'Codex', command: 'codex', installed: false },
  ],
}

afterEach(cleanup)

describe('the three views', () => {
  it('shows Chat, Coding and Studio, with Chat marked as where this chat already is', async () => {
    const { view } = mount({ roster: CORE_ROSTER, launches: LAUNCHES })
    await settle()
    expect([...view.container.querySelectorAll('[data-view-tile]')].map(one => one.getAttribute('data-view-tile')))
      .toEqual(['chat', 'coding', 'studio'])
    expect(tile(view, 'chat').hasAttribute('data-view-selected')).toBe(true)
    expect(tile(view, 'coding').hasAttribute('data-view-selected')).toBe(false)
    expect(tile(view, 'chat').textContent).toContain('Ask, plan and write.')
    expect(tile(view, 'coding').textContent).toContain('Claude Code, on your subscription')
    expect(tile(view, 'studio').textContent).toContain('Make images, video and sound.')
    expect(view.container.textContent?.toLowerCase()).not.toContain('brain')
    expect(view.container.querySelector('button:disabled')).toBeNull()
  })

  it('prefers the core preset, and falls back to a view\'s default and then its first', () => {
    expect(viewPreset(CORE_ROSTER[0])?.id).toBe(CORE_PRESET)
    expect(viewPreset(CHAT)?.id).toBe('coding')
    expect(viewPreset({ ...CHAT, brains: [{ id: 'mine', name: 'Mine' }] })?.id).toBe('mine')
    expect(viewPreset({ ...CHAT, brains: [] })).toBeUndefined()
    expect(viewPreset(undefined)).toBeUndefined()
  })

  it('puts a blank chat on the core preset once, and records it when typing starts', async () => {
    const { prepare, noteTyping, rerender } = mount({ roster: CORE_ROSTER })
    await settle()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledWith('core', 's1')
    expect(noteTyping).not.toHaveBeenCalled()
    rerender('hello')
    rerender('hello there')
    expect(noteTyping).toHaveBeenCalledTimes(1)
    expect(noteTyping).toHaveBeenCalledWith('core', 's1')
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('keeps a chat on the preset it already records or was made on', async () => {
    const recorded = mount({ roster: CORE_ROSTER, session: { id: 's1', blank: true, brain: 'coding' }, draft: 'hi' })
    await settle()
    expect(recorded.prepare).not.toHaveBeenCalled()
    expect(recorded.noteTyping).not.toHaveBeenCalled()
    cleanup()
    const made = mount({ roster: CORE_ROSTER, session: { id: 's2', blank: true, agentPreset: 'coding' } })
    await settle()
    expect(made.prepare).toHaveBeenCalledWith('coding', 's2')
  })

  it('a press on Chat only focuses the composer', async () => {
    const { view, enter } = mount({ roster: CORE_ROSTER })
    await settle()
    fireEvent.click(tile(view, 'chat').querySelector('button')!)
    expect(enter).not.toHaveBeenCalled()
  })

  it('Coding opens the Terminal on the core preset, and Studio opens the media view on its own', async () => {
    const { view, enter } = mount({ roster: CORE_ROSTER, launches: LAUNCHES })
    await settle()
    fireEvent.click(tile(view, 'coding').querySelector('button')!)
    await settle()
    expect(enter).toHaveBeenLastCalledWith('terminal', 'core', 's1')
    fireEvent.click(tile(view, 'studio').querySelector('button')!)
    await settle()
    expect(enter).toHaveBeenLastCalledWith(STUDIO_ENTRY, 'gallery', 's1')
  })

  it('runs one launch at a time', async () => {
    let finish: (opened: boolean) => void = () => undefined
    const { view, enter } = mount({ roster: CORE_ROSTER, enter: () => new Promise<boolean>((resolve) => { finish = resolve }) })
    await settle()
    fireEvent.click(tile(view, 'coding').querySelector('button')!)
    fireEvent.click(tile(view, 'studio').querySelector('button')!)
    expect(enter).toHaveBeenCalledTimes(1)
    finish(false)
    await settle()
    fireEvent.click(tile(view, 'studio').querySelector('button')!)
    expect(enter).toHaveBeenCalledTimes(2)
  })

  it('says what Chat needs and opens the fix: a key, or a sign-in', async () => {
    const keyless = mount({
      roster: CORE_ROSTER,
      access: { core: { state: 'unavailable', reason: 'no-access', model: { provider: 'anthropic', model: 'x' } } },
    })
    await settle()
    expect(tile(keyless.view, 'chat').querySelector('[data-view-needs]')?.textContent).toContain('Needs a key.')
    fireEvent.click(tile(keyless.view, 'chat').querySelector('button')!)
    expect(keyless.addKey).toHaveBeenCalledWith('anthropic')
    cleanup()
    const modelless = mount({
      roster: CORE_ROSTER,
      access: { core: { state: 'unavailable', reason: 'no-access', model: null } },
    })
    await settle()
    fireEvent.click(tile(modelless.view, 'chat').querySelector('[data-view-needs] button')!)
    expect(modelless.addKey).toHaveBeenCalledWith('openrouter')
    cleanup()
    const signedOut = mount({
      roster: CORE_ROSTER,
      access: { core: { state: 'unavailable', reason: 'no-sign-in', model: { provider: 'openai-codex', model: 'x' } } },
    })
    await settle()
    expect(tile(signedOut.view, 'chat').textContent).toContain('Needs a sign-in.')
    fireEvent.click(tile(signedOut.view, 'chat').querySelector('button')!)
    expect(signedOut.signIn).toHaveBeenCalled()
    cleanup()
    const noModels = mount({ roster: [{ ...CORE_ROSTER[0]!, models: 'none' }] })
    await settle()
    fireEvent.click(tile(noModels.view, 'chat').querySelector('button')!)
    expect(noModels.addKey).toHaveBeenCalledWith('openrouter')
  })

  it('names the route Chat runs through when the host reports one', async () => {
    const { view } = mount({
      roster: CORE_ROSTER,
      access: { core: { state: 'ready', model: { provider: 'openrouter', model: 'x' }, providerName: 'OpenRouter' } },
    })
    await settle()
    expect(tile(view, 'chat').querySelector('[data-view-runs]')?.textContent).toBe('Through OpenRouter')
  })

  it('says when the coding app is not installed, and opens set-up', async () => {
    const { view, addKey, enter } = mount({ roster: CORE_ROSTER, launches: { ...LAUNCHES, default: 'codex' } })
    await settle()
    expect(tile(view, 'coding').textContent).toContain('Codex is not installed.')
    fireEvent.click(tile(view, 'coding').querySelector('button')!)
    expect(addKey).toHaveBeenCalledWith()
    expect(enter).not.toHaveBeenCalled()
  })

  it('says Studio needs a key when a key is what is missing', async () => {
    const { view, addKey } = mount({ roster: [CORE_ROSTER[0]!, KEYLESS_GALLERY] })
    await settle()
    expect(tile(view, 'studio').textContent).toContain('Needs a key.')
    fireEvent.click(tile(view, 'studio').querySelector('button')!)
    expect(addKey).toHaveBeenCalledWith('openrouter')
    cleanup()
    const noModel = mount({ roster: [CORE_ROSTER[0]!, { ...KEYLESS_GALLERY, reason: 'no-model', keyMissing: false }] })
    await settle()
    expect(tile(noModel.view, 'studio').textContent).toContain('Needs a key.')
    cleanup()
    const shell = mount({ roster: [CORE_ROSTER[0]!, { ...KEYLESS_GALLERY, reason: 'desktop-only', keyMissing: false }] })
    await settle()
    expect(tile(shell.view, 'studio').querySelector('[data-view-needs]')).toBeNull()
  })

  it('leaves out a view the roster does not offer', async () => {
    const { view } = mount({ roster: [CORE_ROSTER[0]!] })
    await settle()
    expect([...view.container.querySelectorAll('[data-view-tile]')].map(one => one.getAttribute('data-view-tile'))).toEqual(['chat'])
  })

  it('shows nothing without a project, in a started chat, or once the chat has left for another view', async () => {
    for (const options of [
      { projectOpen: false },
      { session: { id: 's1', blank: false } },
      { session: { id: 's1', blank: true, space: 'gallery' } },
    ] satisfies MountOptions[]) {
      const { view, prepare } = mount({ roster: CORE_ROSTER, ...options })
      await settle()
      expect(view.container.querySelector('[data-hero-below]')).toBeNull()
      expect(prepare).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('reloads when the Models pane saves something', async () => {
    const { load } = mount({ roster: CORE_ROSTER })
    await settle()
    act(() => { document.dispatchEvent(new CustomEvent('idealize:brains-changed')) })
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the suggestion', () => {
  it('offers Images for an ask to make a picture, and keeps the words when taken', async () => {
    const { view, enter, setDraft } = mount({ draft: 'make me a poster of an owl' })
    await settle()
    const row = view.container.querySelector('[data-hero-suggest="gallery"]')!
    expect(row.textContent).toContain('This looks like an image.')
    fireEvent.click(row.querySelector('[data-hero-suggest-make]')!)
    await settle()
    expect(enter).toHaveBeenCalledWith('gallery', 'gallery', 's1')
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('goes away on Keep asking here', async () => {
    const { view, enter } = mount({ draft: 'draw a logo' })
    await settle()
    fireEvent.click(view.container.querySelector('[data-hero-suggest-keep]')!)
    expect(view.container.querySelector('[data-hero-suggest]')).toBeNull()
    expect(enter).not.toHaveBeenCalled()
  })

  it('reads asks to make media, and leaves work on existing things alone', () => {
    expect(suggestSpace('Make an image of a fox')).toBe('gallery')
    expect(suggestSpace('please generate 3 logos for a bakery')).toBe('gallery')
    expect(suggestSpace('create a short video about owls')).toBe('motion')
    expect(suggestSpace('compose a jingle')).toBe('soundstage')
    expect(suggestSpace('Fix the logo on my site')).toBeUndefined()
    expect(suggestSpace('Why is this image not loading?')).toBeUndefined()
    expect(suggestSpace('')).toBeUndefined()
  })
})

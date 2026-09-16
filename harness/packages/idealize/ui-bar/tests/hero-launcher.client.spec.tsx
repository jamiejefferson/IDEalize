// @vitest-environment jsdom
// The welcome card: without a project it offers recents, New project and Find
// a folder; with one it asks which space, then which brain — unless one
// reachable brain works in the space, when the tile starts it. Every tile is
// live whatever its roster entry says, and every refusal is stated on the
// brain step with a way forward and a way back.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SpaceRosterEntry } from '@idealize/spaces/client'
import { en } from '../src/client/locales.ts'
import { HeroLauncher } from '../src/client/HeroLauncher.tsx'
import type { BrainAccess, HeroLauncherInjected, HeroLauncherProps, TerminalLaunches } from '../src/client/HeroLauncher.tsx'
// Type-only: the locale-namespace and slot-key merges the props type reads.
import type {} from '../src/client/index.ts'

const t: HeroLauncherProps['t'] = makeTranslate(en, commonEn)
// The global seat's selector hooks: the launcher reads neither list.
const unused = (() => undefined) as unknown as HeroLauncherProps['useSessions'] & HeroLauncherProps['useWorkspaces']

/**
 * A roster with one of each state: Chat has brains, Gallery has models but no
 * brain yet, Sound Stage is refused for a missing key, Terminal is refused
 * because the desktop shell is absent, Motion has neither.
 */
const ROSTER: SpaceRosterEntry[] = [
  {
    id: 'chat',
    brainCount: 2,
    brains: [
      { id: 'coding', name: 'Coding', default: true },
      { id: 'design', name: 'Design', model: { provider: 'openai', model: 'gpt-5' } },
    ],
    models: 'some',
  },
  {
    id: 'terminal',
    brainCount: 2,
    brains: [{ id: 'coding', name: 'Coding', default: true }, { id: 'design', name: 'Design' }],
    models: 'none',
    reason: 'desktop-only',
    recovery: 'The terminal runs in the IDEalize desktop app. Open IDEalize there to use it.',
  },
  { id: 'gallery', brainCount: 0, brains: [], models: 'some' },
  {
    id: 'soundstage',
    brainCount: 1,
    brains: [{ id: 'soundstage', name: 'Sound Stage', default: true }],
    models: 'none',
    reason: 'no-compatible-model',
    recovery: 'No connected provider offers a compatible audio model.',
  },
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

/** The agents route's per-brain access, as the card reads it; every brain ready unless a test says otherwise. */
let accessMap: Readonly<Record<string, BrainAccess>> = {}

/** The terminal launch table the Terminal brain step reads; undefined outside the desktop app. */
let launches: TerminalLaunches | undefined = undefined

/** Images with one brain a model can serve: the tile starts it without a second question. */
const LONE_GALLERY: SpaceRosterEntry = {
  id: 'gallery',
  brainCount: 1,
  brains: [{ id: 'poster', name: 'Poster', default: true, model: { provider: 'mediahub', model: 'still-a' } }],
  models: 'some',
}
const LONE_ROSTER: SpaceRosterEntry[] = ROSTER.map(entry => entry.id === 'gallery' ? LONE_GALLERY : entry)

/** A Terminal the desktop app can serve: two brains on two CLIs, the default a plain shell. */
const SERVED_TERMINAL: SpaceRosterEntry = {
  id: 'terminal',
  brainCount: 3,
  brains: [
    { id: 'coding', name: 'Coding', default: true, model: { provider: 'openai', model: 'gpt-5' } },
    { id: 'design', name: 'Design', model: { provider: 'openai-codex', model: 'gpt-5.6-terra' } },
    { id: 'admin', name: 'Admin' },
  ],
  models: 'some',
}

function mount(
  overrides: Partial<HeroLauncherInjected> = {},
  owner: Partial<Pick<HeroLauncherProps,
    'projectOpen' | 'projectRow' | 'recentProjects' | 'onNewProject' | 'onFindProject'>> = {},
  roster: readonly SpaceRosterEntry[] = ROSTER,
) {
  const enter = vi.fn(() => Promise.resolve(true))
  const addBrain = vi.fn()
  const addKey = vi.fn()
  const signIn = vi.fn()
  const load = vi.fn(() => Promise.resolve(roster))
  const injected: HeroLauncherInjected = {
    currentSession: () => ({ id: 's1', blank: true }),
    spaces: {
      load, access: () => Promise.resolve(accessMap), enter, addBrain, addKey, signIn,
      terminalLaunches: () => Promise.resolve(launches),
    },
    ...overrides,
  }
  const ownerProps = {
    projectRow: <span data-testid="project-row">idealize-v1</span>,
    projectOpen: true,
    recentProjects: <div data-recent-projects="">recent cards</div>,
    onNewProject: vi.fn(),
    onFindProject: vi.fn(),
    ...owner,
  }
  const element = () => (
    <HeroLauncher t={t} useSessions={unused} useWorkspaces={unused} {...injected} {...ownerProps} />
  )
  const view = render(element())
  return { view, injected, enter, addBrain, addKey, signIn, load, ownerProps, rerender: () => { view.rerender(element()) } }
}

/** Settle the roster fetch the card runs on mount. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

function tiles(view: ReturnType<typeof mount>['view']): HTMLElement[] {
  return [...view.container.querySelectorAll<HTMLElement>('[data-space]')]
}

afterEach(() => {
  accessMap = {}
  cleanup()
})

describe('HeroLauncher, step 1: which space', () => {
  it('without a project, a Studio chat renders nothing: the Studio runs across every project', async () => {
    const { view } = mount({ currentSession: () => ({ id: 's-studio', blank: true, space: 'studio' }) }, { projectOpen: false })
    await settle()
    expect(view.container.firstElementChild).toBeNull()
  })

  it('with a project open, a Studio chat still renders nothing: no project chip over its ask bar', async () => {
    const { view } = mount({ currentSession: () => ({ id: 's-studio', blank: true, space: 'studio' }) })
    await settle()
    expect(view.container.firstElementChild).toBeNull()
    expect(view.queryByTestId('project-row')).toBeNull()
  })

  it('without a project: recents plus New project and Find a folder, no tiles', async () => {
    const { view, ownerProps } = mount({}, { projectOpen: false })
    await settle()
    expect(view.getByText('recent cards')).toBeTruthy()
    expect(tiles(view)).toHaveLength(0)
    fireEvent.click(view.getByRole('button', { name: 'New project' }))
    expect(ownerProps.onNewProject).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('button', { name: 'Find a folder…' }))
    expect(ownerProps.onFindProject).toHaveBeenCalledTimes(1)
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(true)
  })

  it('offers all five spaces in the roster order, with the project row above them', async () => {
    const { view } = mount()
    await settle()
    expect(view.getByTestId('project-row')).toBeTruthy()
    expect(tiles(view).map(tile => tile.getAttribute('data-space')))
      .toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    // Each tile shows the icon `@idealize/spaces` serves for its space.
    expect(tiles(view).map(tile => tile.querySelector<HTMLElement>('[data-space-icon]')?.style.getPropertyValue('--space-icon')))
      .toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'].map(id => `url(/idealize/spaces/icons/${id}.svg)`))
    expect(view.getByText('Which space are we working in?')).toBeTruthy()
    expect(view.getByText('Step 1 of 2')).toBeTruthy()
  })

  it('never dims, disables or drops a tile, whatever its entry says', async () => {
    const { view } = mount()
    await settle()
    for (const tile of tiles(view)) {
      expect(tile.tagName).toBe('BUTTON')
      expect(tile.hasAttribute('disabled')).toBe(false)
      expect(tile.getAttribute('aria-disabled')).toBeNull()
    }
    // The refusal fields are step 2's alone: no tile renders one.
    expect(view.queryByText(/desktop app/)).toBeNull()
    expect(view.queryByText(/compatible video model/)).toBeNull()
  })

  it('carries the brain count and nothing else as its number', async () => {
    const { view } = mount()
    await settle()
    const counts = tiles(view).map(tile => tile.querySelector('[data-tile-count]')?.textContent)
    expect(counts).toEqual(['2 brains', '2 brains', 'No brains yet', '1 brain', 'No brains yet'])
  })

  it('advances to the brain step on a tile click when several brains work there, and does not launch', async () => {
    const { view, enter } = mount()
    await settle()
    fireEvent.click(view.getByRole('button', { name: /^Chat/ }))
    expect(enter).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-launcher-step="brain"]')?.getAttribute('data-space'))
      .toBe('chat')
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(true)
    expect(view.container.firstElementChild?.hasAttribute('data-launcher-autostart')).toBe(false)
  })

  it('starts the one reachable brain from the tile itself, skipping the brain step', async () => {
    // JJ, 7 Sep 2026: "skip the brain selection if there's only one brain".
    let open: (opened: boolean) => void = () => undefined
    const enter = vi.fn(() => new Promise<boolean>((resolve) => { open = resolve }))
    const { view } = mount({
      spaces: {
        load: () => Promise.resolve(LONE_ROSTER), access: () => Promise.resolve({}), enter,
        addBrain: vi.fn(), addKey: vi.fn(), signIn: vi.fn(),
        terminalLaunches: () => Promise.resolve(undefined),
      },
    }, {}, LONE_ROSTER)
    await settle()
    fireEvent.click(view.getByRole('button', { name: /^Images/ }))
    expect(enter).toHaveBeenCalledExactlyOnceWith('gallery', 'poster', 's1')
    // In flight: the card says which brain it is starting, and step 2 never renders.
    const root = view.container.firstElementChild
    expect(root?.getAttribute('data-launcher-autostart')).toBe('poster')
    expect(view.container.querySelector('[data-launcher-step="brain"]')).toBeNull()
    // A second click during the round-trip launches nothing more.
    fireEvent.click(view.getByRole('button', { name: /^Images/ }))
    expect(enter).toHaveBeenCalledTimes(1)
    await act(async () => { open(true); await Promise.resolve() })
    // Landed: the steps retire and the composer takes the prompt.
    expect(root?.hasAttribute('data-launcher-autostart')).toBe(false)
    expect(root?.hasAttribute('data-hero-undecided')).toBe(false)
    expect(view.container.querySelector('[data-launcher-step]')).toBeNull()
  })

  it('keeps the brain step for a lone brain whose route wants a key, so the step can explain', async () => {
    // The space chooser offers; the brain step explains (JJ).
    accessMap = { poster: { state: 'unavailable', reason: 'no-access', model: { provider: 'mediahub', model: 'still-a' } } }
    const { view, enter } = mount({}, {}, LONE_ROSTER)
    await settle()
    fireEvent.click(view.getByRole('button', { name: /^Images/ }))
    expect(enter).not.toHaveBeenCalled()
    expect(view.container.firstElementChild?.hasAttribute('data-launcher-autostart')).toBe(false)
    expect(view.container.querySelector('[data-launcher-step="brain"]')?.getAttribute('data-space')).toBe('gallery')
    const row = view.container.querySelector<HTMLElement>('[data-brain="poster"]')!
    expect(row.getAttribute('data-brain-access')).toBe('no-access')
    expect(row.textContent).toContain('No key for mediahub yet. Add one to start here.')
  })

  it('falls back to the brain step when the host refuses an auto-start', async () => {
    const refuse = vi.fn(() => Promise.resolve(false))
    const { view } = mount({
      spaces: {
        load: () => Promise.resolve(LONE_ROSTER), access: () => Promise.resolve({}), enter: refuse,
        addBrain: vi.fn(), addKey: vi.fn(), signIn: vi.fn(),
        terminalLaunches: () => Promise.resolve(undefined),
      },
    }, {}, LONE_ROSTER)
    await settle()
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /^Images/ }))
      await Promise.resolve()
    })
    expect(refuse).toHaveBeenCalledExactlyOnceWith('gallery', 'poster', 's1')
    const root = view.container.firstElementChild
    expect(root?.hasAttribute('data-launcher-autostart')).toBe(false)
    expect(root?.hasAttribute('data-hero-undecided')).toBe(true)
    // Step 2 shows the one brain, so the person sees what did not start.
    expect(view.container.querySelector('[data-launcher-step="brain"]')?.getAttribute('data-space')).toBe('gallery')
    expect(view.container.querySelector('[data-brain="poster"]')).not.toBeNull()
  })
})

describe('HeroLauncher, step 2: which brain', () => {
  /** Advance to one space's brain step. */
  async function open(space: string) {
    const mounted = mount()
    await settle()
    fireEvent.click(mounted.view.container.querySelector<HTMLElement>(`[data-space="${space}"]`)!)
    return mounted
  }

  it('lists the brains, marks the default, and states what a brain runs on', async () => {
    const { view } = await open('chat')
    expect(view.getByText('Which brain?')).toBeTruthy()
    expect(view.getByText('Step 2 of 2')).toBeTruthy()
    expect(view.getByText('2 brains work in Chat')).toBeTruthy()
    const rows = [...view.container.querySelectorAll('[data-brain]')]
    expect(rows.map(row => row.getAttribute('data-brain'))).toEqual(['coding', 'design'])
    expect(rows[0]?.hasAttribute('data-brain-default')).toBe(true)
    expect(rows[1]?.hasAttribute('data-brain-default')).toBe(false)
    expect(rows[0]?.textContent).toContain('Default model')
    expect(rows[1]?.textContent).toContain('openai · gpt-5')
  })

  it('starts the chat from the row itself: there is no separate start action', async () => {
    const { view, enter } = await open('chat')
    await act(async () => {
      fireEvent.click(view.container.querySelector<HTMLElement>('[data-brain="design"]')!)
      await Promise.resolve()
    })
    expect(enter).toHaveBeenCalledExactlyOnceWith('chat', 'design', 's1')
    // Landed: the two steps retire so the ordinary composer takes the prompt.
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(false)
    expect(view.container.querySelector('[data-launcher-step]')).toBeNull()
  })

  it('leaves the chooser up when the host refuses the launch', async () => {
    const refuse = vi.fn(() => Promise.resolve(false))
    const { view } = mount({
      spaces: {
        load: () => Promise.resolve(ROSTER), access: () => Promise.resolve({}), enter: refuse,
        addBrain: vi.fn(), addKey: vi.fn(), signIn: vi.fn(),
        terminalLaunches: () => Promise.resolve(undefined),
      },
    })
    await settle()
    fireEvent.click(view.container.querySelector<HTMLElement>('[data-space="chat"]')!)
    await act(async () => {
      fireEvent.click(view.container.querySelector<HTMLElement>('[data-brain="coding"]')!)
      await Promise.resolve()
    })
    expect(refuse).toHaveBeenCalledExactlyOnceWith('chat', 'coding', 's1')
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(true)
  })

  it('marks a brain whose route has no key and sends its row to the key editor instead of launching', async () => {
    accessMap = { design: { state: 'unavailable', reason: 'no-access', model: { provider: 'openai', model: 'gpt-5' } } }
    const { view, enter, addKey } = await open('chat')
    const row = view.container.querySelector<HTMLElement>('[data-brain="design"]')!
    expect(row.getAttribute('data-brain-access')).toBe('no-access')
    expect(row.textContent).toContain('No key for openai yet. Add one to start here.')
    // The ready brain beside it is unmarked and still states its model.
    expect(view.container.querySelector('[data-brain="coding"]')?.hasAttribute('data-brain-access')).toBe(false)
    fireEvent.click(row)
    expect(addKey).toHaveBeenCalledTimes(1)
    expect(enter).not.toHaveBeenCalled()
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(true)
  })

  it('sends a brain whose route waits on a sign-in to the sign-in surface, named by the route', async () => {
    // JJ, 7 Sep 2026: a subscription route read "No key for openai-codex" with a key action that could not help.
    accessMap = {
      design: { state: 'unavailable', reason: 'no-sign-in', model: { provider: 'openai-codex', model: 'gpt-5.5' }, providerName: 'OpenAI (ChatGPT)' },
    }
    const { view, enter, addKey, signIn } = await open('chat')
    const row = view.container.querySelector<HTMLElement>('[data-brain="design"]')!
    expect(row.getAttribute('data-brain-access')).toBe('no-sign-in')
    expect(row.textContent).toContain('Not signed in to OpenAI (ChatGPT). Sign in to start here.')
    fireEvent.click(row)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(addKey).not.toHaveBeenCalled()
    expect(enter).not.toHaveBeenCalled()
  })

  it('reloads the roster when the Brains pane reports a change, so a brain just added appears', async () => {
    // JJ, 7 Sep 2026: Video still read "No brains yet" after its own
    // Add-a-brain flow had saved one.
    const { view, load } = await open('gallery')
    expect(view.getByText('No brains yet')).toBeTruthy()
    load.mockImplementation(() => Promise.resolve(ROSTER.map(entry => entry.id !== 'gallery'
      ? entry
      : { ...entry, brainCount: 1, brains: [{ id: 'poster', name: 'Poster', default: true as const }] })))
    await act(async () => {
      document.dispatchEvent(new Event('idealize:brains-changed'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(load).toHaveBeenCalledTimes(2)
    expect(view.queryByText('No brains yet')).toBeNull()
    expect(view.container.querySelector('[data-brain="poster"]')).not.toBeNull()
  })

  it('offers no key action when the providers are connected and none offers the artefact', async () => {
    const { view } = await open('soundstage')
    expect(view.container.querySelector('[data-launcher-refusal]')?.getAttribute('data-launcher-refusal'))
      .toBe('no-compatible-model')
    expect(view.container.querySelector('[data-launcher-recovery]')?.textContent).toBe(en['brains.media.recovery.audio'])
    expect(view.container.querySelector('[data-launcher-add-key]')).toBeNull()
    expect(view.container.querySelector('[data-launcher-back]')).not.toBeNull()
  })

  it('offers Add a brain for the space when models exist but no brain does', async () => {
    const { view, addBrain } = await open('gallery')
    expect(view.getByText('No brains yet')).toBeTruthy()
    const action = view.container.querySelector<HTMLElement>('[data-launcher-add-brain="gallery"]')
    expect(action?.textContent).toContain('Add a brain for Images')
    fireEvent.click(action!)
    expect(addBrain).toHaveBeenCalledExactlyOnceWith('gallery')
  })

  it('states the shared localised recovery for the route verdict, with the key and the way back', async () => {
    const { view, addKey } = await open('motion')
    const refusal = view.container.querySelector('[data-launcher-refusal]')
    expect(refusal?.getAttribute('data-launcher-refusal')).toBe('no-compatible-model')
    expect(view.container.querySelector('[data-launcher-recovery]')?.textContent)
      .toBe(en['brains.media.recovery.video'])
    fireEvent.click(view.container.querySelector<HTMLElement>('[data-launcher-add-key]')!)
    expect(addKey).toHaveBeenCalledTimes(1)
    // The way back is what makes this a dead end only once.
    fireEvent.click(view.container.querySelectorAll<HTMLElement>('[data-launcher-back]')[1]!)
    expect(view.container.querySelector('[data-launcher-step]')?.getAttribute('data-launcher-step'))
      .toBe('space')
  })

  it('says where the terminal runs instead of offering a key that cannot supply it', async () => {
    const { view } = await open('terminal')
    expect(view.container.querySelector('[data-launcher-refusal]')?.getAttribute('data-launcher-refusal'))
      .toBe('desktop-only')
    expect(view.container.querySelector('[data-launcher-recovery]')?.textContent)
      .toContain('IDEalize desktop app')
    expect(view.container.querySelector('[data-launcher-add-key]')).toBeNull()
    expect(view.container.querySelector('[data-launcher-back]')).toBeTruthy()
  })

  it('offers no brain row in a space nothing can serve, however many work there', async () => {
    const { view } = await open('terminal')
    // Terminal counts its brains and still lists none: a row here would start
    // a chat in a space that cannot answer.
    expect(view.getByText('2 brains work in Terminal')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-brain]')).toHaveLength(0)

    const sound = await open('soundstage')
    expect(sound.view.container.querySelectorAll('[data-brain]')).toHaveLength(0)
    expect(sound.view.container.querySelector('[data-launcher-refusal]')?.getAttribute('data-launcher-refusal'))
      .toBe('no-compatible-model')
  })

  it('names the CLI each Terminal brain launches, never its chat model or key', async () => {
    launches = {
      default: 'claude --dangerously-skip-permissions',
      byActivity: { design: 'codex', admin: '' },
      catalog: [
        { id: 'claude-code', label: 'Claude Code', command: 'claude --dangerously-skip-permissions', installed: true },
        { id: 'codex', label: 'Codex', command: 'codex', installed: false },
      ],
    }
    // The model-key gate would block Admin in Chat; in Terminal the CLI runs on its own login.
    accessMap = { admin: { state: 'unavailable', reason: 'no-access', model: { provider: 'deepseek-official', model: 'x' } } }
    try {
      const roster = ROSTER.map(entry => entry.id === 'terminal' ? SERVED_TERMINAL : entry)
      const { view, enter } = mount({}, {}, roster)
      await settle()
      fireEvent.click(view.container.querySelector<HTMLElement>('[data-space="terminal"]')!)
      await settle()
      const notes = [...view.container.querySelectorAll<HTMLElement>('[data-brain]')]
        .map(row => [row.getAttribute('data-brain'), row.getAttribute('data-brain-cli'), row.getAttribute('data-brain-access')])
      expect(notes).toEqual([
        ['coding', 'Claude Code', null],
        ['design', 'Codex', null],
        ['admin', 'Plain shell', null],
      ])
      expect(view.container.textContent).not.toContain('gpt-5.6-terra')
      expect(view.container.textContent).toContain('Codex is not installed')
      // Admin starts: no key editor opens for a brain whose CLI needs no key.
      fireEvent.click(view.container.querySelector<HTMLElement>('[data-brain="admin"]')!)
      await settle()
      expect(enter).toHaveBeenCalledWith('terminal', 'admin', 's1')
    } finally {
      launches = undefined
      accessMap = {}
    }
  })

  it('goes back to the tiles from the step header', async () => {
    const { view } = await open('soundstage')
    fireEvent.click(view.container.querySelector<HTMLElement>('[data-launcher-back]')!)
    expect(view.container.querySelector('[data-launcher-step]')?.getAttribute('data-launcher-step'))
      .toBe('space')
    expect(tiles(view)).toHaveLength(5)
  })

  it('a chat whose record already names a brain shows no chooser (the reload case)', async () => {
    const { view } = mount({ currentSession: () => ({ id: 's1', blank: true, brain: 'gallery-agent' }) })
    await settle()
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(false)
    expect(tiles(view)).toHaveLength(0)
    expect(view.container.querySelector('[data-brain]')).toBeNull()
  })

  it('a new blank chat shows the chooser again after a launch', async () => {
    let session = { id: 's1', blank: true }
    const { view, rerender } = mount({ currentSession: () => session })
    await settle()
    fireEvent.click(view.container.querySelector<HTMLElement>('[data-space="chat"]')!)
    await act(async () => {
      fireEvent.click(view.container.querySelector<HTMLElement>('[data-brain="coding"]')!)
      await Promise.resolve()
    })
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(false)
    session = { id: 's2', blank: true }
    rerender()
    expect(view.container.firstElementChild?.hasAttribute('data-hero-undecided')).toBe(true)
    expect(tiles(view)).toHaveLength(5)
  })
})

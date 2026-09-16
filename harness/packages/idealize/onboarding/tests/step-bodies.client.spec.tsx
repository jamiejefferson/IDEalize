// @vitest-environment jsdom
// The agents and tools step bodies over the real flow controller and the real
// route client (createOnboardingApi) on a mock fetch: the agents step gates
// Continue on a connection and renders key-save refusals in place; the tools
// step maps the three GET payloads (stocked providers only, wizard row order,
// stored choices pre-selected), saves only user-changed rows with the exact
// POST payloads, blocks completion on a failed row, and renders the
// media-unavailable state.
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createOnboardingFlow } from '../src/client/flow.ts'
import { createOnboardingApi } from '../src/client/api.ts'
import { OnboardingOverlay } from '../src/client/OnboardingOverlay.tsx'
import type { OnboardingOverlayProps } from '../src/client/OnboardingOverlay.tsx'
import type { AgentsState, MediaRowState } from '../src/client/api.ts'
import { en } from '../src/client/locales.ts'
import type { OnboardingSeedLike } from '../src/client/steps.ts'

afterEach(cleanup)

const t = (key: string): string => en[key as keyof typeof en] ?? key

/** Flush pending route promises and their effects. */
const flush = async (): Promise<void> => { await act(async () => {}) }

/** The select-value packing the bodies use. */
const pack = (owner: string, model: string): string => JSON.stringify([owner, model])

interface RecordedCall {
  path: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

interface FetchTable {
  /** GET /idealize/onboarding/agents; reassignable so a save can change the re-poll. */
  agents: AgentsState
  /** GET /idealize/models/state. */
  modelsState?: unknown
  /** GET /idealize/activity/agents. */
  activityAgents?: unknown
  /** GET /idealize/brains/media. */
  brainsMedia?: unknown
  /** GET /idealize/terminal/launches; absent means the route does not exist (a plain browser). */
  terminalLaunches?: unknown
  /** Per-path POST response (default 200 { ok: true }). */
  posts?: Record<string, { status: number; body: unknown }>
}

/** A fetch stand-in serving the wizard's routes from a table, recording calls. */
function mockFetch(table: FetchTable) {
  const calls: RecordedCall[] = []
  const gets: Record<string, () => unknown> = {
    '/idealize/onboarding/agents': () => table.agents,
    '/idealize/models/state': () => table.modelsState,
    '/idealize/activity/agents': () => table.activityAgents,
    '/idealize/brains/media': () => table.brainsMedia,
    '/idealize/terminal/launches': () => table.terminalLaunches,
  }
  // The wizard only ever fetches plain string paths with JSON bodies; the
  // `typeof fetch` boundary cast localizes that narrowing.
  const serve = async (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown> => {
    const method = init?.method ?? 'GET'
    calls.push({
      path,
      method,
      headers: init?.headers ?? {},
      ...init?.body === undefined ? {} : { body: JSON.parse(init.body) as unknown },
    })
    if (method === 'GET') {
      // A route the host never registered answers like the web server does: a non-ok status.
      const serveGet = gets[path]
      if (serveGet === undefined || serveGet() === undefined) return { ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) }
      return { ok: true, status: 200, json: () => Promise.resolve(serveGet()) }
    }
    const post = table.posts?.[path] ?? { status: 200, body: { ok: true } }
    return { ok: post.status === 200, status: post.status, json: () => Promise.resolve(post.body) }
  }
  return { fetchFn: serve as unknown as typeof fetch, calls }
}

function mount(seed: OnboardingSeedLike | undefined, table: FetchTable) {
  const writes: Record<string, unknown> = {}
  const flow = createOnboardingFlow({
    persist: (field, value) => { writes[field] = value },
    releaseHold: () => {},
  })
  flow.open(seed)
  const { fetchFn, calls } = mockFetch(table)
  const props = {
    useView: bindSnapshotSelector(flow.view),
    t,
    api: createOnboardingApi(fetchFn),
    pickDirectory: () => Promise.resolve(null),
    readSetupAliases: () => ({}),
    selectProject: () => {},
    completeStep: flow.completeStep,
    skipStep: flow.skipStep,
    quitAll: flow.quitAll,
    back: flow.back,
    setToolDrafts: flow.setToolDrafts,
    finish: flow.finish,
    celebrationDone: flow.celebrationDone,
    prefersReducedMotion: () => false,
  } as unknown as OnboardingOverlayProps
  render(<OnboardingOverlay {...props} />)
  return { flow, writes, calls }
}

const continueButton = (): HTMLElement => screen.getByText(en['nav.continue'])

const DISCONNECTED: AgentsState = { claudeCode: { installed: false }, openrouter: { connected: false } }

describe('the agents step body', () => {
  it('gates Continue until at least one provider connects', async () => {
    const table: FetchTable = { agents: DISCONNECTED }
    mount({}, table)
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(en['agents.hint'])).toBeDefined()
    expect(screen.getByText(en['agents.claude.missing'])).toBeDefined()

    table.agents = { claudeCode: { installed: true, path: '/usr/local/bin/claude' }, openrouter: { connected: false } }
    fireEvent.click(screen.getByText(en['agents.claude.recheck']))
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    expect(document.querySelector('[data-agent-path]')?.textContent).toBe('/usr/local/bin/claude')
  })

  it('renders a refused key in place and keeps Continue disabled', async () => {
    mount({}, {
      agents: DISCONNECTED,
      posts: {
        '/idealize/onboarding/openrouter': {
          status: 400,
          body: { ok: false, error: 'OpenRouter rejected that key — check it and try again.' },
        },
      },
    })
    await flush()

    fireEvent.change(document.querySelector('[data-agent-key]')!, { target: { value: 'sk-or-bad' } })
    fireEvent.click(screen.getByText(en['agents.openrouter.connect']))
    await flush()
    expect(document.querySelector('[data-agent-error]')?.textContent).toContain('rejected')
    expect(continueButton().hasAttribute('disabled')).toBe(true)
  })

  it('posts the key with the auth header and connects the card on success', async () => {
    const table: FetchTable = { agents: DISCONNECTED }
    const { calls } = mount({}, table)
    await flush()

    fireEvent.change(document.querySelector('[data-agent-key]')!, { target: { value: 'sk-or-good' } })
    fireEvent.click(screen.getByText(en['agents.openrouter.connect']))
    table.agents = { claudeCode: { installed: false }, openrouter: { connected: true } }
    await flush()

    const save = calls.find(call => call.path === '/idealize/onboarding/openrouter')
    expect(save).toMatchObject({
      method: 'POST',
      body: { apiKey: 'sk-or-good' },
      headers: { 'x-idealize-auth': '1' },
    })
    expect(screen.getByText(en['agents.openrouter.connected'])).toBeDefined()
    expect(document.querySelector('[data-agent-key]')).toBeNull()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
  })
})

/** The three GET payloads behind the tools step, unfiltered (a stocked-out provider, a keyless one, and the sound row included). */
const MOTION_RECOVERY = en['tools.recovery.video']

function toolsTable(): FetchTable {
  return {
    agents: DISCONNECTED,
    modelsState: {
      providers: [
        { provider: 'deepseek-official', displayName: 'DeepSeek', models: ['deepseek-v4-flash', 'deepseek-v4-pro'], auth: 'apiKey', connected: true },
        { provider: 'openrouter', displayName: 'OpenRouter', models: ['openai/gpt-5.2'], auth: 'apiKey', connected: true },
        { provider: 'openai', displayName: 'OpenAI', models: ['gpt-5.4'], auth: 'apiKey', connected: false },
        { provider: 'empty', displayName: 'Empty', models: [], auth: 'apiKey', connected: true },
      ],
    },
    activityAgents: {
      agents: [
        { id: 'design', name: 'Design', model: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, overridden: true, instructions: 'Design persona.' },
        { id: 'coding', name: 'Coding', model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, overridden: false, instructions: 'Coding persona.' },
        { id: 'admin', name: 'Admin', model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, overridden: false, instructions: 'Admin persona.' },
        { id: 'writing', name: 'Writing', model: null, overridden: false, instructions: 'Writing persona.' },
        { id: 'free', name: 'Free', model: null, overridden: false, instructions: '' },
      ],
    },
    brainsMedia: {
      presets: [
        {
          id: 'images',
          name: 'Images',
          model: { backend: 'openrouter', model: 'google/gemini-3-pro-image' },
          candidates: [{ backend: 'openrouter', model: { id: 'google/gemini-3-pro-image', name: 'Gemini 3 Pro Image' } }],
          availability: { state: 'available' },
        },
        {
          id: 'motion',
          name: 'Motion',
          model: null,
          candidates: [],
          availability: { state: 'unavailable', reason: 'no-compatible-model', recovery: MOTION_RECOVERY, keyMissing: true },
        },
        {
          id: 'sound',
          name: 'Sound',
          model: null,
          candidates: [],
          availability: { state: 'unavailable', reason: 'no-compatible-model', recovery: 'Store a key for sound.' },
        },
      ],
    },
    terminalLaunches: {
      default: 'claude',
      byActivity: {},
      catalog: [
        { id: 'plain', label: 'Plain shell', command: '', installed: true },
        { id: 'claude-code', label: 'Claude Code', command: 'claude', installed: true },
        { id: 'codex', label: 'Codex', command: 'codex', installed: false },
      ],
    },
  }
}

describe('the tools step body', () => {
  const toolsSeed: OnboardingSeedLike = { steps: { agents: 'done' } }

  it('groups one row per brain by space, offers only routes that can answer, and pre-selects stored choices', async () => {
    mount(toolsSeed, toolsTable())
    await flush()

    const groups = [...document.querySelectorAll('[data-tools-space]')]
    expect(groups.map(group => group.getAttribute('data-tools-space'))).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    expect(groups.map(group => group.querySelector('[data-tools-space-title]')?.textContent)).toEqual([
      en['tools.space.chat'],
      en['tools.space.terminal'],
      en['tools.space.gallery'],
      en['tools.space.soundstage'],
      en['tools.space.motion'],
    ])
    expect(groups.map(group => [...group.querySelectorAll('[data-tools-row]')].map(row => row.getAttribute('data-tools-row')))).toEqual([
      ['design', 'coding', 'writing', 'admin', 'free'],
      ['cli'],
      ['images'],
      ['sound'],
      ['motion'],
    ])
    expect(document.querySelectorAll('[data-tools-row]')).toHaveLength(9)
    // Terminal asks only which CLI a fresh shell types (JJ, 14 Sep 2026): the
    // installed catalogue, the stored default pre-selected, a plain shell named as such.
    const cli = document.querySelector('[data-tools-row="cli"] [data-tools-select]') as HTMLSelectElement
    expect(screen.getByRole('combobox', { name: en['tools.cli'] })).toBe(cli)
    expect(cli.value).toBe('cli:claude-code')
    expect([...cli.options].map(option => option.textContent)).toEqual([en['tools.cli.plainShell'], 'Claude Code'])
    // Sound Stage carries the live verdict like the other generating spaces.
    expect(document.querySelector('[data-tools-row="sound"] [data-tools-unavailable]')?.textContent).toBe(en['tools.recovery.sound'])
    // The stocked-out provider lists no optgroup, and neither does one with no key that resolves.
    expect(document.querySelector('optgroup[label="Empty"]')).toBeNull()
    expect(document.querySelector('optgroup[label="OpenAI"]')).toBeNull()
    expect(document.querySelector('optgroup[label="OpenRouter"]')).not.toBeNull()

    const design = document.querySelector('[data-tools-row="design"] [data-tools-select]') as HTMLSelectElement
    expect(design.value).toBe(pack('deepseek-official', 'deepseek-v4-pro'))
    expect(screen.getByRole('combobox', { name: en['tools.design'] })).toBe(design)
    // The coding row shows the placeholder: the resolved default is not a stored choice.
    const coding = document.querySelector('[data-tools-row="coding"] [data-tools-select]') as HTMLSelectElement
    expect(coding.value).toBe('')
    expect(screen.getByRole('combobox', { name: en['tools.coding'] })).toBe(coding)
    expect(screen.getByRole('combobox', { name: en['tools.admin'] })).toBeDefined()
    const images = document.querySelector('[data-tools-row="images"] [data-tools-select]') as HTMLSelectElement
    expect(images.value).toBe(pack('openrouter', 'google/gemini-3-pro-image'))
    expect(screen.getByRole('combobox', { name: en['tools.images'] })).toBe(images)
    // Motion carries the live refusal and the same recovery action as Brains.
    const unavailable = document.querySelector('[data-tools-row="motion"] [data-tools-unavailable]')
    expect(unavailable?.getAttribute('data-tools-unavailable')).toBe('no-compatible-model')
    expect(unavailable?.textContent).toBe(MOTION_RECOVERY)
    expect(document.querySelector('[data-tools-row="motion"] [data-tools-add-key]')?.textContent).toBe(en['tools.addKey'])
    expect(document.querySelector('[data-tools-row="motion"] [data-tools-select]')).toBeNull()
    // Free is pinned and carries no control.
    // No free-tokens route: Free chooses a model like the other brains instead of claiming to be always on.
    expect(document.querySelector('[data-tools-row="free"]')?.textContent).not.toContain(en['tools.free.note'])
    expect(document.querySelector('[data-tools-row="free"] [data-tools-select]')).not.toBeNull()
  })

  it('ticks Free instead of asking for a model when the free-tokens route is registered', async () => {
    const table = toolsTable()
    table.modelsState = { providers: [...(table.modelsState as { providers: unknown[] }).providers, { provider: 'freetokens', displayName: 'Free tokens', models: ['free-a'], auth: 'free', connected: true }] }
    mount(toolsSeed, table)
    await screen.findByText(en['tools.space.chat'])
    expect([...document.querySelectorAll('[data-tools-space="chat"] [data-tools-row]')].map(row => row.getAttribute('data-tools-row'))).toEqual(['design', 'coding', 'writing', 'admin', 'free'])
    expect(document.querySelector('[data-tools-row="free"]')?.textContent).toContain(en['tools.free.note'])
    expect(document.querySelector('[data-tools-row="free"] [data-tools-select]')).toBeNull()
  })

  it('asks no CLI where the launches route is absent, and names a command outside the catalogue', async () => {
    const table = toolsTable()
    delete table.terminalLaunches
    mount(toolsSeed, table)
    await flush()
    expect(document.querySelector('[data-tools-space="terminal"]')).toBeNull()
    expect(document.querySelectorAll('[data-tools-row]')).toHaveLength(8)
    cleanup()

    const custom = toolsTable()
    ;(custom.terminalLaunches as { default: string }).default = 'my-agent --fast'
    mount(toolsSeed, custom)
    await flush()
    const cli = document.querySelector('[data-tools-row="cli"] [data-tools-select]') as HTMLSelectElement
    expect(cli.value).toBe('custom')
    expect(cli.options[0]?.textContent).toBe('Custom · my-agent --fast')
  })

  it('hides the add-key action when a key would not change the verdict', async () => {
    const table = toolsTable()
    const media = table.brainsMedia as { presets: { id: string; availability: unknown }[] }
    const motion = media.presets.find(row => row.id === 'motion')!
    motion.availability = { state: 'unavailable', reason: 'no-compatible-model', recovery: MOTION_RECOVERY, keyMissing: false }
    mount(toolsSeed, table)
    await flush()
    expect(document.querySelector('[data-tools-row="motion"] [data-tools-unavailable]')).toBeTruthy()
    expect(document.querySelector('[data-tools-row="motion"] [data-tools-add-key]')).toBeNull()
  })

  it('saves a recovery key, reloads Tools, and retains model choices', async () => {
    const table = toolsTable()
    const { calls } = mount(toolsSeed, table)
    await flush()

    const coding = document.querySelector('[data-tools-row="coding"] [data-tools-select]') as HTMLSelectElement
    fireEvent.change(coding, { target: { value: pack('openrouter', 'openai/gpt-5.2') } })
    fireEvent.click(document.querySelector('[data-tools-add-key]')!)
    await flush()

    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('agents')
    const keyField = document.querySelector('[data-agent-key]') as HTMLInputElement
    expect(keyField).not.toBeNull()
    expect(document.activeElement).toBe(keyField)

    fireEvent.change(keyField, { target: { value: 'sk-or-recovery' } })
    table.agents = { claudeCode: { installed: false }, openrouter: { connected: true } }
    fireEvent.click(screen.getByText(en['agents.openrouter.connect']))
    await flush()

    const media = (table.brainsMedia as { presets: MediaRowState[] }).presets
    const motion = media.find(row => row.id === 'motion')!
    motion.availability = { state: 'available' }
    motion.candidates = [{ backend: 'openrouter', model: { id: 'video/model', name: 'Video model' } }]
    fireEvent.click(continueButton())
    await flush()

    expect(calls.filter(call => call.path === '/idealize/brains/media' && call.method === 'GET')).toHaveLength(2)
    const restored = document.querySelector('[data-tools-row="coding"] [data-tools-select]') as HTMLSelectElement
    expect(restored.value).toBe(pack('openrouter', 'openai/gpt-5.2'))
    expect(screen.getByRole('combobox', { name: en['tools.motion'] })).toBeDefined()
  })

  it('opens an editable key field when OpenRouter is already connected', async () => {
    const table = toolsTable()
    table.agents = { claudeCode: { installed: false }, openrouter: { connected: true } }
    mount(toolsSeed, table)
    await flush()

    fireEvent.click(document.querySelector('[data-tools-add-key]')!)
    await flush()

    expect(document.querySelector('[data-agent-key]')).not.toBeNull()
    expect(document.querySelector('[data-agent-connect]')?.textContent).toBe(en['agents.openrouter.replace'])
    expect(continueButton().hasAttribute('disabled')).toBe(false)
  })

  it('states a missing generation adapter without offering a provider key', async () => {
    const table = toolsTable()
    const rows = (table.brainsMedia as { presets: MediaRowState[] }).presets
    const motion = rows.find(row => row.id === 'motion')!
    motion.availability = {
      state: 'unavailable',
      reason: 'no-backend',
      recovery: 'No generation adapter is registered. Enable one, then reopen this step.',
    }
    mount(toolsSeed, table)
    await flush()

    const unavailable = document.querySelector('[data-tools-row="motion"] [data-tools-unavailable]')
    expect(unavailable?.getAttribute('data-tools-unavailable')).toBe('no-backend')
    expect(unavailable?.textContent).toBe(en['tools.recovery.noBackend'])
    expect(document.querySelector('[data-tools-row="motion"] [data-tools-add-key]')).toBeNull()
  })

  it('saves only the rows the user changed, with the exact POST payloads', async () => {
    const { calls } = mount(toolsSeed, toolsTable())
    await flush()

    const coding = document.querySelector('[data-tools-row="coding"] [data-tools-select]') as HTMLSelectElement
    fireEvent.change(coding, { target: { value: pack('openrouter', 'openai/gpt-5.2') } })
    const images = document.querySelector('[data-tools-row="images"] [data-tools-select]') as HTMLSelectElement
    fireEvent.change(images, { target: { value: pack('openrouter', 'google/gemini-3-pro-image') } })
    const cli = document.querySelector('[data-tools-row="cli"] [data-tools-select]') as HTMLSelectElement
    fireEvent.change(cli, { target: { value: 'cli:plain' } })

    fireEvent.click(continueButton())
    await flush()

    const saves = calls.filter(call => call.method === 'POST')
    expect(saves).toEqual([
      {
        path: '/idealize/activity/agent',
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: {
          id: 'coding',
          name: 'Coding',
          model: { provider: 'openrouter', model: 'openai/gpt-5.2' },
          // The persona round-trips so the save does not reset it.
          instructions: 'Coding persona.',
        },
      },
      {
        path: '/idealize/brains/media',
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: { id: 'images', model: { backend: 'openrouter', model: 'google/gemini-3-pro-image' } },
      },
      {
        // The command travels whole, as the Brains pane sends it; a plain shell is the empty command.
        path: '/idealize/terminal/launch',
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: { command: '' },
      },
    ])
    // The step completed and advanced to the projects folder.
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('projects-folder')
  })

  it('blocks completion on a failed row and names the reason against it', async () => {
    const table = toolsTable()
    table.posts = {
      '/idealize/activity/agent': { status: 400, body: { ok: false, error: 'the model list is stale' } },
    }
    mount(toolsSeed, table)
    await flush()

    const design = document.querySelector('[data-tools-row="design"] [data-tools-select]') as HTMLSelectElement
    fireEvent.change(design, { target: { value: pack('deepseek-official', 'deepseek-v4-flash') } })
    fireEvent.click(continueButton())
    await flush()

    expect(document.querySelector('[data-tools-row="design"] [data-tools-error]')?.textContent).toBe('the model list is stale')
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('tools')
  })
})

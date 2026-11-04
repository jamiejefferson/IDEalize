// @vitest-environment jsdom
// The Brains pane (Paper "Brains rethink", boards 10 to 12): the three tabs over
// the /idealize routes, one row per brain with a mark for whether it can answer,
// each row stating its model as text, a place's own generation-model row and its
// unavailable state, Behind the scenes, the edit sheet with its detail behind
// More options (the one place a model is chosen), and Accounts (the free-token
// engine has no controls of its own). The budget tables moved to the Time & cost
// pane (work-panel.client.spec.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { BrainsPanel, type BrainsPanelHost } from '../src/client/BrainsPanel.tsx'
// Type-only: the locale-namespace merge the translate face reads.
import type {} from '../src/client/index.ts'

const t = makeTranslate(en, commonEn)
const MOTION_RECOVERY = en['brains.media.recovery.video']

const STATE = {
  mode: 'auto',
  readAt: '2026-09-08T09:12:00.000Z',
  default: { provider: 'freetokens', model: 'auto' },
  preferences: { cost: 34, speed: 33, intelligence: 33 },
  providers: [
    { provider: 'openai-codex', displayName: 'OpenAI (ChatGPT)', auth: 'oauth', connected: true, models: ['gpt-5.5'] },
    { provider: 'anthropic', displayName: 'Anthropic', auth: 'apiKey', connected: false, models: ['claude'] },
    { provider: 'freetokens', displayName: 'Free tokens', auth: 'free', connected: true, models: ['auto', 'k3'] },
  ],
}
/** The router's state: app-wide values, the shipped row for Coding, and nothing saved. */
const ROUTER_STATE = {
  settings: { offBrains: [], aggressiveness: 'balanced' },
  weights: { cost: 34, speed: 33, intelligence: 33 },
  brains: {},
  shippedBrains: { coding: { cost: 10, speed: 80, intelligence: 80 } },
}
const AGENTS = {
  agents: [
    { id: 'coding', name: 'Coding', activity: true, modelPinned: false, spaces: ['chat', 'terminal'], model: { provider: 'freetokens', model: 'auto' }, overridden: false, instructions: 'Build things.' },
    { id: 'design', name: 'Design', activity: true, modelPinned: false, spaces: ['chat', 'terminal'], model: { provider: 'openai-codex', model: 'gpt-5.5' }, overridden: true, instructions: '' },
    // Free works in Chat alone, and the free-tokens route pins its model, so
    // its row states the model and the sheet offers no choice for it.
    { id: 'free', name: 'Free', activity: true, modelPinned: true, spaces: ['chat'], model: { provider: 'freetokens', model: 'auto' }, overridden: false, instructions: 'Help.' },
    // The Gallery brain chats on the deployment default, whose route has no
    // stored key: its row says so and offers the key editor.
    { id: 'gallery', name: 'Gallery agent', activity: false, modelPinned: false, spaces: ['gallery'], model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, access: { state: 'unavailable', reason: 'no-access', model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, overridden: false, instructions: 'Make images.' },
    { id: 'lead-agent', name: 'Lead Agent', activity: false, modelPinned: false, spaces: [], model: null, overridden: false, instructions: 'Lead.' },
  ],
  terminal: [{ provider: 'anthropic', cli: 'claude', installed: true }],
}
/** The roster route: the declared spaces, in the order the groups render in. */
const SPACE_ROSTER = {
  spaces: [
    { id: 'chat', brainCount: 3, brains: [], models: 'some' },
    { id: 'terminal', brainCount: 2, brains: [], models: 'some' },
    { id: 'gallery', brainCount: 1, brains: [], models: 'some' },
    { id: 'soundstage', brainCount: 0, brains: [], models: 'some' },
    { id: 'motion', brainCount: 0, brains: [], models: 'none', reason: 'no-compatible-model', recovery: MOTION_RECOVERY },
  ],
}
/** Whether Motion's refusal is one a key would clear; a test flips it. */
let motionKeyMissing = true
let soundBackend = 'mediahub'
/** The media route's roster: Images chosen, Sound unchosen, Motion unavailable. */
const MEDIA = () => ({
  presets: [
    {
      id: 'images',
      name: 'Images',
      model: { backend: 'mediahub', model: 'still-a' },
      candidates: [
        { backend: 'mediahub', model: { id: 'still-a', name: 'Still A' } },
        { backend: 'mediahub', model: { id: 'still-b', name: 'Still B' } },
      ],
      availability: { state: 'available', backends: ['mediahub'], models: 2 },
    },
    {
      id: 'motion',
      name: 'Motion',
      model: null,
      candidates: [],
      availability: { state: 'unavailable', reason: 'no-compatible-model', recovery: MOTION_RECOVERY, keyMissing: motionKeyMissing },
    },
    {
      id: 'sound',
      name: 'Sound',
      model: null,
      candidates: [{ backend: soundBackend, model: { id: 'tone-a', name: 'Tone A' } }],
      availability: { state: 'available', backends: ['mediahub'], models: 1 },
    },
  ],
})
/** An instant as the panel prints it. */
const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Claude on subscription runs as Claude Code in the terminal: the chat cannot reach it, the terminal can. */
const WRITER = { id: 'writer', name: 'Writer', activity: false, modelPinned: false, spaces: ['chat', 'terminal'], model: { provider: 'anthropic', model: 'claude-opus-5' }, access: { state: 'unavailable', reason: 'terminal-only', model: { provider: 'anthropic', model: 'claude-opus-5' } }, overridden: true, instructions: 'Write.' }

/** The agents payload a test mounts over; `install` resets it to the shared fixture. */
let agentsPayload: typeof AGENTS

/** The router payload a test mounts over; `install` resets it to the shared fixture. */
let routerPayload: object

/** The models-state payload a test mounts over; `install` resets it to the shared fixture. */
let statePayload: typeof STATE

/** GET /idealize/terminal/launches, as the desktop app serves it (a plain browser gets no catalogue). */
const LAUNCHES = {
  default: 'claude --dangerously-skip-permissions',
  byActivity: { design: 'codex' },
  catalog: [
    { id: 'claude-code', label: 'Claude Code', command: 'claude --dangerously-skip-permissions', installed: true },
    { id: 'codex', label: 'Codex CLI', command: 'codex', installed: true },
    { id: 'gemini', label: 'Gemini CLI', command: 'gemini', installed: false },
    { id: 'shell', label: 'Plain shell', command: '', installed: true },
  ],
}
let launchesPayload: typeof LAUNCHES | { default: string; byActivity: Record<string, string> }

type Call = { url: string; init?: RequestInit }
let calls: Call[]
let mediaKeys: { backend: string; displayName: string; env: string; connected: boolean }[] = []
/** The rows GET /idealize/brains/services serves: chat routes and generation backends in one list. */
let servicesList: {
  id: string
  kind: 'chat' | 'media'
  name: string
  makes: string[]
  connected: boolean
  keyUrl?: string
}[] = []

/** The JSON a POST carried. */
const sent = (call: Call): unknown => JSON.parse(call.init?.body as string)

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function install(): void {
  calls = []
  followed.length = 0
  agentsPayload = AGENTS
  routerPayload = ROUTER_STATE
  statePayload = STATE
  launchesPayload = LAUNCHES
  motionKeyMissing = true
  soundBackend = 'mediahub'
  mediaKeys = [{ backend: 'fal', displayName: 'fal.ai', env: 'FAL_KEY', connected: false }]
  servicesList = [
    { id: 'deepseek', kind: 'chat', name: 'DeepSeek', makes: ['chat'], connected: true },
    { id: 'acme', kind: 'chat', name: 'Acme Gateway', makes: ['chat'], connected: false },
    { id: 'fal', kind: 'media', name: 'fal.ai', makes: ['image', 'video', 'audio'], connected: false, keyUrl: 'https://fal.ai/dashboard/keys' },
  ]
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, ...init === undefined ? {} : { init } })
    if (url.startsWith('/idealize/models/state')) return Promise.resolve(json(statePayload))
    if (url === '/idealize/router/state') return Promise.resolve(json(routerPayload))
    if (url.startsWith('/idealize/activity/agents')) return Promise.resolve(json(agentsPayload))
    if (url.startsWith('/idealize/terminal/launches')) return Promise.resolve(json(launchesPayload))
    if (url === '/idealize/brains/media' && init?.method !== 'POST') return Promise.resolve(json(MEDIA()))
    if (url === '/idealize/brains/media-keys' && init?.method !== 'POST') return Promise.resolve(json({ providers: mediaKeys }))
    if (url === '/idealize/brains/media-keys') {
      mediaKeys = mediaKeys.map(row => ({ ...row, connected: true }))
      return Promise.resolve(json({ ok: true, backend: 'fal', connected: true }))
    }
    if (url === '/idealize/brains/services' && init?.method !== 'POST') return Promise.resolve(json({ services: servicesList }))
    if (url === '/idealize/brains/services/import') {
      const body = JSON.parse(init?.body as string) as { credentials?: Record<string, string> }
      if (body.credentials?.NOBODY_API_KEY !== undefined) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'NOBODY_API_KEY is not a credential any service this app can connect takes' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        }))
      }
      servicesList = servicesList.map(row => row.id === 'acme' || row.id === 'fal' ? { ...row, connected: true } : row)
      return Promise.resolve(json({
        connected: [{ id: 'acme', kind: 'chat', name: 'Acme Gateway' }, { id: 'fal', kind: 'media', name: 'fal.ai' }],
        services: servicesList,
      }))
    }
    if (url === '/idealize/brains/services') {
      const body = JSON.parse(init?.body as string) as { id: string; apiKey?: string }
      if (body.apiKey === 'refused-key') {
        return Promise.resolve(new Response(JSON.stringify({ error: 'The key is saved, but Acme Gateway could not be switched on. no models' }), {
          status: 500, headers: { 'content-type': 'application/json' },
        }))
      }
      servicesList = servicesList.map(row => row.id === body.id ? { ...row, connected: true } : row)
      return Promise.resolve(json({ services: servicesList }))
    }
    if (url === '/idealize/spaces') return Promise.resolve(json(SPACE_ROSTER))
    return Promise.resolve(json({ ok: true }))
  }))
}

/** The brains the open chat was moved onto, in save order. */
const followed: string[] = []

const host: BrainsPanelHost = {
  models: {
    Component: () => <div data-testid="provider-editor" />,
    props: {} as unknown as BrainsPanelHost['models']['props'],
  },
  followBrain: async (brainId) => { followed.push(brainId) },
}

async function mount() {
  const view = render(<BrainsPanel host={host} t={t} />)
  await waitFor(() => { expect(view.container.querySelector('[data-brains-group="conversation"] [data-brain]')).not.toBeNull() })
  return view
}

/** The Brains pane with its add sheet open on one place, as the welcome card opens it. */
async function mountAdding(space: string) {
  const view = render(<BrainsPanel host={host} t={t} request={{ kind: 'add-brain', space }} />)
  await waitFor(() => { expect(view.getByRole('form', { name: 'Edit brain' })).toBeTruthy() })
  return view
}

/** Open the sheet's More options. */
const more = (view: RenderResult): void => {
  fireEvent.click(view.getByRole('button', { name: 'More options' }))
}

/** Open a brain's sheet from its row. */
const edit = (view: RenderResult, brain: string): void => {
  fireEvent.click(within(view.container.querySelector<HTMLElement>(`[data-brain="${brain}"]`)!).getByRole('button', { name: 'Edit' }))
}

const posts = (path: string): Call[] => calls.filter(call => call.url === path && call.init?.method === 'POST')

/** The open sheet's model field (`model` or `chatModel`): the row that names the choice and opens the browser. */
const modelRow = (view: RenderResult, field: 'model' | 'chatModel' = 'model'): HTMLElement =>
  view.getByRole('form', { name: 'Edit brain' }).querySelector<HTMLElement>(`[data-brains-model-row="${field}"]`)!

/** Open a model field's browser, which renders over the whole window, and wait for its catalogue. */
async function openBrowser(view: RenderResult, field: 'model' | 'chatModel' = 'model'): Promise<HTMLElement> {
  fireEvent.click(within(modelRow(view, field)).getByRole('button', { name: 'Change' }))
  return waitFor(() => {
    const browser = document.body.querySelector<HTMLElement>('[data-model-browser]')
    expect(browser?.querySelector('[data-browser-row]')).toBeTruthy()
    return browser!
  })
}

/** The names a browser's list shows, in order. */
const listed = (browser: HTMLElement): string[] =>
  [...browser.querySelectorAll('[data-browser-row]')].map(row => row.querySelector('span')?.firstChild?.textContent ?? '')

/** Choose one model in a field's browser and apply it. */
async function choose(view: RenderResult, value: string, field: 'model' | 'chatModel' = 'model'): Promise<void> {
  const browser = await openBrowser(view, field)
  fireEvent.click(browser.querySelector(`[data-browser-row="${value}"]`)!)
  fireEvent.click(browser.querySelector('[data-browser-apply]')!)
  await waitFor(() => { expect(document.body.querySelector('[data-model-browser]')).toBeNull() })
}

beforeEach(install)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BrainsPanel', () => {
  /** The group a place's rows sit in: conversation for Chat and Terminal, making for the rest. */
  const group = (view: RenderResult, space: string): HTMLElement => {
    const name = space === 'chat' || space === 'terminal' ? 'conversation' : 'making'
    const found = view.container.querySelector(`[data-brains-group="${name}"]`)
    if (found === null) throw new Error(`no ${name} group`)
    return found as HTMLElement
  }

  it('opens on Brains with brain rows stating their model as text, and no second picker for the coordinator role', async () => {
    // JJ, 7 Sep 2026: "drop down not needed in brains - just choose model in edit".
    const view = await mount()
    expect(view.getByRole('tab', { name: 'Brains', selected: true })).toBeTruthy()
    const chat = group(view, 'chat')
    const modelText = (id: string): string | null | undefined =>
      chat.querySelector(`[data-brain="${id}"] [data-brain-model]`)?.getAttribute('data-brain-model')
    // The row names the model and how it is paid for, never a raw route id.
    expect(modelText('coding')).toBe('Best free model')
    expect(modelText('design')).toBe('GPT 5.5 · On your plan')
    expect(chat.querySelector('[data-brain="design"] [data-brain-model]')?.textContent).toBe('GPT 5.5 · On your plan')
    // No row carries a per-brain select; the Edit sheet is where a model is chosen.
    expect(chat.querySelectorAll('[data-brain] select')).toHaveLength(0)
    expect(group(view, 'gallery').querySelectorAll('select')).toHaveLength(0)
    // JJ, 7 Sep 2026: the Project Coordinator row under Agent roles is the
    // role; a "Project leadership" picker beneath it read as the same role twice.
    expect(view.queryByRole('table', { name: 'Project leadership' })).toBeNull()
    expect(calls.some(call => call.url.startsWith('/idealize/comm/roles'))).toBe(false)
  })

  it('lists models by name in every browser while no price orders them, whatever order the routes serve', async () => {
    // JJ, 7 Sep 2026: "model sorting in dropdowns, needs to be in alphabetical order".
    statePayload = {
      ...STATE,
      providers: [
        { provider: 'openai-codex', displayName: 'OpenAI (ChatGPT)', auth: 'oauth', connected: true, models: ['gpt-5.5', 'gpt-5.10', 'Gpt-4'] },
        { provider: 'anthropic', displayName: 'Anthropic', auth: 'apiKey', connected: false, models: ['claude'] },
        { provider: 'freetokens', displayName: 'Free tokens', auth: 'free', connected: true, models: ['k3', 'auto'] },
      ],
    }
    const view = await mount()
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    // The sheet names the choice (none yet, so the default) and Change opens the browser.
    expect(within(modelRow(view)).getByText('Default: Best free model')).toBeTruthy()
    const browser = await openBrowser(view)
    expect(listed(browser)).toEqual(['auto', 'claude', 'Gpt-4', 'gpt-5.5', 'gpt-5.10', 'k3'])
    // Each row names who serves it; Anthropic's carries its terminal-CLI mark.
    const claude = browser.querySelector('[data-browser-row="anthropic claude"] [data-browser-byline]')
    expect(claude?.textContent).toBe('Anthropic · claude CLI in the terminal')
    fireEvent.click(within(browser).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    // A generating brain's browser orders the space's candidates the same way.
    fireEvent.click(within(group(view, 'gallery')).getByRole('button', { name: 'Edit' }))
    const images = await openBrowser(view)
    expect(images.getAttribute('data-model-browser')).toBe('image')
    expect(listed(images)).toEqual(['Still A', 'Still B'])
    fireEvent.click(within(images).getByRole('button', { name: 'Cancel' }))
    more(view)
    expect(listed(await openBrowser(view, 'chatModel'))).toEqual(['auto', 'claude', 'Gpt-4', 'gpt-5.5', 'gpt-5.10', 'k3'])
  })

  it('names a sign-in, not a key, under a brain whose route is a subscription nobody is signed in to', async () => {
    // JJ, 7 Sep 2026: Gallery, Sound Stage and Video all read "No key for
    // openai-codex" with Add key, when that route takes a sign-in and no key.
    agentsPayload = {
      ...AGENTS,
      agents: AGENTS.agents.map(row => row.id !== 'gallery' ? row : {
        ...row,
        model: { provider: 'openai-codex', model: 'gpt-5.5' },
        providerName: 'OpenAI (ChatGPT)',
        access: { state: 'unavailable', reason: 'no-sign-in', model: { provider: 'openai-codex', model: 'gpt-5.5' } },
      }),
    }
    const view = await mount()
    const note = group(view, 'gallery').querySelector('[data-brain-access]')
    expect(note?.getAttribute('data-brain-access')).toBe('no-sign-in')
    expect(note?.textContent).toContain('Needs a sign-in to OpenAI (ChatGPT).')
    expect(within(note as HTMLElement).queryByRole('button', { name: 'Connect' })).toBeNull()
    const link = within(note as HTMLElement).getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/idealize/signin')
  })

  it('offers a key and a sign-in on a route that takes either', async () => {
    // JJ, 4 Nov 2026: someone holding an OpenRouter key was told to sign in.
    agentsPayload = {
      ...AGENTS,
      agents: AGENTS.agents.map(row => row.id !== 'gallery' ? row : {
        ...row,
        model: { provider: 'openrouter', model: 'some/model' },
        providerName: 'OpenRouter',
        access: { state: 'unavailable', reason: 'no-access', signInOffered: true, model: { provider: 'openrouter', model: 'some/model' } },
      }),
    }
    const view = await mount()
    const note = group(view, 'gallery').querySelector('[data-brain-access]') as HTMLElement
    expect(note.textContent).toContain('Needs an account on OpenRouter.')
    expect(within(note).getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(within(note).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/idealize/signin')
    expect(view.container.querySelector('[data-service="openrouter"]')).toBeNull()
  })

  it('asks a brain for a chat key when it works in Chat, but not when it only runs in a terminal with its own login', async () => {
    const needsKey = { state: 'unavailable', reason: 'no-access', signInOffered: true, model: { provider: 'openrouter', model: 'some/model' } }
    const base = { activity: false, modelPinned: false, model: { provider: 'openrouter', model: 'some/model' }, providerName: 'OpenRouter', overridden: false, instructions: '', access: needsKey }
    agentsPayload = {
      ...AGENTS,
      agents: [
        ...AGENTS.agents,
        { ...base, id: 'both', name: 'Both', spaces: ['chat', 'terminal'] },
        { ...base, id: 'pilot', name: 'Pilot', spaces: ['terminal'] },
      ],
    }
    const view = await mount()
    const row = (id: string): Element => group(view, 'chat').querySelector(`[data-brain="${id}"]`)!
    expect(row('both').querySelector('[data-brain-access]')).not.toBeNull()
    expect(row('both').querySelector('[data-brain-mark]')?.getAttribute('data-brain-mark')).toBe('needs')
    expect(row('pilot').querySelector('[data-brain-access]')).toBeNull()
    expect(row('pilot').querySelector('[data-brain-mark]')?.getAttribute('data-brain-mark')).toBe('ready')
  })

  it('opens the route\'s own key field from Add key', async () => {
    // The editor sheet never listed OpenRouter, so the button led nowhere.
    agentsPayload = {
      ...AGENTS,
      agents: AGENTS.agents.map(row => row.id !== 'gallery' ? row : {
        ...row,
        model: { provider: 'fal', model: 'some/model' },
        access: { state: 'unavailable', reason: 'no-access', model: { provider: 'fal', model: 'some/model' } },
      }),
    }
    const view = await mount()
    const note = group(view, 'gallery').querySelector('[data-brain-access]') as HTMLElement
    fireEvent.click(within(note).getByRole('button', { name: 'Connect' }))
    const row = await waitFor(() => {
      const found = view.container.querySelector('[data-service="fal"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(row.querySelector('input[type="password"]')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks a generating brain for its chat model too, and saves it as the brain\'s own override', async () => {
    // A brain confined to Gallery generates on the space's model and talks
    // through a chat model; with only the first on offer, a brain whose
    // default route was unreachable had no way out but changing that default
    // for every other brain (JJ, 7 Sep 2026).
    const changed = vi.fn()
    document.addEventListener('idealize:brains-changed', changed)
    const view = await mount()
    fireEvent.click(within(group(view, 'gallery')).getByRole('button', { name: 'Edit' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    // The plain questions come first; the detail waits behind More options.
    const fields = (): (string | null)[] => [...sheet.querySelectorAll('[data-brains-field]')].map(node => node.getAttribute('data-brains-field'))
    expect(fields()).toEqual(['name', 'what', 'model'])
    more(view)
    expect(fields()).toEqual(['name', 'what', 'model', 'spaces', 'chat-model'])
    expect(within(sheet).getByRole('group', { name: 'Runs on' })).toBeTruthy()
    // No override yet, so the field follows the default.
    expect(within(sheet).getByRole('group', { name: 'Chat model' }).getAttribute('data-value')).toBe('')
    await choose(view, 'anthropic claude', 'chatModel')
    expect(modelRow(view, 'chatModel').getAttribute('data-value')).toBe('anthropic claude')
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/activity/agent')).toHaveLength(1) })
    expect(sent(posts('/idealize/activity/agent')[0]!)).toEqual({
      id: 'gallery', name: 'Gallery agent', model: { provider: 'anthropic', model: 'claude' }, instructions: 'Make images.', spaces: ['gallery'],
    })
    // The generation model was left as stored, so the media route is asked to keep it.
    await waitFor(() => { expect(posts('/idealize/brains/media')).toHaveLength(1) })
    expect(sent(posts('/idealize/brains/media')[0]!)).toEqual({ id: 'images', model: { backend: 'mediahub', model: 'still-a' } })
    // Every save tells the welcome card to reload its roster, and hands the
    // saved brain to the plugin so a chat running it takes the new model.
    await waitFor(() => { expect(changed).toHaveBeenCalled() })
    await waitFor(() => { expect(followed).toEqual(['gallery']) })
    document.removeEventListener('idealize:brains-changed', changed)
    // A Chat brain's sheet has the one model field, as before.
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    more(view)
    expect(within(view.getByRole('form', { name: 'Edit brain' })).queryByRole('group', { name: 'Chat model' })).toBeNull()
  })

  it('lists each brain once, conversation first, then making, then one way to add a brain', async () => {
    const view = await mount()
    const brains = (name: string): (string | null)[] =>
      [...view.container.querySelectorAll(`[data-brains-group="${name}"] [data-brain]`)].map(row => row.getAttribute('data-brain'))
    expect(brains('conversation')).toEqual(['coding', 'design', 'free'])
    expect(brains('making')).toEqual(['gallery'])
    // Where a brain works reads on its one row.
    expect(group(view, 'chat').querySelector('[data-brain="coding"] [data-brain-places]')?.textContent).toBe('Chat · Terminal')
    expect(group(view, 'chat').querySelector('[data-brain="free"] [data-brain-places]')?.textContent).toBe('Chat')
    // A brain's purpose is stated in words.
    expect(group(view, 'chat').querySelector('[data-brain="coding"] [data-brain-purpose]')?.textContent).toBe('Builds and changes software')
    // The Gallery brain states the place's model, so no Images row repeats it;
    // a place with no brain keeps its own row.
    expect([...group(view, 'gallery').querySelectorAll('[data-media-preset]')].map(row => row.getAttribute('data-media-preset')))
      .toEqual(['sound', 'motion'])
    expect(view.getAllByRole('button', { name: 'Add a brain' })).toHaveLength(1)
    expect(group(view, 'chat').querySelector('[data-terminal-default-cli]')).not.toBeNull()
  })

  it('marks whether each brain can answer, and the strip agrees with the rows', async () => {
    // JJ, 4 Nov 2026: "i also like the stronger indicator to say whether or not
    // something is actually working".
    const view = await mount()
    const mark = (id: string): string | null | undefined =>
      view.container.querySelector(`[data-brain="${id}"] [data-brain-mark]`)?.getAttribute('data-brain-mark')
    expect(mark('coding')).toBe('ready')
    // Its generation model is there, but the chat route driving it has no key.
    expect(mark('gallery')).toBe('needs')
    const strip = (id: string): string | null | undefined =>
      [...view.container.querySelectorAll('[data-space-status]')].find(node => node.textContent?.includes(id))?.getAttribute('data-space-status')
    await waitFor(() => { expect(strip('Chat')).toBe('ready') })
    expect(strip('Images')).toBe('needs')
    expect(strip('Sounds')).toBe('ready')
    expect(strip('Video')).toBe('needs')
    // Chat works, so the setup line stays away.
    expect(view.container.querySelector('[data-brains-readiness]')).toBeNull()
    // A place that needs attention leads to Accounts.
    fireEvent.click([...view.container.querySelectorAll('[data-space-status="needs"]')][0]!)
    expect(view.getByRole('tab', { name: 'Accounts', selected: true })).toBeTruthy()
  })

  it('asks for an account only while no chat brain can answer', async () => {
    const blocked = { state: 'unavailable', reason: 'no-access', model: { provider: 'openrouter', model: 'some/model' } }
    agentsPayload = {
      ...AGENTS,
      agents: AGENTS.agents.map(row => (row.spaces as readonly string[]).includes('chat') ? { ...row, access: blocked } as unknown as typeof row : row),
    }
    const view = await mount()
    const line = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-brains-readiness]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(line.textContent).toContain('Connect an account so these brains can answer.')
    fireEvent.click(within(line).getByRole('button', { name: 'Connect' }))
    expect(view.getByRole('tab', { name: 'Accounts', selected: true })).toBeTruthy()
  })

  it('lists Free with its pinned model stated and Edit beside it', async () => {
    const view = await mount()
    const chatRow = group(view, 'chat').querySelector('[data-brain="free"]')
    if (chatRow === null) throw new Error('Free is missing from chat')
    const pinned = chatRow.querySelector('[data-brain-pinned]')
    expect(pinned?.textContent).toBe('Best free model')
    expect(pinned?.getAttribute('data-brain-model')).toBe('Best free model')
    expect(within(chatRow as HTMLElement).getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('says Free models are not set up, and leads to their page, when Free has no model', async () => {
    agentsPayload = {
      ...AGENTS,
      agents: AGENTS.agents.map(row => row.id !== 'free' ? row : { ...row, model: null, access: { state: 'unavailable', reason: 'no-model' } } as unknown as typeof row),
    }
    const view = await mount()
    const row = group(view, 'chat').querySelector<HTMLElement>('[data-brain="free"]')!
    expect(row.querySelector('[data-brain-access]')?.textContent).toContain('Free models aren\'t set up yet.')
    expect(within(row).getByRole('link', { name: 'Set up' }).getAttribute('href')).toBe('/idealize/freetokens')
  })

  it('keeps only the spaceless brains behind the scenes', async () => {
    const view = await mount()
    expect(view.container.querySelector('[data-brains-behind] summary')?.textContent).toBe('Behind the scenes (1)')
    const others = view.container.querySelector<HTMLElement>('[data-brains-behind]')!
    expect([...others.querySelectorAll('[data-brain]')].map(row => row.getAttribute('data-brain'))).toEqual(['lead-agent'])
    expect(others.querySelector('[data-brain="lead-agent"] [data-brain-places]')).toBeNull()
    expect(within(others).getByRole('button', { name: 'Add agent role', hidden: true })).toBeTruthy()
  })

  it('states a chat brain\'s model on its row and saves a new choice through the sheet alone', async () => {
    const view = await mount()
    const row = group(view, 'chat').querySelector<HTMLElement>('[data-brain="coding"]')!
    expect(row.querySelector('[data-brain-model]')?.getAttribute('data-brain-model')).toBe('Best free model')
    expect(row.querySelector('select')).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    // The sheet opens on the row's current choice: none, so the default.
    expect(modelRow(view).getAttribute('data-value')).toBe('')
    await choose(view, 'anthropic claude')
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/activity/agent')).toHaveLength(1) })
    const post = posts('/idealize/activity/agent')[0]!
    // The sheet saves the brain whole: its spaces travel, so it stays in its groups.
    expect(sent(post)).toEqual({
      id: 'coding', name: 'Coding', model: { provider: 'anthropic', model: 'claude' }, instructions: 'Build things.', spaces: ['chat', 'terminal'],
    })
    expect((post.init?.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
  })

  it('states a generating brain\'s model by name on its row, and its sheet picks from the space\'s capability-filtered candidates', async () => {
    const view = await mount()
    // The Gallery brain's row names the stored generation model.
    const row = group(view, 'gallery').querySelector<HTMLElement>('[data-brain="gallery"]')!
    expect(row.querySelector('[data-brain-model]')?.getAttribute('data-brain-model')).toBe('Still A')
    expect(row.querySelector('select')).toBeNull()
    // Its sheet's generation select offers exactly Gallery's compatible
    // candidates, the stored one selected; no chat model is among them.
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(modelRow(view).getAttribute('data-value')).toBe('mediahub still-a')
    const images = await openBrowser(view)
    expect(listed(images)).toEqual(['Still A', 'Still B'])
    // The browser opens on the model in use, marked as such.
    expect(images.querySelector('[data-in-use]')?.getAttribute('data-browser-row')).toBe('mediahub still-a')
    expect(within(images).getByRole('button', { name: 'Keep Still A' })).toBeTruthy()
    fireEvent.click(images.querySelector('[data-browser-row="mediahub still-b"]')!)
    fireEvent.click(within(images).getByRole('button', { name: 'Use Still B' }))
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/brains/media')).toHaveLength(1) })
    const post = posts('/idealize/brains/media')[0]!
    expect(sent(post)).toEqual({ id: 'images', model: { backend: 'mediahub', model: 'still-b' } })
    expect((post.init?.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
    // Sound Stage has no brain, so the space's own row states the model a
    // generate call falls to while nothing is chosen, as text; adding a brain
    // for the space is where that model gets chosen.
    const sound = group(view, 'soundstage').querySelector<HTMLElement>('[data-media-preset="sound"]')!
    expect(sound.querySelector('[data-brain-model]')?.getAttribute('data-brain-model')).toBe('Tone A')
    expect(sound.querySelector('select')).toBeNull()
  })

  it('does not tick a generating brain whose only models sit on a service with no key', async () => {
    // The route says available from a public catalogue, which nobody can run without the key.
    soundBackend = 'fal'
    const view = await mount()
    const row = await waitFor(() => {
      const found = view.container.querySelector('[data-media-preset="sound"]')
      expect(found).not.toBeNull()
      return found!
    })
    await waitFor(() => { expect(row.querySelector('[data-media-reason]')?.textContent).toBe('Needs a fal.ai account.') })
    expect(row.querySelector('[data-brain-mark]')?.getAttribute('data-brain-mark')).toBe('needs')
  })

  it("states Motion's live reason in its own group, with the add-key recovery only while a key is what is missing", async () => {
    const view = await mount()
    const motion = group(view, 'motion')
    expect(within(motion).queryByRole('combobox')).toBeNull()
    expect(motion.querySelector('[data-media-reason]')?.getAttribute('data-media-reason')).toBe('no-compatible-model')
    expect(within(motion).getByText(MOTION_RECOVERY)).toBeTruthy()
    fireEvent.click(within(motion).getByRole('button', { name: 'Connect OpenRouter' }))
    expect(view.getByTestId('provider-editor')).toBeTruthy()
    cleanup()
    // With the key stored and the catalogue empty, a key action would mislead.
    motionKeyMissing = false
    const connected = await mount()
    expect(within(group(connected, 'motion')).getByText(MOTION_RECOVERY)).toBeTruthy()
    expect(within(group(connected, 'motion')).queryByRole('button', { name: 'Connect OpenRouter' })).toBeNull()
  })

  it('marks a brain whose route runs as a CLI in the terminal, in its row, its picker groups and under Subscriptions', async () => {
    agentsPayload = { ...AGENTS, agents: [...AGENTS.agents, WRITER] }
    const view = await mount()
    const row = (await view.findAllByText('Writer'))[0]!.closest('[data-brain]') as HTMLElement
    const note = row.querySelector('[data-brain-access]')
    expect(note?.getAttribute('data-brain-access')).toBe('terminal-only')
    expect(note?.textContent).toContain('Runs as claude in a terminal, on its own login. Chat needs an account.')
    // JJ's 31 Aug decision: the terminal keeps the subscription, chat gets the API option, so the key action stays.
    expect(within(note as HTMLElement).getByRole('button', { name: 'Connect' })).toBeTruthy()
    // The row states the model; the browser carries the mark on the route's models.
    expect(row.querySelector('[data-brain-model]')?.getAttribute('data-brain-model')).toBe('Claude Opus 5 · Pay as you go')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const browser = await openBrowser(view)
    expect(browser.querySelector('[data-browser-row="anthropic claude"] [data-browser-byline]')?.textContent)
      .toBe('Anthropic · claude CLI in the terminal')
    fireEvent.click(within(browser).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    const cli = view.container.querySelector('[data-terminal-cli="claude"]') as HTMLElement
    expect(cli.textContent).toContain('Anthropic')
    expect(cli.textContent).toContain('Runs in a terminal as claude, on your plan')
    expect(cli.textContent).toContain('Installed')
    // The chat-side option: the CLI row opens the provider editor for a key.
    fireEvent.click(within(cli).getByRole('button', { name: 'Add key for chat' }))
    expect(view.getByTestId('provider-editor')).toBeTruthy()
  })

  it('drops the CLI mark from the sheet\'s picker groups and offers Manage once the route has a chat key', async () => {
    agentsPayload = { ...AGENTS, agents: [...AGENTS.agents, WRITER] }
    statePayload = {
      ...STATE,
      providers: STATE.providers.map(p => p.provider === 'anthropic' ? { ...p, connected: true } : p),
    }
    servicesList = [...servicesList, { id: 'anthropic', kind: 'chat', name: 'Anthropic', makes: ['chat'], connected: true }]
    const view = await mount()
    const row = (await view.findAllByText('Writer'))[0]!.closest('[data-brain]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const browser = await openBrowser(view)
    expect(browser.querySelector('[data-browser-row="anthropic claude"] [data-browser-byline]')?.textContent).toBe('Anthropic')
    fireEvent.click(within(browser).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    const cli = view.container.querySelector('[data-terminal-cli="claude"]') as HTMLElement
    expect(within(cli).getByRole('button', { name: 'Manage' })).toBeTruthy()
    // With the key stored the route also reads as a connected service.
    await waitFor(() => {
      expect(view.container.querySelector('[data-service="anthropic"][data-service-connected]')).not.toBeNull()
    })
  })

  it('marks a brain whose chat route has no key and opens the provider editor from its row', async () => {
    const view = await mount()
    const row = group(view, 'gallery').querySelector('[data-brain="gallery"]')!
    expect(row.querySelector('[data-brain-access]')?.getAttribute('data-brain-access')).toBe('no-access')
    expect(row.textContent).toContain('Needs an account on Deepseek-official.')
    // Ready brains carry no mark.
    expect(group(view, 'chat').querySelector('[data-brain-access]')).toBeNull()
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Connect' }))
    expect(view.getByTestId('provider-editor')).toBeTruthy()
  })

  it('asks a new brain everything at once, with the model narrowed to the place it was added for', async () => {
    const view = await mountAdding('gallery')
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    // A new brain has no answers to tuck away, so nothing waits behind More options.
    expect([...sheet.querySelectorAll('[data-brains-field]')].map(node => node.getAttribute('data-brains-field')))
      .toEqual(['name', 'what', 'instructions', 'model', 'spaces', 'chat-model'])
    // Gallery is checked, and nothing else is.
    const checked = [...sheet.querySelectorAll('input[type="checkbox"]')]
      .filter(box => (box as HTMLInputElement).checked)
      .map(box => (box.parentElement?.textContent ?? '').trim())
    expect(checked).toEqual(['Images'])
    expect(sheet.querySelector('[data-brains-add-space]')?.getAttribute('data-brains-add-space')).toBe('gallery')
    expect(sheet.querySelector('[data-brains-instructions-hint]')?.textContent)
      .toBe('Sent with every message this brain handles.')
    // The model list is narrowed to Gallery's own candidates, and is shorter
    // than the chat catalogue a Chat brain picks from.
    const gallery = await openBrowser(view)
    expect(listed(gallery)).toEqual(['Still A', 'Still B'])
    fireEvent.click(within(gallery).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('button', { name: 'Add a brain' }))
    expect(listed(await openBrowser(view)).length).toBeGreaterThan(2)
  })

  // PC test drive, 18 Sep 2026: on a short window the whole sheet scrolled and
  // Save brain sat below the fold. Every field now sits in the one scrolling
  // body, and the actions sit outside it, as the sheet's last child.
  it('keeps the sheet\'s actions outside the region that scrolls', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('button', { name: 'Add a brain' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const body = sheet.querySelector('[data-brains-sheet-body]') as HTMLElement
    expect([...sheet.querySelectorAll('[data-brains-field]')].every(field => body.contains(field))).toBe(true)
    const save = within(sheet).getByRole('button', { name: 'Save brain' })
    expect(body.contains(save)).toBe(false)
    expect(sheet.lastElementChild?.contains(save)).toBe(true)
    expect(sheet.lastElementChild?.contains(within(sheet).getByRole('button', { name: 'Cancel' }))).toBe(true)
  })

  it('persists the chosen space, and the space model, when a new brain is saved', async () => {
    const view = await mountAdding('gallery')
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    fireEvent.change(sheet.querySelector('input[type="text"], input:not([type])')!, { target: { value: 'Poster' } })
    await choose(view, 'mediahub still-b')
    fireEvent.change(sheet.querySelector('textarea')!, { target: { value: 'Make posters.' } })
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/activity/agent')).toHaveLength(1) })
    // The brain records the space it was added for; its own model override
    // is the chat model, left on the default here, while the generation
    // model is the media route's.
    expect(sent(posts('/idealize/activity/agent')[0]!)).toEqual({
      name: 'Poster', model: null, instructions: 'Make posters.', spaces: ['gallery'],
    })
    await waitFor(() => { expect(posts('/idealize/brains/media')).toHaveLength(1) })
    expect(sent(posts('/idealize/brains/media')[0]!)).toEqual({
      id: 'images', model: { backend: 'mediahub', model: 'still-b' },
    })
  })

  it('edits a brain in the in-pane sheet and saves name, model, instructions and spaces', async () => {
    const view = await mount()
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const name = sheet.querySelector('input[type="text"], input:not([type])') as HTMLInputElement
    expect(name.value).toBe('Coding')
    // Its purpose reads first; the full instructions wait one click down.
    expect(sheet.querySelector('[data-brains-purpose]')?.textContent).toBe('Builds and changes software')
    expect(sheet.querySelector('textarea')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'See its full instructions' }))
    more(view)
    // An edited brain arrives with its own spaces checked, so saving cannot
    // silently drop it out of a group.
    expect([...sheet.querySelectorAll('[data-brains-field="spaces"] input[type="checkbox"]')]
      .filter(box => (box as HTMLInputElement).checked)
      .map(box => (box.parentElement?.textContent ?? '').trim())).toEqual(['Chat', 'Terminal'])
    // A chat brain is routed until its sheet says otherwise.
    expect((sheet.querySelector('[data-brains-field="routed"] input') as HTMLInputElement).checked).toBe(true)
    expect(sheet.querySelector('[data-brains-add-space]')).toBeNull()
    fireEvent.change(name, { target: { value: 'Code' } })
    await choose(view, 'openai-codex gpt-5.5')
    fireEvent.change(sheet.querySelector('textarea')!, { target: { value: 'Ship small.' } })
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/activity/agent')).toHaveLength(1) })
    expect(sent(posts('/idealize/activity/agent')[0]!)).toEqual({
      id: 'coding',
      name: 'Code',
      model: { provider: 'openai-codex', model: 'gpt-5.5' },
      instructions: 'Ship small.',
      spaces: ['chat', 'terminal'],
    })
    await waitFor(() => { expect(view.queryByRole('form', { name: 'Edit brain' })).toBeNull() })
  })

  it('adds an agent role through the same sheet, in no space and without an id', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('button', { name: 'Add agent role', hidden: true }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    expect(view.getByText('New brain')).toBeTruthy()
    expect(sheet.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0)
    expect(sheet.querySelector('[data-brains-add-space]')).toBeNull()
    fireEvent.change(sheet.querySelector('input[type="text"], input:not([type])')!, { target: { value: 'Research' } })
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/activity/agent')).toHaveLength(1) })
    expect(sent(posts('/idealize/activity/agent')[0]!)).toEqual({
      name: 'Research', model: null, instructions: '', spaces: [],
    })
  })

  it('drops a chosen model when the spaces move it to the other catalogue', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('button', { name: 'Add a brain' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    await choose(view, 'anthropic claude')
    expect(modelRow(view).getAttribute('data-value')).toBe('anthropic claude')
    // Moving the brain to Gallery alone changes which catalogue the field is
    // picking from, so a chat model cannot be left standing in it.
    const boxes = [...sheet.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    const box = (label: string): HTMLInputElement => {
      const found = boxes.find(entry => (entry.parentElement?.textContent ?? '').trim() === label)
      if (found === undefined) throw new Error(`no ${label} checkbox`)
      return found
    }
    fireEvent.click(box('Images'))
    fireEvent.click(box('Chat'))
    expect(modelRow(view).getAttribute('data-value')).toBe('')
    expect(within(modelRow(view)).getByText('No model chosen')).toBeTruthy()
    // Nothing chosen, nothing to picture: the row has no image slot.
    expect(modelRow(view).querySelector('img')).toBeNull()
    expect(listed(await openBrowser(view))).toEqual(['Still A', 'Still B'])
  })

  it("opens the add sheet on the space the welcome card's brain step asked for", async () => {
    const view = render(<BrainsPanel host={host} t={t} request={{ kind: 'add-brain', space: 'soundstage' }} />)
    await waitFor(() => { expect(view.getByRole('form', { name: 'Edit brain' })).toBeTruthy() })
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    expect(sheet.querySelector('[data-brains-add-space]')?.getAttribute('data-brains-add-space')).toBe('soundstage')
    expect([...sheet.querySelectorAll('input[type="checkbox"]')]
      .filter(box => (box as HTMLInputElement).checked)
      .map(box => (box.parentElement?.textContent ?? '').trim())).toEqual(['Sounds'])
  })

  it('states a terminal-only brain\'s tool on its row and chooses it in the sheet, beside the model', async () => {
    // JJ, 10 Sep 2026: the row states the launch, the sheet asks it: one place
    // chooses what a brain runs, and it is the same place as the model.
    agentsPayload = {
      ...AGENTS,
      agents: [...AGENTS.agents, { ...AGENTS.agents[1]!, id: 'pilot', name: 'Pilot', spaces: ['terminal'] } as unknown as typeof AGENTS.agents[number]],
    }
    launchesPayload = { ...LAUNCHES, byActivity: { design: 'codex', pilot: 'codex' } }
    const view = await mount()
    const list = group(view, 'terminal')
    await waitFor(() => { expect(list.querySelector('[data-brain="pilot"] [data-brain-model]')?.textContent).toBe('Codex CLI') })
    // A brain that also works in Chat reads its chat model.
    expect(list.querySelector('[data-brain="design"] [data-brain-model]')?.textContent).toBe('GPT 5.5 · On your plan')
    edit(view, 'design')
    more(view)
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const cli = within(sheet).getByRole('combobox', { name: 'In a terminal, runs with' }) as HTMLSelectElement
    expect(cli.value).toBe('codex')
    // A tool the login shell cannot find is not offered to a brain not on it.
    expect([...cli.options].map(option => option.textContent))
      .toEqual(['Default (Claude Code)', 'Claude Code', 'Codex CLI', 'Plain shell'])
    // The sheet asks the model too: a tool brings its own, which this app cannot enumerate.
    expect(sheet.querySelector('[data-brains-model-row="model"]')).not.toBeNull()
    fireEvent.change(cli, { target: { value: '' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/terminal/launch')).toHaveLength(1) })
    expect(sent(posts('/idealize/terminal/launch')[0]!)).toEqual({ activity: 'design', command: '' })
    // Which tool a shell types by default stays its own row: it belongs to no brain.
    const fallback = within(group(view, 'terminal')).getByRole('combobox', { name: 'In a terminal, brains run with' }) as HTMLSelectElement
    expect(fallback.value).toBe('cli:claude-code')
    fireEvent.change(fallback, { target: { value: 'cli:codex' } })
    await waitFor(() => { expect(posts('/idealize/terminal/launch')).toHaveLength(2) })
    expect(sent(posts('/idealize/terminal/launch')[1]!)).toEqual({ command: 'codex' })
  })

  it('keeps a stored choice of a missing tool visible, marked, rather than silently rereading it', async () => {
    agentsPayload = {
      ...AGENTS,
      agents: [...AGENTS.agents, { ...AGENTS.agents[1]!, id: 'pilot', name: 'Pilot', spaces: ['terminal'] } as unknown as typeof AGENTS.agents[number]],
    }
    launchesPayload = { ...LAUNCHES, byActivity: { pilot: 'gemini' } }
    const view = await mount()
    const list = group(view, 'terminal')
    await waitFor(() => { expect(list.querySelector('[data-brain="pilot"] [data-brain-model]')?.textContent).toBe('Gemini CLI') })
    expect(list.querySelector('[data-brain="pilot"] [data-brain-mark]')?.getAttribute('data-brain-mark')).toBe('needs')
    edit(view, 'pilot')
    more(view)
    const cli = within(view.getByRole('form', { name: 'Edit brain' }))
      .getByRole('combobox', { name: 'In a terminal, runs with' }) as HTMLSelectElement
    expect(cli.value).toBe('gemini')
    expect([...cli.options].map(option => option.textContent))
      .toEqual(['Default (Claude Code)', 'Claude Code', 'Codex CLI', 'Gemini CLI · not found on this Mac', 'Plain shell'])
  })

  it('offers no tool choice where the launches route serves no catalogue (plain browser)', async () => {
    launchesPayload = { default: '', byActivity: {} }
    const view = await mount()
    const list = group(view, 'terminal')
    expect(list.querySelectorAll('select')).toHaveLength(0)
    expect(list.querySelector('[data-terminal-default-cli]')).toBeNull()
    // No catalogue is no verdict, so the strip does not call Terminal broken.
    await waitFor(() => {
      expect([...view.container.querySelectorAll('[data-space-status]')].find(node => node.textContent?.includes('Terminal'))?.getAttribute('data-space-status')).toBe('ready')
    })
  })

  it('lists subscriptions, and gives the free-token engine no controls of its own', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    expect(view.getByText('OpenAI (ChatGPT)')).toBeTruthy()
    // Anthropic has no key and a terminal CLI serves its route, so it lists once, under Subscriptions as that CLI.
    expect(view.getAllByText('Anthropic')).toHaveLength(1)
    expect(view.getByText('Runs in a terminal as claude, on your plan')).toBeTruthy()
    // The engine follows the asking brain's priorities, so the tab carries no strategy select and no sliders for it.
    expect(view.getByText('Free. Suits light questions. 2 models ready.')).toBeTruthy()
    expect(view.container.querySelector('[data-accounts-free] a')?.getAttribute('href')).toBe('/idealize/freetokens')
    expect(view.queryByRole('combobox', { name: 'Routing strategy' })).toBeNull()
    expect(view.queryAllByRole('slider')).toHaveLength(0)
    expect(calls.some(call => call.url.startsWith('/idealize/freetokens/routing'))).toBe(false)
    // The re-hosted provider editor is now the marked advanced route, reached
    // from the add list rather than from a "+" that led straight to a URL field.
    fireEvent.click(view.getByRole('button', { name: 'Search all 3 services' }))
    fireEvent.click(await view.findByText('Something else\u2026'))
    expect(view.getByTestId('provider-editor')).toBeTruthy()
  })

  it('gives a chat brain its own flexibility and priorities, and saves them once a slider moves', async () => {
    const view = await mount()
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    more(view)
    // Coding opens on its shipped row over the app-wide level.
    await waitFor(() => { expect(within(sheet).getByRole<HTMLInputElement>('slider', { name: 'Intelligence' }).value).toBe('80') })
    expect(within(sheet).getAllByRole('slider').map(slider => slider.getAttribute('aria-label')))
      .toEqual(['How readily it moves', 'Low cost', 'Speed', 'Intelligence'])
    expect(within(sheet).getByRole<HTMLInputElement>('slider', { name: 'Low cost' }).value).toBe('10')
    expect(within(sheet).getByRole<HTMLInputElement>('slider', { name: 'How readily it moves' }).value).toBe('1')
    fireEvent.change(within(sheet).getByRole('slider', { name: 'How readily it moves' }), { target: { value: '2' } })
    fireEvent.change(within(sheet).getByRole('slider', { name: 'Speed' }), { target: { value: '40' } })
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/router/brain')).toHaveLength(1) })
    expect(sent(posts('/idealize/router/brain')[0]!)).toEqual({
      brain: 'coding', aggressiveness: 'aggressive', cost: 10, speed: 40, intelligence: 80,
    })
  })

  it('leaves a brain\u2019s criteria alone when nothing moved, and hides them once auto-switch is off for it', async () => {
    const view = await mount()
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    more(view)
    await waitFor(() => { expect(within(sheet).getAllByRole('slider')).toHaveLength(4) })
    expect(sheet.querySelector('[data-brains-field="matters"]')).not.toBeNull()
    fireEvent.click(sheet.querySelector('[data-brains-field="routed"] input')!)
    expect(within(sheet).queryAllByRole('slider')).toHaveLength(0)
    expect(sheet.querySelector('[data-brains-field="matters"]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(view.queryByRole('form', { name: 'Edit brain' })).toBeNull() })
    expect(posts('/idealize/router/brain')).toHaveLength(0)
  })

  it('asks what matters most in three plain choices, which write the same three weights', async () => {
    const view = await mount()
    edit(view, 'coding')
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const pressed = (): string | null | undefined => sheet.querySelector('[data-brains-matter][aria-pressed="true"]')?.getAttribute('data-brains-matter')
    // Coding ships leaning on intelligence, so it reads as Best answers.
    await waitFor(() => { expect(pressed()).toBe('best') })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Low cost' }))
    expect(pressed()).toBe('cost')
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/router/brain')).toHaveLength(1) })
    expect(sent(posts('/idealize/router/brain')[0]!)).toEqual({
      brain: 'coding', aggressiveness: 'balanced', cost: 90, speed: 50, intelligence: 20,
    })
  })

  it('leaves the auto-switch controls out of a terminal-only brain\'s sheet, and captions them for a brain in both', async () => {
    agentsPayload = {
      ...AGENTS,
      agents: [...AGENTS.agents, { ...AGENTS.agents[1]!, id: 'pilot', name: 'Pilot', spaces: ['terminal'] } as unknown as typeof AGENTS.agents[number]],
    }
    const view = await mount()
    edit(view, 'pilot')
    more(view)
    let sheet = view.getByRole('form', { name: 'Edit brain' })
    expect(sheet.querySelector('[data-brains-field="routed"]')).toBeNull()
    expect(sheet.querySelector('[data-brains-field="matters"]')).toBeNull()
    expect(within(sheet).queryAllByRole('slider')).toHaveLength(0)
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => { expect(view.queryByRole('form', { name: 'Edit brain' })).toBeNull() })
    edit(view, 'coding')
    more(view)
    sheet = view.getByRole('form', { name: 'Edit brain' })
    expect(sheet.querySelector('[data-brains-field="routed"]')).not.toBeNull()
    expect(sheet.querySelector('[data-brains-routed-terminal]')?.textContent).toBe('Applies in Chat. A Terminal chat runs its own agent, which picks its own model.')
    await waitFor(() => { expect(within(sheet).getAllByRole('slider')).toHaveLength(4) })
  })

  it('names every route by one rule: the directory name when it is one, else the id with a capital', async () => {
    // JJ, 8 Sep 2026: "OpenAI listings are different to others and are listed as gpt rather than OpenAI".
    statePayload = {
      ...STATE,
      providers: [
        { provider: 'openai-codex', displayName: 'OpenAI (ChatGPT)', auth: 'oauth', connected: true, models: ['gpt-5.5'] },
        // A route the host's directory did not know: its display name is its id.
        { provider: 'mutter', displayName: 'mutter', auth: 'apiKey', connected: true, models: ['qwen'] },
        { provider: 'kimi-coding', displayName: 'kimi-coding', auth: 'oauth', connected: true, models: ['k2'] },
        { provider: 'freetokens', displayName: 'Free tokens', auth: 'free', connected: true, models: ['auto'] },
      ],
    }
    const view = await mount()
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    const browser = await openBrowser(view)
    const bylines = [...browser.querySelectorAll('[data-browser-byline]')].map(node => node.textContent)
    expect(bylines).toEqual(['Free tokens', 'OpenAI (ChatGPT)', 'Kimi-coding', 'Alibaba · Mutter'])
    fireEvent.click(within(browser).getByRole('button', { name: 'Cancel' }))
    // The catalogue note states what the lists hold and when they were read.
    expect(view.container.querySelector('[data-brains-catalogue]')?.textContent)
      .toBe(`4 models from 4 services, read ${when(STATE.readAt)}. A model a service has not published yet is not listed.`)
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    // The Models tab's Subscriptions rows read the same names.
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    expect(view.getByText('Kimi-coding')).toBeTruthy()
  })

  it('searches a long catalogue in the browser, and says so when nothing matches', async () => {
    // JJ, 8 Sep 2026: "gpt 6 is not available" — it is in no service's list.
    const many = Array.from({ length: 45 }, (_, index) => `model-${String(index + 1)}`)
    statePayload = {
      ...STATE,
      providers: [
        { provider: 'openai', displayName: 'OpenAI', auth: 'apiKey', connected: true, models: ['gpt-5.5', 'gpt-5.4'] },
        { provider: 'freetokens', displayName: 'Free tokens', auth: 'free', connected: true, models: many },
      ],
    }
    const view = await mount()
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    const browser = await openBrowser(view)
    const count = (): string | null | undefined => browser.querySelector('[data-browser-count]')?.textContent
    expect(count()).toBe('47 of 47 models')
    const search = browser.querySelector('[data-browser-search]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'GPT-5' } })
    expect(listed(browser)).toEqual(['gpt-5.4', 'gpt-5.5'])
    // The route's name matches too.
    fireEvent.change(search, { target: { value: 'free' } })
    expect(count()).toBe('45 of 47 models')
    fireEvent.change(search, { target: { value: 'gpt-6' } })
    expect(listed(browser)).toEqual([])
    expect(within(browser).getByText('No model matches these filters.')).toBeTruthy()
    // Closing the browser clears the search for the next open.
    fireEvent.click(within(browser).getByRole('button', { name: 'Cancel' }))
    expect(((await openBrowser(view)).querySelector('[data-browser-search]') as HTMLInputElement).value).toBe('')
  })

  it('lists connected accounts, then good next steps, then every other service behind a search', async () => {
    servicesList = [...servicesList, { id: 'runway', kind: 'media', name: 'Runway', makes: ['video'], connected: false }]
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    const ids = (selector: string): (string | null)[] =>
      Array.from(view.container.querySelectorAll(`${selector} [data-service]`)).map(row => row.getAttribute('data-service'))
    await waitFor(() => { expect(ids('[data-accounts-connected]')).toEqual(['deepseek']) })
    expect(ids('[data-accounts-next]')).toEqual(['fal'])
    expect(view.container.querySelector('[data-services-all]')).toBeNull()
    // A next step says what the account is good for, in the person's words.
    const fal = view.container.querySelector<HTMLElement>('[data-service="fal"]')!
    expect(within(fal).getByText('Pay as you go. One key for all your media.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Search all 4 services' }))
    // Media leads under its own label: unlabelled, the services that make
    // images and video are buried among the chat routes.
    await waitFor(() => { expect(ids('[data-services-all]')).toEqual(['runway', 'acme']) })
    expect(Array.from(view.container.querySelectorAll('[data-service-group]')).map(node => node.textContent))
      .toEqual(['Images, video and sound', 'Chat'])
    expect(within(view.container.querySelector<HTMLElement>('[data-service="runway"]')!).getByText('Video')).toBeTruthy()
    fireEvent.change(view.container.querySelector('[data-services-search]')!, { target: { value: 'ACME' } })
    expect(ids('[data-services-all]')).toEqual(['acme'])
  })

  it('connects a service with a key and nothing else, and never asks for a web address', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    const row = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-service="fal"]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(row.hasAttribute('data-service-connected')).toBe(false)
    fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
    // One field, and it is the key. No endpoint, no protocol, no route id.
    const field = within(row).getByLabelText('Your fal.ai key') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(within(row).queryByLabelText(/URL/i)).toBeNull()
    // Someone without a key is told where fal issues them.
    expect(view.container.querySelector('[data-service-key-link="fal"]')?.getAttribute('href'))
      .toBe('https://fal.ai/dashboard/keys')
    fireEvent.change(field, { target: { value: 'fal-secret' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => { expect(posts('/idealize/brains/services')).toHaveLength(1) })
    const post = posts('/idealize/brains/services')[0]!
    expect(sent(post)).toEqual({ id: 'fal', kind: 'media', apiKey: 'fal-secret' })
    expect((post.init?.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
    expect(await view.findByText('Connected. Its models are ready to use.')).toBeTruthy()
  })

  it('shows why a Connect failed inside the form that was pressed', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    fireEvent.click(await view.findByRole('button', { name: 'Search all 3 services' }))
    const row = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-service="acme"]')
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
    const field = within(row).getByLabelText('Your Acme Gateway key')
    fireEvent.change(field, { target: { value: 'refused-key' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
    // The pane's status line sits below every section; the reason belongs
    // under the buttons, where the person who pressed Connect is looking.
    const error = await waitFor(() => {
      const found = row.querySelector<HTMLElement>('[data-service-error="acme"]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(error.textContent).toBe('The key is saved, but Acme Gateway could not be switched on. no models')
    expect(error.getAttribute('role')).toBe('alert')
    // Cancel closes the form and takes the reason with it.
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(row.querySelector('[data-service-error]')).toBeNull()
  })

  it('offers a key page only for a service whose page is known', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    fireEvent.click(await view.findByRole('button', { name: 'Search all 3 services' }))
    const row = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-service="acme"]')
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
    expect(within(row).getByLabelText('Your Acme Gateway key')).toBeTruthy()
    expect(view.container.querySelector('[data-service-key-link="acme"]')).toBeNull()
  })

  it('keeps the web-address route reachable, and marked as the other thing it is', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    expect(view.container.querySelector('[data-services-advanced]')).toBeNull()
    fireEvent.click(await view.findByRole('button', { name: 'Search all 3 services' }))
    const advanced = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-services-advanced]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(advanced.textContent).toBe('Something else\u2026')
  })

  it('imports a keys file as it was read and names what it connected', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    fireEvent.click(await view.findByRole('button', { name: 'Search all 3 services' }))
    const field = await waitFor(() => {
      const found = view.container.querySelector<HTMLInputElement>('[data-services-keys-file]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(field.getAttribute('accept')).toBe('.idealizekeys,application/json')
    const text = JSON.stringify({ format: 1, credentials: { ACME_API_KEY: 'sk-acme', FAL_KEY: 'fal-1' } })
    const file = new File([text], 'IDEalize Acme keys.idealizekeys', { type: 'application/json' })
    Object.defineProperty(field, 'files', { value: [file], configurable: true })
    fireEvent.change(field)
    await waitFor(() => { expect(posts('/idealize/brains/services/import')).toHaveLength(1) })
    const post = posts('/idealize/brains/services/import')[0]!
    // The document goes as read; the host owns what a keys file may say.
    expect(post.init?.body).toBe(text)
    expect((post.init?.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
    expect(await view.findByText('Connected Acme Gateway, fal.ai. Their models are ready to use.')).toBeTruthy()
    // The list re-reads from the host: both rows now sit under connected.
    await waitFor(() => {
      expect(view.container.querySelector('[data-service="fal"]')?.hasAttribute('data-service-connected')).toBe(true)
    })
  })

  it('shows the host’s reason when a keys file is refused', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    fireEvent.click(await view.findByRole('button', { name: 'Search all 3 services' }))
    const field = await waitFor(() => {
      const found = view.container.querySelector<HTMLInputElement>('[data-services-keys-file]')
      expect(found).not.toBeNull()
      return found!
    })
    const file = new File([JSON.stringify({ format: 1, credentials: { NOBODY_API_KEY: 'x' } })], 'keys.idealizekeys')
    Object.defineProperty(field, 'files', { value: [file], configurable: true })
    fireEvent.change(field)
    expect(await view.findByText('NOBODY_API_KEY is not a credential any service this app can connect takes')).toBeTruthy()
  })

  describe('Auto-switch', () => {
    const ROUTER = {
      settings: { enabled: true, useJev: true, preferFree: true, showRationale: false },
      jev: { keyed: true },
      candidates: 3,
    }
    const switches = (view: RenderResult): Record<string, boolean> => {
      const found: Record<string, boolean> = {}
      for (const box of view.container.querySelectorAll<HTMLInputElement>('[data-router-flag]')) {
        found[box.getAttribute('data-router-flag') ?? ''] = box.checked
      }
      return found
    }

    it('offers three plain switches and keeps how it decides one click down', async () => {
      routerPayload = ROUTER
      const view = await mount()
      fireEvent.click(view.getByRole('tab', { name: 'Auto-switch' }))
      await waitFor(() => { expect(switches(view)).toEqual({ enabled: true, preferFree: true, showRationale: false }) })
      expect(view.container.querySelector('[data-router-reads]')?.textContent)
        .toBe('OpenRouter reads each message to choose a model. Chats on a model running on your computer skip this.')
      expect(view.getByText('Move chats to a better model')).toBeTruthy()
      expect(view.getByText('Never spend extra without asking')).toBeTruthy()
      expect(view.getByText('Tell me why in the chat')).toBeTruthy()
      expect(view.container.querySelector('[data-router-how]')?.hasAttribute('open')).toBe(false)
      expect(view.container.querySelector('[data-router-how] summary')?.textContent).toBe('How it decides')
      fireEvent.click(view.container.querySelector('[data-router-flag="showRationale"]')!)
      await waitFor(() => { expect(posts('/idealize/router/settings')).toHaveLength(1) })
      expect(sent(posts('/idealize/router/settings')[0]!)).toEqual({ showRationale: true })
    })

    it('says what it needs and leaves no switch ticked until OpenRouter is connected', async () => {
      routerPayload = { ...ROUTER, jev: { keyed: false } }
      servicesList = [...servicesList, { id: 'openrouter', kind: 'chat', name: 'OpenRouter', makes: ['chat'], connected: false }]
      const view = await mount()
      fireEvent.click(view.getByRole('tab', { name: 'Auto-switch' }))
      const line = await waitFor(() => {
        const found = view.container.querySelector<HTMLElement>('[data-router-no-key]')
        expect(found).not.toBeNull()
        return found!
      })
      expect(line.textContent).toContain('Auto-switch needs an OpenRouter account. Until then, each chat stays on its model.')
      expect(switches(view)).toEqual({ enabled: false, preferFree: false, showRationale: false })
      // Reading the state wrote nothing: the person's settings wait in the file.
      expect(posts('/idealize/router/settings')).toHaveLength(0)
      fireEvent.click(within(line).getByRole('button', { name: 'Connect OpenRouter' }))
      await waitFor(() => { expect(view.getByRole('tab', { name: 'Accounts', selected: true })).toBeTruthy() })
      expect(view.container.querySelector('[data-service="openrouter"] input[type="password"]')).not.toBeNull()
    })

    it('says there is nothing to switch to with one model connected', async () => {
      routerPayload = { ...ROUTER, candidates: 1 }
      const view = await mount()
      fireEvent.click(view.getByRole('tab', { name: 'Auto-switch' }))
      await waitFor(() => { expect(view.container.querySelector('[data-router-one-model]')).not.toBeNull() })
      expect(switches(view)).toEqual({ enabled: false, preferFree: false, showRationale: false })
    })
  })

  it('says so plainly when there is nothing left to add', async () => {
    servicesList = servicesList.map(row => ({ ...row, connected: true }))
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Accounts' }))
    fireEvent.click(await view.findByRole('button', { name: 'Search all 3 services' }))
    expect(await view.findByText('Every service this app knows is already connected.')).toBeTruthy()
  })
})

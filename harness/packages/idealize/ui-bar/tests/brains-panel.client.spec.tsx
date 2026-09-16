// @vitest-environment jsdom
// The Brains pane: the three tabs over the /idealize routes — the brains
// grouped by the space they work in (a brain in two spaces listed under both),
// each row stating its model as text, each space's own generation-model row
// and its unavailable state, the agent-role section, the edit sheet asking
// spaces then the model those spaces narrow it to (the one place a model is
// chosen) then the instructions, the provider sections with the strategy
// select, the weight sliders (reliability through the engine's routing
// routes), and the budget table with its monthly budget field.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
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
/** The engine's balanced preset: reliability carries twice speed or intelligence. */
const ROUTING = {
  strategy: 'balanced',
  weights: { reliability: 0.5, speed: 0.25, intelligence: 0.25 },
  customWeights: { reliability: 0.5, speed: 0.25, intelligence: 0.25 },
  scores: [],
}
let routing: unknown = ROUTING
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
      candidates: [{ backend: 'mediahub', model: { id: 'tone-a', name: 'Tone A' } }],
      availability: { state: 'available', backends: ['mediahub'], models: 1 },
    },
  ],
})
const USAGE = {
  scope: '',
  projects: [{ path: '/p/alpha', label: 'alpha' }],
  month: { subscriptions: 1500, metered: 0, free: 250, total: 1750 },
  year: { subscriptions: 2_400_000, metered: 12, free: 250, total: 2_400_262 },
  monthlyTokenBudget: 0,
  // Costs the host computed from configured prices: a $20 plan (unset for
  // Anthropic) and 12 metered tokens this year that no price entry covers.
  cost: {
    currency: 'USD',
    month: { subscriptions: 20, metered: 0, free: 0, total: 20 },
    year: { subscriptions: 160, metered: 0.5, free: 0, total: 160.5 },
    unpricedTokens: { month: 0, year: 12 },
    unpricedSubscriptions: ['anthropic'],
    configured: true,
  },
  // One row per model with usage this month: a subscription row, an unpriced
  // metered row, a metered row OpenRouter priced from its directory, a free row.
  models: [
    { provider: 'openai-codex', model: 'gpt-5.5', category: 'subscriptions', total: 1500 },
    { provider: 'anthropic', model: 'claude', category: 'metered', total: 900 },
    { provider: 'openrouter', model: 'a/b', category: 'metered', total: 400, cost: 0.25, price: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1, source: 'market' } },
    { provider: 'freetokens', model: 'auto', category: 'free', total: 250 },
  ],
  openRouterPrices: { fetchedAt: '2026-09-08T07:24:39.767Z', models: 276 },
  // One row per endpoint that generated this month: a billed one, one fal has
  // not billed yet, one fal reported that this app did not make itself, and one
  // whose media type the copy has no word of its own for.
  generations: {
    rows: [
      { provider: 'fal', model: 'fal-ai/flux/dev', mediaType: 'image/png', count: 6, billed: { quantity: 6, unit: 'image', cost: 0.52, currency: 'USD' } },
      { provider: 'fal', model: 'fal-ai/kling/video', mediaType: 'video/mp4', count: 2 },
      { provider: 'fal', model: 'fal-ai/whisper', count: 0, billed: { quantity: 1, unit: 'second', cost: 0.1, currency: 'USD' } },
      { provider: 'fal', model: 'fal-ai/any-llm', mediaType: 'text/markdown', count: 1 },
    ],
    billed: { month: { USD: 0.62 }, year: { USD: 1.4 } } as { month: Record<string, number>; year: Record<string, number> } | undefined,
    currency: 'USD' as string | null,
  },
  falUsage: { fetchedAt: '2026-09-08T07:24:39.767Z' } as { fetchedAt: string | null; error?: string } | null,
}
/** An instant as the panel prints it. */
const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The usage payload a test mounts over; `install` resets it to the shared fixture. */
let usagePayload: typeof USAGE

/** The cost strings the panel is expected to render, formatted exactly as the component formats them. */
const usd = (value: number): string => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value)

/** Claude on subscription runs as Claude Code in the terminal: the chat cannot reach it, the terminal can. */
const WRITER = { id: 'writer', name: 'Writer', activity: false, modelPinned: false, spaces: ['chat', 'terminal'], model: { provider: 'anthropic', model: 'claude-opus-5' }, access: { state: 'unavailable', reason: 'terminal-only', model: { provider: 'anthropic', model: 'claude-opus-5' } }, overridden: true, instructions: 'Write.' }

/** The agents payload a test mounts over; `install` resets it to the shared fixture. */
let agentsPayload: typeof AGENTS

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
  statePayload = STATE
  launchesPayload = LAUNCHES
  routing = ROUTING
  motionKeyMissing = true
  mediaKeys = [{ backend: 'fal', displayName: 'fal.ai', env: 'FAL_KEY', connected: false }]
  servicesList = [
    { id: 'deepseek', kind: 'chat', name: 'DeepSeek', makes: ['chat'], connected: true },
    { id: 'acme', kind: 'chat', name: 'Acme Gateway', makes: ['chat'], connected: false },
    { id: 'fal', kind: 'media', name: 'fal.ai', makes: ['image', 'video', 'audio'], connected: false, keyUrl: 'https://fal.ai/dashboard/keys' },
  ]
  usagePayload = USAGE
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, ...init === undefined ? {} : { init } })
    if (url.startsWith('/idealize/models/state')) return Promise.resolve(json(statePayload))
    if (url === '/idealize/freetokens/routing') {
      return Promise.resolve(routing === null ? new Response('', { status: 502 }) : json(routing))
    }
    if (url.startsWith('/idealize/activity/agents')) return Promise.resolve(json(agentsPayload))
    if (url.startsWith('/idealize/terminal/launches')) return Promise.resolve(json(launchesPayload))
    if (url.startsWith('/idealize/models/usage')) return Promise.resolve(json(usagePayload))
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
      const body = JSON.parse(init?.body as string) as { id: string }
      servicesList = servicesList.map(row => row.id === body.id ? { ...row, connected: true } : row)
      return Promise.resolve(json({ services: servicesList }))
    }
    if (url === '/idealize/spaces') return Promise.resolve(json(SPACE_ROSTER))
    return Promise.resolve(json({ ok: true }))
  }))
}

/**
 * A provider group's label as the picker renders it: the name between rules,
 * which is how a native select shows a group at all (JJ, 10 Sep 2026).
 * @param name - the provider's display name.
 * @returns the label the optgroup carries.
 */
function ruled(name: string): string {
  return `──  ${name}  ──`
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
  await waitFor(() => { expect(view.getByRole('table', { name: 'Agent roles' })).toBeTruthy() })
  return view
}

const posts = (path: string): Call[] => calls.filter(call => call.url === path && call.init?.method === 'POST')

beforeEach(install)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BrainsPanel', () => {
  /** One space group, by the id its section carries. */
  const group = (view: RenderResult, space: string): HTMLElement => {
    const found = view.container.querySelector(`[data-brains-space="${space}"]`)
    if (found === null) throw new Error(`no ${space} group`)
    return found as HTMLElement
  }

  it('opens on Usage with brain rows stating their model as text, and no second picker for the coordinator role', async () => {
    // JJ, 7 Sep 2026: "drop down not needed in brains - just choose model in edit".
    const view = await mount()
    expect(view.getByRole('tab', { name: 'Usage', selected: true })).toBeTruthy()
    const chat = group(view, 'chat')
    // Coding follows the default, marked as such; Design states its override.
    const modelText = (id: string): string | null | undefined =>
      chat.querySelector(`[data-brain="${id}"] [data-brain-model]`)?.getAttribute('data-brain-model')
    expect(modelText('coding')).toBe('Default · auto')
    expect(modelText('design')).toBe('gpt-5.5')
    expect(chat.querySelector('[data-brain="design"] [data-brain-model]')?.textContent).toBe('gpt-5.5')
    // No row carries a model select; the Edit sheet is where a model is chosen.
    expect(chat.querySelectorAll('select')).toHaveLength(0)
    expect(group(view, 'gallery').querySelectorAll('select')).toHaveLength(0)
    // JJ, 7 Sep 2026: the Project Coordinator row under Agent roles is the
    // role; a "Project leadership" picker beneath it read as the same role twice.
    expect(view.queryByRole('table', { name: 'Project leadership' })).toBeNull()
    expect(calls.some(call => call.url.startsWith('/idealize/comm/roles'))).toBe(false)
  })

  it('lists providers and models alphabetically in every picker, whatever order the routes serve', async () => {
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
    // The sheet's model select: Anthropic's group carries its terminal-CLI
    // mark, and the order is by the names as shown.
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    const coding = view.getByRole('form', { name: 'Edit brain' }).querySelector('[data-brains-model]') as HTMLSelectElement
    expect([...coding.querySelectorAll('optgroup')].map(node => node.label))
      .toEqual([ruled('Anthropic · claude CLI in the terminal'), ruled('Free tokens'), ruled('OpenAI (ChatGPT)')])
    expect([...coding.options].map(option => option.textContent))
      .toEqual(['Default (follows the default model)', 'claude', 'auto', 'k3', 'Gpt-4', 'gpt-5.5', 'gpt-5.10'])
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    // A generating brain's sheet sorts the space's candidates the same way,
    // and its chat-model select follows the chat catalogue's order.
    fireEvent.click(within(group(view, 'gallery')).getByRole('button', { name: 'Edit' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const images = sheet.querySelector('[data-brains-model]') as HTMLSelectElement
    expect([...images.options].map(option => option.textContent)).toEqual(['Choose a model', 'Still A', 'Still B'])
    const chatModel = sheet.querySelector('[data-brains-chat-model]') as HTMLSelectElement
    expect([...chatModel.options].map(option => option.textContent).slice(1)).toEqual(['claude', 'auto', 'k3', 'Gpt-4', 'gpt-5.5', 'gpt-5.10'])
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
    expect(note?.textContent).toContain('Not signed in to OpenAI (ChatGPT)')
    expect(within(note as HTMLElement).queryByRole('button', { name: 'Add key' })).toBeNull()
    const link = within(note as HTMLElement).getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/idealize/signin')
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
    expect([...sheet.querySelectorAll('[data-brains-field]')].map(node => node.getAttribute('data-brains-field')))
      .toEqual(['spaces', 'name', 'model', 'chat-model', 'instructions'])
    expect(within(sheet).getByRole('combobox', { name: 'Generation model' })).toBeTruthy()
    const chatModel = within(sheet).getByRole('combobox', { name: 'Chat model' }) as HTMLSelectElement
    // No override yet, so the field follows the default.
    expect(chatModel.value).toBe('')
    fireEvent.change(chatModel, { target: { value: 'anthropic claude' } })
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
    expect(within(view.getByRole('form', { name: 'Edit brain' })).queryByRole('combobox', { name: 'Chat model' })).toBeNull()
  })

  it('groups the brains under the five space headings in the roster order', async () => {
    const view = await mount()
    expect([...view.container.querySelectorAll('[data-brains-space]')]
      .map(node => node.getAttribute('data-brains-space')))
      .toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    // Each group's rows, in order: its brains, then the space's own
    // generation-model row where the space generates.
    const rows = (space: string): (string | null)[] =>
      [...group(view, space).querySelectorAll('[role="row"] > span:first-child')].map(cell => cell.textContent)
    expect(rows('chat')).toEqual(['Coding', 'Design', 'Free'])
    // The Terminal group closes with the Default CLI row (the launch every brain without its own choice types).
    expect(rows('terminal')).toEqual(['Coding', 'Design', 'Default CLI'])
    // The Gallery brain states the space's model, so no Images row repeats it.
    expect(rows('gallery')).toEqual(['Gallery agent'])
    expect(rows('soundstage')).toEqual(['Sounds'])
    expect(rows('motion')).toEqual(['Video'])
    // Every group offers its own add row, and the headings name the spaces.
    expect(view.getAllByRole('button', { name: 'Add a brain' })).toHaveLength(5)
    for (const label of ['Chat', 'Terminal', 'Images', 'Sounds', 'Video']) {
      expect(view.getByRole('table', { name: label })).toBeTruthy()
    }
  })

  it('lists Free under Chat alone, its pinned model stated, and the Terminal group lists the others', async () => {
    const view = await mount()
    const chatRow = group(view, 'chat').querySelector('[data-brain="free"]')
    if (chatRow === null) throw new Error('Free is missing from chat')
    const pinned = chatRow.querySelector('[data-brain-pinned]')
    expect(pinned?.textContent).toBe('auto')
    expect(pinned?.getAttribute('data-brain-model')).toBe('auto')
    expect(within(chatRow as HTMLElement).getByRole('button', { name: 'Edit' })).toBeTruthy()
    // Free's `spaces` names Chat only, so the Terminal group does not list it.
    expect(group(view, 'terminal').querySelector('[data-brain="free"]')).toBeNull()
    expect([...group(view, 'terminal').querySelectorAll('[data-brain]')].map(row => row.getAttribute('data-brain')))
      .toEqual(['coding', 'design'])
  })

  it('lists only the spaceless brains under Agent roles', async () => {
    const view = await mount()
    const others = view.getByRole('table', { name: 'Agent roles' })
    expect([...others.querySelectorAll('[role="row"] > span:first-child')].map(cell => cell.textContent))
      .toEqual(['Lead Agent'])
    expect(within(others).getByRole('button', { name: 'Add agent role' })).toBeTruthy()
  })

  it('states a chat brain\'s model on its row and saves a new choice through the sheet alone', async () => {
    const view = await mount()
    const row = group(view, 'chat').querySelector<HTMLElement>('[data-brain="coding"]')!
    expect(row.querySelector('[data-brain-model]')?.getAttribute('data-brain-model')).toBe('Default · auto')
    expect(row.querySelector('select')).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const model = sheet.querySelector('[data-brains-model]') as HTMLSelectElement
    // The sheet opens on the row's current choice: none, so the default.
    expect(model.value).toBe('')
    fireEvent.change(model, { target: { value: 'anthropic claude' } })
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
    const images = view.getByRole('form', { name: 'Edit brain' }).querySelector('[data-brains-model]') as HTMLSelectElement
    expect(images.value).toBe('mediahub still-a')
    expect(Array.from(images.options).map(option => option.textContent)).toEqual(['Choose a model', 'Still A', 'Still B'])
    fireEvent.change(images, { target: { value: 'mediahub still-b' } })
    fireEvent.click(view.getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/brains/media')).toHaveLength(1) })
    const post = posts('/idealize/brains/media')[0]!
    expect(sent(post)).toEqual({ id: 'images', model: { backend: 'mediahub', model: 'still-b' } })
    expect((post.init?.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
    // Sound Stage has no brain, so the space's own row states the model a
    // generate call falls to while nothing is chosen, as text; adding a brain
    // for the space is where that model gets chosen.
    const sound = group(view, 'soundstage').querySelector<HTMLElement>('[data-media-preset="sound"]')!
    expect(sound.querySelector('[data-brain-model]')?.getAttribute('data-brain-model')).toBe('Default · Tone A')
    expect(sound.querySelector('select')).toBeNull()
  })

  it("states Motion's live reason in its own group, with the add-key recovery only while a key is what is missing", async () => {
    const view = await mount()
    const motion = group(view, 'motion')
    expect(within(motion).queryByRole('combobox')).toBeNull()
    expect(motion.querySelector('[data-media-reason]')?.getAttribute('data-media-reason')).toBe('no-compatible-model')
    expect(within(motion).getByText(MOTION_RECOVERY)).toBeTruthy()
    fireEvent.click(within(motion).getByRole('button', { name: 'Add OpenRouter key' }))
    expect(view.getByTestId('provider-editor')).toBeTruthy()
    cleanup()
    // With the key stored and the catalogue empty, a key action would mislead.
    motionKeyMissing = false
    const connected = await mount()
    expect(within(group(connected, 'motion')).getByText(MOTION_RECOVERY)).toBeTruthy()
    expect(within(group(connected, 'motion')).queryByRole('button', { name: 'Add OpenRouter key' })).toBeNull()
  })

  it('marks a brain whose route runs as a CLI in the terminal, in its row, its picker groups and under Subscriptions', async () => {
    agentsPayload = { ...AGENTS, agents: [...AGENTS.agents, WRITER] }
    const view = await mount()
    const row = (await view.findAllByText('Writer'))[0]!.closest('[data-brain]') as HTMLElement
    const note = row.querySelector('[data-brain-access]')
    expect(note?.getAttribute('data-brain-access')).toBe('terminal-only')
    expect(note?.textContent).toContain('Runs as the claude CLI in the terminal, on its subscription. Chat needs an API key.')
    // JJ's 31 Aug decision: the terminal keeps the subscription, chat gets the API option — so Add key stays.
    expect(within(note as HTMLElement).getByRole('button', { name: 'Add key' })).toBeTruthy()
    // The row states the model; the sheet's select carries the mark on the provider's group.
    expect(row.querySelector('[data-brain-model]')?.getAttribute('data-brain-model')).toBe('claude-opus-5')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const sheetModel = view.getByRole('form', { name: 'Edit brain' }).querySelector('[data-brains-model]')!
    const groups = [...sheetModel.querySelectorAll('optgroup')].map(group => group.getAttribute('label'))
    expect(groups).toContain(ruled('Anthropic · claude CLI in the terminal'))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    const cli = view.container.querySelector('[data-terminal-cli="claude"]') as HTMLElement
    expect(cli.textContent).toContain('Anthropic')
    expect(cli.textContent).toContain('Runs as the claude CLI in the terminal, on its subscription')
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
    const sheetModel = view.getByRole('form', { name: 'Edit brain' }).querySelector('[data-brains-model]')!
    const groups = [...sheetModel.querySelectorAll('optgroup')].map(group => group.getAttribute('label'))
    expect(groups).toContain(ruled('Anthropic'))
    expect(groups).not.toContain(ruled('Anthropic · claude CLI in the terminal'))
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
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
    expect(row.textContent).toContain('No key for Deepseek-official')
    // Ready brains carry no mark.
    expect(group(view, 'chat').querySelector('[data-brain-access]')).toBeNull()
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Add key' }))
    expect(view.getByTestId('provider-editor')).toBeTruthy()
  })

  it('asks a space group\'s add row for spaces, then the model, then the instructions', async () => {
    const view = await mount()
    fireEvent.click(within(group(view, 'gallery')).getByRole('button', { name: 'Add a brain' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    // The fields in the order the flow asks them: spaces first, then the
    // model those spaces narrow, then the instructions.
    expect([...sheet.querySelectorAll('[data-brains-field]')].map(node => node.getAttribute('data-brains-field')))
      .toEqual(['spaces', 'name', 'model', 'chat-model', 'instructions'])
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
    const model = sheet.querySelector('[data-brains-model]') as HTMLSelectElement
    expect(Array.from(model.options).map(option => option.textContent)).toEqual(['Choose a model', 'Still A', 'Still B'])
    const galleryCount = model.options.length
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(group(view, 'chat')).getByRole('button', { name: 'Add a brain' }))
    const chatModel = view.getByRole('form', { name: 'Edit brain' })
      .querySelector('[data-brains-model]') as HTMLSelectElement
    expect(chatModel.options.length).toBeGreaterThan(galleryCount)
  })

  it('persists the chosen space, and the space model, when a new brain is saved', async () => {
    const view = await mount()
    fireEvent.click(within(group(view, 'gallery')).getByRole('button', { name: 'Add a brain' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    fireEvent.change(sheet.querySelector('input[type="text"], input:not([type])')!, { target: { value: 'Poster' } })
    fireEvent.change(sheet.querySelector('[data-brains-model]')!, { target: { value: 'mediahub still-b' } })
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
    // An edited brain arrives with its own spaces checked, so saving cannot
    // silently drop it out of a group.
    expect([...sheet.querySelectorAll('input[type="checkbox"]')]
      .filter(box => (box as HTMLInputElement).checked)
      .map(box => (box.parentElement?.textContent ?? '').trim())).toEqual(['Chat', 'Terminal'])
    expect(sheet.querySelector('[data-brains-add-space]')).toBeNull()
    fireEvent.change(name, { target: { value: 'Code' } })
    fireEvent.change(sheet.querySelector('[data-brains-model]')!, { target: { value: 'openai-codex gpt-5.5' } })
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
    fireEvent.click(view.getByRole('button', { name: 'Add agent role' }))
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
    fireEvent.click(within(group(view, 'chat')).getByRole('button', { name: 'Add a brain' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const model = sheet.querySelector('[data-brains-model]') as HTMLSelectElement
    fireEvent.change(model, { target: { value: 'anthropic claude' } })
    expect(model.value).toBe('anthropic claude')
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
    const after = view.getByRole('form', { name: 'Edit brain' })
      .querySelector('[data-brains-model]') as HTMLSelectElement
    expect(after.value).toBe('')
    expect(Array.from(after.options).map(option => option.textContent))
      .toEqual(['Choose a model', 'Still A', 'Still B'])
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

  it('states each Terminal brain\'s CLI on its row and chooses it in the sheet, beside the model', async () => {
    const view = await mount()
    const terminal = group(view, 'terminal')
    // JJ, 10 Sep 2026: the row states the launch, the sheet asks it — one
    // place chooses what a brain runs, and it is the same place as the model.
    expect(terminal.querySelector('[data-brain="design"] [data-brain-model]')?.textContent).toBe('Codex CLI · gpt-5.5')
    expect(within(terminal).queryByRole('combobox', { name: 'Design CLI' })).toBeNull()
    const designRow = terminal.querySelector('[data-brain="design"]') as HTMLElement
    fireEvent.click(within(designRow).getByRole('button', { name: 'Edit' }))
    const sheet = view.getByRole('form', { name: 'Edit brain' })
    const cli = within(sheet).getByRole('combobox', { name: 'Terminal CLI' }) as HTMLSelectElement
    expect(cli.value).toBe('codex')
    // A CLI the login shell cannot find is not offered to a brain not on it.
    expect([...cli.options].map(option => option.textContent))
      .toEqual(['Default (Claude Code)', 'Claude Code', 'Codex CLI', 'Plain shell'])
    // The sheet asks the model too: a CLI brings its own, which this app cannot enumerate.
    expect(sheet.querySelector('[data-brains-model]')).not.toBeNull()
    fireEvent.change(cli, { target: { value: '' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save brain' }))
    await waitFor(() => { expect(posts('/idealize/terminal/launch')).toHaveLength(1) })
    expect(sent(posts('/idealize/terminal/launch')[0]!)).toEqual({ activity: 'design', command: '' })
    // Which CLI a shell types by default stays a Terminal-group row: it belongs to no brain.
    const fallback = within(group(view, 'terminal')).getByRole('combobox', { name: 'Default CLI' }) as HTMLSelectElement
    expect(fallback.value).toBe('cli:claude-code')
    fireEvent.change(fallback, { target: { value: 'cli:codex' } })
    await waitFor(() => { expect(posts('/idealize/terminal/launch')).toHaveLength(2) })
    expect(sent(posts('/idealize/terminal/launch')[1]!)).toEqual({ command: 'codex' })
    // The Chat group states the model alone; no row carries a per-brain select.
    const chat = group(view, 'chat')
    expect(chat.querySelector('[data-brain="design"] [data-brain-model]')?.getAttribute('data-brain-model')).toBe('gpt-5.5')
    expect(chat.querySelectorAll('select')).toHaveLength(0)
    // A chat route's key state stays off the Terminal rows: the shell launches a CLI.
    expect(terminal.querySelector('[data-brain-access]')).toBeNull()
    expect(chat.querySelector('[data-brain-access]')).toBeNull()
  })

  it('keeps a stored choice of a missing CLI visible, marked, rather than silently rereading it', async () => {
    launchesPayload = { ...LAUNCHES, byActivity: { design: 'gemini' } }
    const view = await mount()
    const terminal = group(view, 'terminal')
    await waitFor(() => {
      expect(terminal.querySelector('[data-brain="design"] [data-brain-model]')?.textContent)
        .toBe('Gemini CLI · gpt-5.5')
    })
    fireEvent.click(within(terminal.querySelector('[data-brain="design"]') as HTMLElement)
      .getByRole('button', { name: 'Edit' }))
    const cli = within(view.getByRole('form', { name: 'Edit brain' }))
      .getByRole('combobox', { name: 'Terminal CLI' }) as HTMLSelectElement
    expect(cli.value).toBe('gemini')
    expect([...cli.options].map(option => option.textContent))
      .toEqual(['Default (Claude Code)', 'Claude Code', 'Codex CLI', 'Gemini CLI · not found on this Mac', 'Plain shell'])
  })

  it('states the model on Terminal rows, like any other row, where the launches route serves no catalogue (plain browser)', async () => {
    launchesPayload = { default: '', byActivity: {} }
    const view = await mount()
    const terminal = group(view, 'terminal')
    expect(within(terminal).queryByRole('combobox', { name: 'Design CLI' })).toBeNull()
    expect(terminal.querySelectorAll('select')).toHaveLength(0)
    expect(terminal.querySelector('[data-brain="design"] [data-brain-model]')?.getAttribute('data-brain-model')).toBe('gpt-5.5')
    expect(terminal.querySelector('[data-terminal-default-cli]')).toBeNull()
  })

  it('lists subscriptions, and the strategy select switches the engine preset', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    expect(view.getByText('OpenAI (ChatGPT)')).toBeTruthy()
    // Anthropic has no key and a terminal CLI serves its route, so it lists once, under Subscriptions as that CLI.
    expect(view.getAllByText('Anthropic')).toHaveLength(1)
    expect(view.getByText('Runs as the claude CLI in the terminal, on its subscription')).toBeTruthy()
    // Every chat provider holds a key, so no row reports one missing.
    expect(view.queryAllByText('Key missing')).toHaveLength(0)
    expect(view.getByText('Choose how free providers are ranked · 2 models')).toBeTruthy()
    const strategy = view.getByRole('combobox', { name: 'Routing strategy' }) as HTMLSelectElement
    await waitFor(() => { expect(strategy.value).toBe('balanced') })
    expect(Array.from(strategy.options).map(option => option.value)).toEqual(['priority', 'balanced', 'fastest', 'smartest', 'reliable'])
    fireEvent.change(strategy, { target: { value: 'smartest' } })
    await waitFor(() => { expect(posts('/idealize/freetokens/routing/strategy')).toHaveLength(1) })
    expect(sent(posts('/idealize/freetokens/routing/strategy')[0]!)).toEqual({ strategy: 'smartest' })
    expect(posts('/idealize/models/preferences')).toHaveLength(0)
    // The re-hosted provider editor is now the marked advanced route, reached
    // from the add list rather than from a "+" that led straight to a URL field.
    fireEvent.click(view.getByRole('button', { name: 'Add a service' }))
    fireEvent.click(await view.findByText('Something else\u2026'))
    expect(view.getByTestId('provider-editor')).toBeTruthy()
  })

  it('shows the engine vector as percentages and saves a moved slider as the custom vector', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    const reliability = view.getByRole('slider', { name: 'Reliability' }) as HTMLInputElement
    // Balanced 0.5 / 0.25 / 0.25 reads 50% / 25% / 25%, in the Paper frame's order.
    await waitFor(() => { expect(reliability.value).toBe('50') })
    expect(reliability.disabled).toBe(false)
    expect(view.getAllByRole('slider').map(slider => slider.getAttribute('aria-label'))).toEqual(['Reliability', 'Speed', 'Intelligence'])
    expect(view.getByText('50%')).toBeTruthy()
    expect(view.getAllByText('25%')).toHaveLength(2)
    fireEvent.change(reliability, { target: { value: '80' } })
    fireEvent.mouseUp(reliability)
    await waitFor(() => { expect(posts('/idealize/freetokens/routing/strategy')).toHaveLength(1) })
    expect(sent(posts('/idealize/freetokens/routing/strategy')[0]!)).toEqual({
      strategy: 'custom', weights: { reliability: 80, speed: 25, intelligence: 25 },
    })
    expect(posts('/idealize/models/preferences')).toHaveLength(0)
  })

  it('disables the card when the engine is unreachable', async () => {
    routing = null
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    const strategy = view.getByRole('combobox', { name: 'Routing strategy' }) as HTMLSelectElement
    expect(strategy.disabled).toBe(true)
    expect(strategy.value).toBe('priority')
    for (const slider of view.getAllByRole('slider') as HTMLInputElement[]) expect(slider.disabled).toBe(true)
    expect(view.getAllByText('—')).toHaveLength(3)
    expect(posts('/idealize/freetokens/routing/strategy')).toHaveLength(0)
  })

  it('shows the budget table per scope and saves a monthly budget', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(view.getAllByText('1.5k').length).toBeGreaterThan(0) })
    expect(view.getAllByText('2.4M')).toHaveLength(2)
    const table = view.getByRole('table', { name: 'Budget breakdown' })
    expect(table.querySelectorAll('[role="row"]')).toHaveLength(5)
    // Each cell leads with the configured-price cost over the token count.
    expect(within(table).getAllByText(usd(20))).toHaveLength(2) // month: Subscriptions and Total
    expect(within(table).getByText(usd(160.5))).toBeTruthy()
    expect(within(table).getByText(usd(0.5))).toBeTruthy()
    // What the shown costs leave out is called out, not silently zeroed.
    expect(view.getByText('No monthly cost set for Anthropic; those subscriptions are not counted in costs.')).toBeTruthy()
    expect(view.getByText('12 tokens this year have no price set and are not counted in costs.')).toBeTruthy()
    fireEvent.change(view.getByRole('combobox', { name: 'View' }), { target: { value: '/p/alpha' } })
    await waitFor(() => {
      expect(calls.some(call => call.url === `/idealize/models/usage?scope=${encodeURIComponent('/p/alpha')}`)).toBe(true)
    })
    fireEvent.click(view.getByRole('button', { name: 'Set a budget' }))
    fireEvent.change(view.getByRole('textbox', { name: 'Monthly budget' }), { target: { value: '500000' } })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
    await waitFor(() => { expect(posts('/idealize/models/budget')).toHaveLength(1) })
    expect(sent(posts('/idealize/models/budget')[0]!)).toEqual({ monthlyTokenBudget: 500000 })
  })

  it('shows token-only cells and a pricing hint while no price or plan cost is configured', async () => {
    usagePayload = {
      ...USAGE,
      cost: {
        currency: 'USD',
        month: { subscriptions: 0, metered: 0, free: 0, total: 0 },
        year: { subscriptions: 0, metered: 0, free: 0, total: 0 },
        unpricedTokens: { month: 0, year: 12 },
        unpricedSubscriptions: ['openai-codex'],
        configured: false,
      },
    }
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(view.getAllByText('1.5k').length).toBeGreaterThan(0) })
    const table = view.getByRole('table', { name: 'Budget breakdown' })
    // Never a made-up figure: no cost renders until the user supplies prices.
    expect(table.querySelectorAll('[data-budget-cost]')).toHaveLength(0)
    expect(view.getByText('Costs appear once you set a model’s price below or a subscription cost in settings.')).toBeTruthy()
    expect(view.container.querySelector('[data-budget-unpriced-subs]')).toBeNull()
    expect(view.container.querySelector('[data-budget-unpriced-tokens]')).toBeNull()
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
    const select = view.getByRole('form', { name: 'Edit brain' }).querySelector('[data-brains-model]') as HTMLSelectElement
    expect([...select.querySelectorAll('optgroup')].map(node => node.label))
      .toEqual([ruled('Free tokens'), ruled('Kimi-coding'), ruled('Mutter'), ruled('OpenAI (ChatGPT)')])
    // The catalogue note states what the lists hold and when they were read.
    expect(view.container.querySelector('[data-brains-catalogue]')?.textContent)
      .toBe(`4 models from 4 services, read ${when(STATE.readAt)}. A model a service has not published yet is not listed.`)
    // No filter field over a short catalogue.
    expect(view.container.querySelector('[data-brains-model-filter]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    // The Models tab's Subscriptions rows read the same names.
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    expect(view.getByText('Kimi-coding')).toBeTruthy()
  })

  it('offers a filter over a long catalogue, and says so when nothing matches', async () => {
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
    const form = view.getByRole('form', { name: 'Edit brain' })
    const select = form.querySelector('[data-brains-model]') as HTMLSelectElement
    expect(select.options).toHaveLength(48)
    const filter = view.getByRole('searchbox', { name: 'Filter models' })
    fireEvent.change(filter, { target: { value: 'GPT-5' } })
    expect([...select.querySelectorAll('optgroup')].map(node => node.label)).toEqual([ruled('OpenAI')])
    expect([...select.options].map(option => option.textContent)).toEqual(['Default (follows the default model)', 'gpt-5.4', 'gpt-5.5'])
    // A provider's name matches too, keeping its whole group.
    fireEvent.change(filter, { target: { value: 'free' } })
    expect([...select.querySelectorAll('optgroup')].map(node => node.label)).toEqual([ruled('Free tokens')])
    expect(select.options).toHaveLength(46)
    fireEvent.change(filter, { target: { value: 'gpt-6' } })
    expect(select.querySelectorAll('optgroup')).toHaveLength(0)
    expect(form.querySelector('[data-brains-catalogue]')?.textContent)
      .toBe('No model matches “gpt-6”. A model a service has not published yet is not listed.')
    // Closing the sheet clears the filter for the next open.
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(group(view, 'chat')).getAllByRole('button', { name: 'Edit' })[0]!)
    expect((view.getByRole('searchbox', { name: 'Filter models' }) as HTMLInputElement).value).toBe('')
  })

  it('lists each model used this month with its cost, and saves a typed price for an unpriced one', async () => {
    // JJ, 8 Sep 2026: "Cost of the models has not been included in the budget section."
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(view.getByRole('table', { name: 'Models this month' })).toBeTruthy() })
    const table = view.getByRole('table', { name: 'Models this month' })
    expect([...table.querySelectorAll('[data-spend-model]')].map(row => row.getAttribute('data-spend-model')))
      .toEqual(['openai-codex gpt-5.5', 'anthropic claude', 'openrouter a/b', 'freetokens auto'])
    // A priced metered row shows its cost; an unpriced one a dash and the action; the others their category.
    expect(table.querySelector('[data-spend-cost="openrouter a/b"]')?.textContent).toBe(usd(0.25))
    expect(table.querySelector('[data-spend-unpriced="anthropic claude"]')).toBeTruthy()
    expect(within(table.querySelector('[data-spend-model="openai-codex gpt-5.5"]') as HTMLElement).getByText('Subscription')).toBeTruthy()
    expect(within(table.querySelector('[data-spend-model="freetokens auto"]') as HTMLElement).getByText('Free')).toBeTruthy()
    // The total sums the priced rows and counts the unpriced ones.
    expect(table.querySelector('[data-spend-total-cost]')?.textContent).toBe(usd(0.25))
    expect(table.querySelector('[data-spend-unpriced-count]')?.textContent).toBe('1 unpriced')
    // The OpenRouter-priced row names its source in the editor.
    fireEvent.click(within(table).getByRole('button', { name: 'Edit price' }))
    expect(table.querySelector('[data-spend-price-source="market"]')?.textContent)
      .toBe(`Price published by OpenRouter, read ${when('2026-09-08T07:24:39.767Z')}. A price you type replaces it.`)
    expect((view.getByRole('textbox', { name: 'a/b Input per million' }) as HTMLInputElement).value).toBe('1')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    // Set a price on the unpriced row: input and output typed, cache prices left to the input price.
    fireEvent.click(within(table).getByRole('button', { name: 'Set price' }))
    fireEvent.change(view.getByRole('textbox', { name: 'claude Input per million' }), { target: { value: '3' } })
    fireEvent.change(view.getByRole('textbox', { name: 'claude Output per million' }), { target: { value: '15' } })
    fireEvent.click(view.getByRole('button', { name: 'Cache prices' }))
    fireEvent.change(view.getByRole('textbox', { name: 'claude Cache read per million' }), { target: { value: '0.3' } })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
    await waitFor(() => { expect(posts('/idealize/models/prices')).toHaveLength(1) })
    expect(sent(posts('/idealize/models/prices')[0]!)).toEqual({
      provider: 'anthropic',
      model: 'claude',
      price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
    })
    expect(view.getByRole('status').textContent).toBe('Price saved.')
    // The usage re-reads so the row's cost appears.
    expect(calls.filter(call => call.url.startsWith('/idealize/models/usage')).length).toBeGreaterThan(1)
  })

  it('lists each endpoint that generated this month with what fal billed for it', async () => {
    // JJ, 8 Sep 2026: "what about Fal?"
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(view.getByRole('table', { name: 'Generations this month' })).toBeTruthy() })
    const table = view.getByRole('table', { name: 'Generations this month' })
    expect([...table.querySelectorAll('[data-generation-row]')].map(row => row.getAttribute('data-generation-row')))
      .toEqual(['fal-ai/flux/dev', 'fal-ai/kling/video', 'fal-ai/whisper', 'fal-ai/any-llm'])
    // What it made: the count, with the media kind beside the service's name.
    expect(within(table.querySelector('[data-generation-row="fal-ai/flux/dev"]') as HTMLElement).getByText('Fal · images')).toBeTruthy()
    expect(within(table.querySelector('[data-generation-row="fal-ai/kling/video"]') as HTMLElement).getByText('Fal · video')).toBeTruthy()
    // An endpoint only fal reported carries no media type, so it names the service alone.
    expect(within(table.querySelector('[data-generation-row="fal-ai/whisper"]') as HTMLElement).getByText('Fal')).toBeTruthy()
    // A media type outside images, video and sound reads as files.
    expect(within(table.querySelector('[data-generation-row="fal-ai/any-llm"]') as HTMLElement).getByText('Fal · files')).toBeTruthy()
    // The billed cost in fal's own currency, with the units fal charged for.
    expect(table.querySelector('[data-generation-cost="fal-ai/flux/dev"]')?.textContent).toBe(usd(0.52))
    expect(within(table.querySelector('[data-generation-row="fal-ai/flux/dev"]') as HTMLElement).getByText('6 image')).toBeTruthy()
    // A row fal has counted but not billed says so rather than showing a zero.
    expect(table.querySelector('[data-generation-unbilled="fal-ai/kling/video"]')?.textContent).toBe('not billed yet')
    expect(table.querySelector('[data-generations-total-cost]')?.textContent).toBe(usd(0.62))
    expect(view.container.querySelector('[data-generations-connect]')).toBeNull()
    expect(view.container.querySelector('[data-generations-error]')).toBeNull()
  })

  it('asks for a fal key, says when nothing was generated, and passes fal’s refusal through', async () => {
    usagePayload = { ...USAGE, generations: { ...USAGE.generations, rows: [], billed: undefined, currency: null }, falUsage: null }
    const bare = await mount()
    fireEvent.click(bare.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(bare.getByRole('table', { name: 'Generations this month' })).toBeTruthy() })
    expect(bare.getByText('No generations this month.')).toBeTruthy()
    expect(bare.container.querySelector('[data-generations-connect]')?.textContent)
      .toBe('Connect fal to see what generations cost.')
    // Nothing billed leaves the total a dash, never a made-up zero.
    expect(bare.container.querySelector('[data-generations-total-cost]')).toBeNull()
    cleanup()

    usagePayload = { ...USAGE, falUsage: { fetchedAt: null, error: 'fal.ai answered 403: Access denied' } }
    const refused = await mount()
    fireEvent.click(refused.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(refused.container.querySelector('[data-generations-error]')).toBeTruthy() })
    expect(refused.container.querySelector('[data-generations-error]')?.textContent)
      .toBe('fal did not report its billing. fal.ai answered 403: Access denied')
    expect(refused.container.querySelector('[data-generations-connect]')).toBeNull()
  })

  it('names the shipped catalogue as a price’s source in the editor', async () => {
    usagePayload = {
      ...USAGE,
      models: [
        { provider: 'anthropic', model: 'claude', category: 'metered', total: 900, cost: 0.9, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, source: 'catalogue' } },
      ],
    }
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(view.getByRole('table', { name: 'Models this month' })).toBeTruthy() })
    fireEvent.click(within(view.getByRole('table', { name: 'Models this month' })).getByRole('button', { name: 'Edit price' }))
    expect(view.container.querySelector('[data-spend-price-source="catalogue"]')?.textContent)
      .toBe('Price from the model catalogue the app ships. A price you type replaces it.')
  })

  it('refuses to save a price with a figure missing, rather than reading the gap as free', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Budget' }))
    await waitFor(() => { expect(view.getByRole('table', { name: 'Models this month' })).toBeTruthy() })
    fireEvent.click(within(view.getByRole('table', { name: 'Models this month' })).getByRole('button', { name: 'Set price' }))
    fireEvent.change(view.getByRole('textbox', { name: 'claude Input per million' }), { target: { value: '3' } })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
    expect(posts('/idealize/models/prices')).toHaveLength(0)
    expect(view.getByRole('status').textContent).toBe('Enter an input and an output price.')
  })

  it('lists every service in one place, saying what each one makes', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    const list = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-services]')
      expect(found).not.toBeNull()
      return found!
    })
    // Connected services read first; the rest wait behind "Add a service".
    expect(Array.from(list.querySelectorAll('[data-service]')).map(row => row.getAttribute('data-service')))
      .toEqual(['deepseek'])
    fireEvent.click(view.getByRole('button', { name: 'Add a service' }))
    // Media leads under its own label: unlabelled, the services that make
    // images and video are buried among the chat routes.
    await waitFor(() => {
      expect(Array.from(list.querySelectorAll('[data-service]')).map(row => row.getAttribute('data-service')))
        .toEqual(['fal', 'acme'])
    })
    expect(Array.from(list.querySelectorAll('[data-service-group]')).map(node => node.textContent))
      .toEqual(['Images, video and sound', 'Chat'])
    // A service is described by what it makes, in the person's words.
    const fal = list.querySelector<HTMLElement>('[data-service="fal"]')!
    expect(within(fal).getByText('Images · Video · Sounds')).toBeTruthy()
  })

  it('connects a service with a key and nothing else, and never asks for a web address', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    fireEvent.click(await view.findByRole('button', { name: 'Add a service' }))
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

  it('offers a key page only for a service whose page is known', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    fireEvent.click(await view.findByRole('button', { name: 'Add a service' }))
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
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    expect(view.container.querySelector('[data-services-advanced]')).toBeNull()
    fireEvent.click(await view.findByRole('button', { name: 'Add a service' }))
    const advanced = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>('[data-services-advanced]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(advanced.textContent).toBe('Something else\u2026')
  })

  it('imports a keys file as it was read and names what it connected', async () => {
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    fireEvent.click(await view.findByRole('button', { name: 'Add a service' }))
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
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    fireEvent.click(await view.findByRole('button', { name: 'Add a service' }))
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

  it('says so plainly when there is nothing left to add', async () => {
    servicesList = servicesList.map(row => ({ ...row, connected: true }))
    const view = await mount()
    fireEvent.click(view.getByRole('tab', { name: 'Models' }))
    fireEvent.click(await view.findByRole('button', { name: 'Add a service' }))
    expect(await view.findByText('Every service this app knows is already connected.')).toBeTruthy()
  })
})

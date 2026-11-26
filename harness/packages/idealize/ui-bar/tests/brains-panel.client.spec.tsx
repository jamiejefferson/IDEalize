// @vitest-environment jsdom
// The Models pane: what runs each of the three views (Coding, Chat, Studio)
// with each row's state and its one action, the four ways to add another
// model with the editor each opens, the Studio models approved to run without
// asking, and the key flows the pane has always carried (connect a service,
// a refused key, the key page, a keys file, the web-address route).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en, zh } from '../src/client/locales.ts'
import { BrainsPanel, type BrainsPanelHost } from '../src/client/BrainsPanel.tsx'
import { BRAINS_CHANGED_EVENT } from '../src/client/brains-changed.ts'
// Type-only: the locale-namespace merge the translate face reads.
import type {} from '../src/client/index.ts'

const t = makeTranslate(en, commonEn)

interface Provider { provider: string; displayName: string; auth: 'oauth' | 'apiKey' | 'free'; connected: boolean; models: string[] }
interface State { default: { provider: string; model: string } | null; providers: Provider[] }

const STATE: State = {
  default: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
  providers: [
    { provider: 'openrouter', displayName: 'OpenRouter', auth: 'apiKey', connected: true, models: ['anthropic/claude-sonnet-5', 'openai/gpt-6'] },
    { provider: 'openai-codex', displayName: 'OpenAI (ChatGPT)', auth: 'oauth', connected: false, models: ['gpt-5.5'] },
    { provider: 'freetokens', displayName: 'Free tokens', auth: 'free', connected: true, models: ['auto', 'k3'] },
  ],
}
const DETAILS = {
  providers: [{
    provider: 'openrouter',
    displayName: 'OpenRouter',
    models: [
      { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5' },
      { id: 'openai/gpt-6', name: 'OpenAI: GPT-6' },
    ],
  }],
}

interface Cli { id: string; label: string; command: string; installed: boolean | null }
/** GET /idealize/terminal/launches, as the desktop app serves it (a plain browser gets no catalogue). */
const LAUNCHES: { default: string; byActivity: Record<string, string>; catalog?: Cli[] } = {
  default: 'claude --dangerously-skip-permissions',
  byActivity: {},
  catalog: [
    { id: 'claude-code', label: 'Claude Code', command: 'claude --dangerously-skip-permissions', installed: true },
    { id: 'codex', label: 'Codex CLI', command: 'codex', installed: true },
    { id: 'gemini', label: 'Gemini CLI', command: 'gemini', installed: true },
    { id: 'antigravity', label: 'Antigravity CLI', command: 'agy', installed: false },
    { id: 'kimi', label: 'Kimi CLI', command: 'kimi', installed: false },
    { id: 'shell', label: 'Plain shell', command: '', installed: true },
  ],
}

interface Service { id: string; kind: 'chat' | 'media'; name: string; makes: string[]; connected: boolean; keyUrl?: string }
const SERVICES: Service[] = [
  { id: 'openrouter', kind: 'chat', name: 'OpenRouter', makes: ['chat', 'image'], connected: true },
  { id: 'acme', kind: 'chat', name: 'Acme Gateway', makes: ['chat'], connected: false },
  { id: 'fal', kind: 'media', name: 'fal.ai', makes: ['image', 'video', 'audio'], connected: false, keyUrl: 'https://fal.ai/dashboard/keys' },
]
const APPROVED = [
  { key: 'fal/fal-ai/veo', backend: 'fal', model: 'fal-ai/veo', name: 'Veo 4' },
  { key: 'openrouter/google/lyria', backend: 'openrouter', model: 'google/lyria', name: 'Lyria 3' },
]

let statePayload: State
let launchesPayload: typeof LAUNCHES
let servicesList: Service[]
/** The fal models the media route lists; fal's catalogue is public, so they list without a key. */
let falCandidates: string[]
/** What GET /idealize/generate/approved answers: a list, or the 404 of a host without the route. */
let approvedPayload: typeof APPROVED | 404
/** The status POST /idealize/generate/approved answers with. */
let approvedPostStatus: number
let gatewayPayload: { configured: boolean; connected: boolean; services: string[] }

type Call = { url: string; init?: RequestInit | undefined }
let calls: Call[]

/** The JSON a POST carried. */
const sent = (call: Call): unknown => JSON.parse(call.init?.body as string)
const posts = (path: string): Call[] => calls.filter(call => call.url === path && call.init?.method === 'POST')

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function install(): void {
  calls = []
  statePayload = STATE
  launchesPayload = LAUNCHES
  servicesList = SERVICES
  falCandidates = []
  approvedPayload = APPROVED
  approvedPostStatus = 200
  gatewayPayload = { configured: false, connected: false, services: [] }
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, ...init === undefined ? {} : { init } })
    const posting = init?.method === 'POST'
    if (url === '/idealize/models/state') return Promise.resolve(json(statePayload))
    if (url === '/idealize/models/details') return Promise.resolve(json(DETAILS))
    if (url === '/idealize/models/default') {
      statePayload = { ...statePayload, default: sent({ url, init }) as State['default'] }
      return Promise.resolve(json({ ok: true }))
    }
    if (url === '/idealize/terminal/launches') return Promise.resolve(json(launchesPayload))
    if (url === '/idealize/terminal/launch') {
      launchesPayload = { ...launchesPayload, default: (sent({ url, init }) as { command: string }).command }
      return Promise.resolve(json(launchesPayload))
    }
    if (url === '/idealize/brains/media') {
      return Promise.resolve(json({
        presets: [{ id: 'images', candidates: falCandidates.map(id => ({ backend: 'fal', model: { id, name: id } })) }],
      }))
    }
    if (url === '/idealize/brains/gateway') return Promise.resolve(json(gatewayPayload))
    if (url === '/idealize/brains/services' && !posting) return Promise.resolve(json({ services: servicesList }))
    if (url === '/idealize/brains/services/import') {
      const body = JSON.parse(init?.body as string) as { credentials?: Record<string, string> }
      if (body.credentials?.NOBODY_API_KEY !== undefined) {
        return Promise.resolve(json({ error: 'NOBODY_API_KEY is not a credential any service this app can connect takes' }, 400))
      }
      servicesList = servicesList.map(row => row.id === 'acme' || row.id === 'fal' ? { ...row, connected: true } : row)
      return Promise.resolve(json({
        connected: [{ id: 'acme', kind: 'chat', name: 'Acme Gateway' }, { id: 'fal', kind: 'media', name: 'fal.ai' }],
        services: servicesList,
      }))
    }
    if (url === '/idealize/brains/services/check') return Promise.resolve(json({ check: 'working' }))
    if (url === '/idealize/brains/services') {
      const body = JSON.parse(init?.body as string) as { id: string; apiKey?: string }
      if (body.apiKey === 'refused-key') {
        return Promise.resolve(json({ error: 'The key is saved, but Acme Gateway could not be switched on. no models' }, 500))
      }
      servicesList = servicesList.map(row => row.id === body.id ? { ...row, connected: true } : row)
      return Promise.resolve(json({ services: servicesList }))
    }
    if (url === '/idealize/generate/approved' && posting) return Promise.resolve(json({ ok: approvedPostStatus === 200 }, approvedPostStatus))
    if (url === '/idealize/generate/approved') {
      return Promise.resolve(approvedPayload === 404 ? new Response('not found', { status: 404 }) : json({ models: approvedPayload }))
    }
    if (url.startsWith('/idealize/router/log')) {
      return Promise.resolve(json({
        entries: [{ at: '2026-11-25T09:00:00.000Z', from: 'openrouter/gpt-6', to: 'openrouter/claude-sonnet-5', switched: true, rationale: 'A coding task.', reading: { source: 'jev' } }],
      }))
    }
    return Promise.resolve(json({ ok: true }))
  }))
}

const host: BrainsPanelHost = {
  models: {
    Component: () => <div data-testid="provider-editor" />,
    props: {} as unknown as BrainsPanelHost['models']['props'],
  },
  followBrain: async () => undefined,
}

/** One view's row. */
const viewOf = (view: RenderResult, id: 'coding' | 'chat' | 'studio'): HTMLElement =>
  view.container.querySelector<HTMLElement>(`[data-view="${id}"]`)!
const mainOf = (row: HTMLElement): string => row.querySelector('[data-view-main]')?.textContent ?? ''
const noteOf = (row: HTMLElement): string => row.querySelector('[data-view-note]')?.textContent ?? ''
const stateOf = (row: HTMLElement): string => row.querySelector('[data-view-state]')?.textContent ?? ''

async function mount(props: Partial<Parameters<typeof BrainsPanel>[0]> = {}) {
  const view = render(<BrainsPanel host={host} t={t} {...props} />)
  // The Chat row names its model from the details route, which is the last read to land.
  await waitFor(() => {
    expect(viewOf(view, 'chat').dataset.viewStatus).toBeDefined()
    expect(viewOf(view, 'studio').dataset.viewStatus).toBeDefined()
    expect(calls.some(call => call.url === '/idealize/models/details')).toBe(true)
  })
  return view
}

/** Press one "Add another model" action. */
const add = (view: RenderResult, id: 'subscription' | 'key' | 'free'): void => {
  fireEvent.click(view.container.querySelector(`[data-models-add-action="${id}"]`)!)
}

/** Open the full list of services under "A key from a model company". */
const openAllServices = (view: RenderResult): void => {
  add(view, 'key')
  fireEvent.click(view.container.querySelector('[data-services-add]')!)
}

beforeEach(install)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Models pane', () => {
  it('is titled Models and lists its sections in order, with no tabs', async () => {
    const view = await mount()
    expect(view.getByRole('heading', { name: 'Models' })).toBeTruthy()
    expect(view.queryByRole('tab')).toBeNull()
    const text = view.container.textContent ?? ''
    const order = ['What runs each view', 'Add another model', 'Studio models you have approved', 'Recent model changes'].map(title => text.indexOf(title))
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('never says brain or Keychain, and never exclaims, in any string the pane owns', () => {
    const offending = [en, zh].flatMap(table => Object.entries(table)
      .filter(([key, value]) => (key.startsWith('models.') || key.startsWith('brains.')) && /brain|keychain|!/i.test(value))
      .map(([key]) => key))
    expect(offending).toEqual([])
  })

  describe('Coding', () => {
    it('names the app the Terminal starts, on the subscription, and marks it installed', async () => {
      const row = viewOf(await mount(), 'coding')
      expect(mainOf(row)).toBe('Claude Code, on your subscription')
      expect(noteOf(row)).toBe('Included in the plan you already pay for.')
      expect(stateOf(row)).toBe('Installed')
      expect(row.dataset.viewStatus).toBe('installed')
    })

    it('marks an app the computer does not have', async () => {
      launchesPayload = { ...LAUNCHES, default: 'kimi' }
      const row = viewOf(await mount(), 'coding')
      expect(mainOf(row)).toBe('Kimi CLI, on your subscription')
      expect(stateOf(row)).toBe('Not installed')
      expect(row.dataset.viewStatus).toBe('not-installed')
    })

    it('offers the installed apps behind Change and saves the choice as the Terminal\'s launch command', async () => {
      const view = await mount()
      const row = viewOf(view, 'coding')
      expect(row.querySelector('[data-coding-apps]')).toBeNull()
      fireEvent.click(within(row).getByRole('button', { name: 'Change' }))
      const radios = within(row).getAllByRole('radio') as HTMLInputElement[]
      // Antigravity and Gemini share one row, which uses the one this computer has; Kimi is not installed.
      expect(radios.map(radio => radio.parentElement?.textContent)).toEqual(['Claude Code', 'Codex', 'Antigravity or Gemini CLI'])
      expect(radios.map(radio => radio.checked)).toEqual([true, false, false])
      let raised = 0
      const count = (): void => { raised += 1 }
      document.addEventListener(BRAINS_CHANGED_EVENT, count)
      fireEvent.click(radios[2]!)
      await waitFor(() => { expect(mainOf(viewOf(view, 'coding'))).toBe('Antigravity or Gemini CLI, on your subscription') })
      document.removeEventListener(BRAINS_CHANGED_EVENT, count)
      const [call] = posts('/idealize/terminal/launch')
      expect(sent(call!)).toEqual({ command: 'gemini' })
      expect((call!.init!.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
      expect(raised).toBe(1)
      expect(view.getByRole('status').textContent).toBe('Coding now starts Antigravity or Gemini CLI.')
    })

    it('says the Terminal runs in the desktop app where no catalogue is served', async () => {
      launchesPayload = { default: '', byActivity: {} }
      const row = viewOf(await mount(), 'coding')
      expect(mainOf(row)).toBe('The Terminal runs in the desktop app.')
      expect(within(row).queryByRole('button')).toBeNull()
    })

    it('says no app starts when the Terminal opens a plain shell', async () => {
      launchesPayload = { ...LAUNCHES, default: '' }
      const row = viewOf(await mount(), 'coding')
      expect(mainOf(row)).toBe('No command-line app starts in the Terminal.')
      expect(stateOf(row)).toBe('Not installed')
    })
  })

  describe('Chat', () => {
    it('names the default model and its route, and who bills for it', async () => {
      const view = await mount()
      await waitFor(() => { expect(mainOf(viewOf(view, 'chat'))).toBe('Claude Sonnet 5, through OpenRouter') })
      const row = viewOf(view, 'chat')
      expect(noteOf(row)).toBe('Billed by OpenRouter for what you use.')
      expect(stateOf(row)).toBe('Connected')
    })

    it('says the free route costs nothing', async () => {
      statePayload = { ...STATE, default: { provider: 'freetokens', model: 'auto' } }
      const row = viewOf(await mount(), 'chat')
      expect(mainOf(row)).toBe('Best free model, through Free tokens')
      expect(noteOf(row)).toBe('At no cost.')
      expect(stateOf(row)).toBe('Connected')
    })

    it('says the organisation pays on a gateway route', async () => {
      statePayload = {
        default: { provider: 'gateway-anthropic', model: 'claude-opus-5' },
        providers: [{ provider: 'gateway-anthropic', displayName: 'Anthropic (gateway)', auth: 'apiKey', connected: true, models: ['claude-opus-5'] }],
      }
      const row = viewOf(await mount(), 'chat')
      expect(mainOf(row)).toBe('Claude Opus 5, through Anthropic (gateway)')
      expect(noteOf(row)).toBe('Paid by your organisation.')
    })

    it('says a key is needed when the default model\'s route has none, and when no model is set', async () => {
      statePayload = { ...STATE, providers: STATE.providers.map(row => ({ ...row, connected: false })) }
      const first = await mount()
      expect(stateOf(viewOf(first, 'chat'))).toBe('Needs a key')
      expect(viewOf(first, 'chat').dataset.viewStatus).toBe('needs-key')
      cleanup()
      statePayload = { ...STATE, default: null }
      const row = viewOf(await mount(), 'chat')
      expect(mainOf(row)).toBe('No chat model is chosen.')
      expect(stateOf(row)).toBe('Needs a key')
    })

    it('opens the model browser from Change and writes the choice as the app\'s default model', async () => {
      const view = await mount()
      fireEvent.click(within(viewOf(view, 'chat')).getByRole('button', { name: 'Change' }))
      const browser = await waitFor(() => {
        const found = document.body.querySelector<HTMLElement>('[data-model-browser="chat"]')
        expect(found?.querySelector('[data-browser-row]')).toBeTruthy()
        return found!
      })
      fireEvent.click(browser.querySelector('[data-browser-row="openrouter openai/gpt-6"]')!)
      fireEvent.click(browser.querySelector('[data-browser-apply]')!)
      await waitFor(() => { expect(mainOf(viewOf(view, 'chat'))).toBe('GPT-6, through OpenRouter') })
      expect(document.body.querySelector('[data-model-browser]')).toBeNull()
      const [call] = posts('/idealize/models/default')
      expect(sent(call!)).toEqual({ provider: 'openrouter', model: 'openai/gpt-6' })
      expect(view.getByRole('status').textContent).toBe('Chat now runs on GPT-6.')
    })
  })

  describe('Studio', () => {
    it('runs on OpenRouter alone without a fal key, and opens fal\'s key field from Add key', async () => {
      const view = await mount()
      const row = viewOf(view, 'studio')
      expect(mainOf(row)).toBe('Image, video and sound models on OpenRouter')
      expect(noteOf(row)).toBe('Add a fal key for access to more image, sound and video models.')
      expect(stateOf(row)).toBe('No fal key')
      fireEvent.click(within(row).getByRole('button', { name: 'Add key' }))
      fireEvent.change(within(row).getByLabelText('Your fal.ai key'), { target: { value: 'fal-key' } })
      fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
      await waitFor(() => { expect(stateOf(viewOf(view, 'studio'))).toBe('Connected') })
      expect(sent(posts('/idealize/brains/services')[0]!)).toEqual({ id: 'fal', kind: 'media', apiKey: 'fal-key' })
      expect(mainOf(viewOf(view, 'studio'))).toBe('Image, video and sound models on OpenRouter and fal')
      expect(noteOf(viewOf(view, 'studio'))).toBe('Billed by OpenRouter and fal for what you use.')
      expect(within(viewOf(view, 'studio')).queryByRole('button')).toBeNull()
    })

    it('counts the fal models only when the media route lists them', async () => {
      falCandidates = ['fal-ai/veo', 'fal-ai/flux', 'fal-ai/flux']
      const view = await mount()
      await waitFor(() => {
        expect(noteOf(viewOf(view, 'studio'))).toBe('Add a fal key for access to 2 more image, sound and video models.')
      })
    })

    it('asks for an OpenRouter key first when neither service is connected', async () => {
      servicesList = SERVICES.map(row => ({ ...row, connected: false }))
      const view = await mount()
      const row = viewOf(view, 'studio')
      expect(stateOf(row)).toBe('Needs a key')
      fireEvent.click(within(row).getByRole('button', { name: 'Add key' }))
      expect(within(row).getByLabelText('Your OpenRouter key')).toBeTruthy()
    })

    it('names fal alone, and asks for OpenRouter, when only fal is connected', async () => {
      servicesList = SERVICES.map(row => ({ ...row, connected: row.id === 'fal' }))
      const row = viewOf(await mount(), 'studio')
      expect(mainOf(row)).toBe('Image, video and sound models on fal')
      expect(stateOf(row)).toBe('No OpenRouter key')
      expect(noteOf(row)).toBe('Add an OpenRouter key for access to more image, sound and video models.')
    })
  })

  describe('Add another model', () => {
    it('gives each of the four rows a title and one sentence', async () => {
      const view = await mount()
      await waitFor(() => { expect(view.container.querySelector('[data-gateway]')).not.toBeNull() })
      const rows = [...view.container.querySelectorAll('[data-models-add-list] > [data-models-add], [data-models-add-list] > [data-gateway]')]
      expect(rows.map(row => [row.querySelector('strong')?.textContent, row.querySelector('small')?.textContent])).toEqual([
        ['Another subscription', 'Codex, Gemini or Kimi, for a second coding tool in the Terminal.'],
        ['A key from a model company', 'Pay Anthropic, OpenAI or another company directly for Chat, in place of OpenRouter.'],
        ['Free models', 'Chat at no cost, on the free models IDEalize finds for you.'],
        ['Your company\'s key gateway', 'Use models your organisation pays for, so nothing bills to you.'],
      ])
    })

    it('lists the command-line apps under Another subscription, with what to do about each', async () => {
      const view = await mount()
      add(view, 'subscription')
      const list = view.container.querySelector<HTMLElement>('[data-models-subscriptions]')!
      const lines = [...list.querySelectorAll('[data-coding-app]')].map(row => [row.querySelector('strong')?.textContent, row.querySelector('small')?.textContent])
      expect(lines).toEqual([
        ['Claude Code', 'Installed. Type claude in the Terminal to start it.'],
        ['Codex', 'Installed. Type codex in the Terminal to start it.'],
        ['Antigravity or Gemini CLI', 'Installed. Type gemini in the Terminal to start it.'],
        ['Kimi CLI', 'Not installed on this computer yet.'],
      ])
      // The app Coding already starts offers nothing; another installed one can take its place.
      expect(list.querySelector('[data-coding-app-use="claude-code"]')).toBeNull()
      fireEvent.click(list.querySelector('[data-coding-app-use="codex"]')!)
      await waitFor(() => { expect(mainOf(viewOf(view, 'coding'))).toBe('Codex, on your subscription') })
      expect(sent(posts('/idealize/terminal/launch')[0]!)).toEqual({ command: 'codex' })
    })

    it('opens the services and sign-ins under A key from a model company', async () => {
      const view = await mount()
      expect(view.container.querySelector('[data-models-keys]')).toBeNull()
      // A connected service makes the action Manage: its key is changed here too.
      expect(view.container.querySelector('[data-models-add-action="key"]')?.textContent).toBe('Manage')
      add(view, 'key')
      const list = view.container.querySelector<HTMLElement>('[data-models-keys]')!
      expect(list.querySelector('[data-service="openrouter"][data-service-connected]')).not.toBeNull()
      // fal is a good next step; the ChatGPT plan is signed in to on its own page.
      expect(list.querySelector('[data-service="fal"]')).not.toBeNull()
      const plan = list.querySelector<HTMLElement>('[data-provider="openai-codex"]')!
      expect(within(plan).getByText('ChatGPT plan')).toBeTruthy()
      expect(within(plan).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/idealize/signin')
      // Every other service waits behind the search.
      expect(list.querySelector('[data-service="acme"]')).toBeNull()
      fireEvent.click(list.querySelector('[data-services-add]')!)
      expect(list.querySelector('[data-service="acme"]')).not.toBeNull()
      fireEvent.change(list.querySelector('[data-services-search]')!, { target: { value: 'zzz' } })
      expect(list.querySelector('[data-service="acme"]')).toBeNull()
    })

    it('says Add while no service is connected', async () => {
      servicesList = SERVICES.map(row => ({ ...row, connected: false }))
      const view = await mount()
      expect(view.container.querySelector('[data-models-add-action="key"]')?.textContent).toBe('Add')
    })

    it('leads to the free models page, and makes the free route the default when it can answer', async () => {
      const view = await mount()
      const link = view.container.querySelector<HTMLAnchorElement>('[data-models-add-action="free"]')!
      expect(link.textContent).toBe('Turn on')
      expect(link.getAttribute('href')).toBe('/idealize/freetokens')
      fireEvent.click(link)
      await waitFor(() => { expect(view.container.querySelector('[data-models-add-action="free"]')?.textContent).toBe('Manage') })
      expect(sent(posts('/idealize/models/default')[0]!)).toEqual({ provider: 'freetokens', model: 'auto' })
      expect(noteOf(viewOf(view, 'chat'))).toBe('At no cost.')
      // Manage only opens the page: the default is already the free route.
      fireEvent.click(view.container.querySelector('[data-models-add-action="free"]')!)
      expect(posts('/idealize/models/default')).toHaveLength(1)
    })

    it('leaves the default alone while the free route holds no keys', async () => {
      statePayload = { ...STATE, providers: STATE.providers.map(row => row.auth === 'free' ? { ...row, connected: false } : row) }
      const view = await mount()
      fireEvent.click(view.container.querySelector('[data-models-add-action="free"]')!)
      expect(posts('/idealize/models/default')).toHaveLength(0)
    })

    it('carries the key gateway\'s own editor, set or not', async () => {
      const view = await mount()
      const row = await waitFor(() => {
        const found = view.container.querySelector<HTMLElement>('[data-gateway]')
        expect(found).not.toBeNull()
        return found!
      })
      fireEvent.click(row.querySelector('[data-gateway-open]')!)
      expect(within(row).getByLabelText('Gateway address')).toBeTruthy()
      cleanup()
      gatewayPayload = { configured: true, connected: true, services: ['Claude'] }
      const set = await mount()
      await waitFor(() => { expect(set.container.querySelector('[data-gateway][data-gateway-connected]')).not.toBeNull() })
    })
  })

  describe('Studio models you have approved', () => {
    it('lists each approved model with its service', async () => {
      const view = await mount()
      await waitFor(() => { expect(view.container.querySelectorAll('[data-approved]')).toHaveLength(2) })
      const rows = [...view.container.querySelectorAll('[data-approved]')]
      expect(rows.map(row => [row.querySelector('strong')?.textContent, row.querySelector('small')?.textContent])).toEqual([
        ['Veo 4', 'On fal.ai. Runs without asking and shows each price.'],
        ['Lyria 3', 'On OpenRouter. Runs without asking and shows each price.'],
      ])
      expect(view.container.querySelector('[data-models-approved-empty]')).toBeNull()
    })

    it('withdraws an approval with Ask again and drops the row', async () => {
      const view = await mount()
      await waitFor(() => { expect(view.container.querySelectorAll('[data-approved]')).toHaveLength(2) })
      fireEvent.click(view.container.querySelector('[data-approved-ask="fal/fal-ai/veo"]')!)
      await waitFor(() => { expect(view.container.querySelectorAll('[data-approved]')).toHaveLength(1) })
      const [call] = posts('/idealize/generate/approved')
      expect(sent(call!)).toEqual({ key: 'fal/fal-ai/veo', approved: false })
      expect((call!.init!.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
    })

    it('keeps the row and says so when the host refuses', async () => {
      approvedPostStatus = 500
      const view = await mount()
      await waitFor(() => { expect(view.container.querySelectorAll('[data-approved]')).toHaveLength(2) })
      fireEvent.click(view.container.querySelector('[data-approved-ask="fal/fal-ai/veo"]')!)
      await waitFor(() => { expect(view.getByRole('status').textContent).toBe('IDEalize could not change that approval.') })
      expect(view.container.querySelectorAll('[data-approved]')).toHaveLength(2)
    })

    it('says how approvals arrive when there are none, and reads a missing route as none', async () => {
      approvedPayload = []
      const empty = await mount()
      expect(empty.container.querySelector('[data-models-approved-empty]')?.textContent)
        .toBe('Studio asks before the first use of each paid model. Approved models appear here.')
      cleanup()
      approvedPayload = 404
      const missing = await mount()
      expect(missing.container.querySelector('[data-models-approved-empty]')).not.toBeNull()
      expect(missing.container.querySelector('[data-approved]')).toBeNull()
    })
  })

  describe('keys', () => {
    it('connects a service with a key and nothing else, and never asks for a web address', async () => {
      const view = await mount()
      openAllServices(view)
      const row = view.container.querySelector<HTMLElement>('[data-service="acme"]')!
      fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
      expect(view.container.querySelector('input[type="url"]')).toBeNull()
      fireEvent.change(within(row).getByLabelText('Your Acme Gateway key'), { target: { value: 'sk-acme' } })
      fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
      await waitFor(() => { expect(view.container.querySelector('[data-service="acme"][data-service-connected]')).not.toBeNull() })
      expect(sent(posts('/idealize/brains/services')[0]!)).toEqual({ id: 'acme', kind: 'chat', apiKey: 'sk-acme' })
      expect(view.getByRole('status').textContent).toBe('Connected. Its models are ready to use.')
    })

    it('shows why a Connect failed inside the form that was pressed', async () => {
      const view = await mount()
      openAllServices(view)
      const row = view.container.querySelector<HTMLElement>('[data-service="acme"]')!
      fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
      fireEvent.change(within(row).getByLabelText('Your Acme Gateway key'), { target: { value: 'refused-key' } })
      fireEvent.click(within(row).getByRole('button', { name: 'Connect' }))
      const alert = await within(row).findByRole('alert')
      expect(alert.textContent).toBe('The key is saved, but Acme Gateway could not be switched on. no models')
      expect(within(row).getByLabelText('Your Acme Gateway key')).toBeTruthy()
    })

    it('offers a key page only for a service whose page is known', async () => {
      const view = await mount()
      openAllServices(view)
      fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-models-keys] [data-service="fal"]')!).getByRole('button', { name: 'Connect' }))
      expect(view.container.querySelector('[data-service-key-link="fal"]')?.getAttribute('href')).toBe('https://fal.ai/dashboard/keys')
      fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-service="acme"]')!).getByRole('button', { name: 'Connect' }))
      expect(view.container.querySelector('[data-service-key-link="acme"]')).toBeNull()
    })

    it('checks a connected service once, and again when its badge is pressed', async () => {
      const view = await mount()
      add(view, 'key')
      const badge = await waitFor(() => {
        const found = view.container.querySelector<HTMLElement>('[data-service="openrouter"] [data-service-check="working"]')
        expect(found).not.toBeNull()
        return found!
      })
      expect(badge.textContent).toBe('Working')
      fireEvent.click(badge)
      const checked = (): unknown[] => posts('/idealize/brains/services/check').map(sent).filter(body => (body as { id: string }).id === 'openrouter')
      await waitFor(() => { expect(checked()).toEqual([{ id: 'openrouter', kind: 'chat' }, { id: 'openrouter', kind: 'chat' }]) })
    })

    it('opens the route\'s own key field when another surface asks for a key', async () => {
      const handled = vi.fn()
      const view = await mount({ request: { kind: 'add-key', provider: 'acme' }, onRequestHandled: handled })
      const row = await waitFor(() => {
        const found = view.container.querySelector<HTMLElement>('[data-service="acme"]')
        expect(found).not.toBeNull()
        return found!
      })
      expect(within(row).getByLabelText('Your Acme Gateway key')).toBeTruthy()
      expect(handled).toHaveBeenCalled()
    })

    it('opens the provider editor for a key request that names no route, or one the list cannot place', async () => {
      const bare = await mount({ request: { kind: 'add-key' } })
      expect(bare.getByTestId('provider-editor')).toBeTruthy()
      cleanup()
      const unknown = await mount({ request: { kind: 'add-key', provider: 'custom-route' } })
      await waitFor(() => { expect(unknown.getByTestId('provider-editor')).toBeTruthy() })
    })

    it('clears a request for a sheet the pane no longer has, and opens nothing', async () => {
      const handled = vi.fn()
      const view = await mount({ request: { kind: 'add-brain', space: 'chat' }, onRequestHandled: handled })
      expect(handled).toHaveBeenCalled()
      expect(view.queryByRole('dialog')).toBeNull()
      expect(view.queryByRole('form')).toBeNull()
    })

    it('keeps the web-address route reachable, and raises the change when its editor closes', async () => {
      const view = await mount()
      add(view, 'key')
      fireEvent.click(view.container.querySelector('[data-services-advanced]')!)
      expect(view.getByTestId('provider-editor')).toBeTruthy()
      let raised = 0
      const count = (): void => { raised += 1 }
      document.addEventListener(BRAINS_CHANGED_EVENT, count)
      fireEvent.click(view.getByRole('button', { name: 'Done' }))
      document.removeEventListener(BRAINS_CHANGED_EVENT, count)
      expect(view.queryByTestId('provider-editor')).toBeNull()
      expect(raised).toBe(1)
    })

    it('imports a keys file as it was read and names what it connected', async () => {
      const view = await mount()
      add(view, 'key')
      const text = JSON.stringify({ format: 1, credentials: { ACME_API_KEY: 'sk-acme', FAL_KEY: 'fal-key' } })
      const field = view.container.querySelector<HTMLInputElement>('[data-services-keys-file]')!
      fireEvent.change(field, { target: { files: [new File([text], 'team.idealizekeys', { type: 'application/json' })] } })
      await waitFor(() => { expect(view.getByRole('status').textContent).toBe('Connected Acme Gateway, fal.ai. Their models are ready to use.') })
      expect(posts('/idealize/brains/services/import')[0]!.init!.body).toBe(text)
      await waitFor(() => { expect(stateOf(viewOf(view, 'studio'))).toBe('Connected') })
    })

    it('shows the host\'s reason when a keys file is refused', async () => {
      const view = await mount()
      add(view, 'key')
      const text = JSON.stringify({ format: 1, credentials: { NOBODY_API_KEY: 'x' } })
      const field = view.container.querySelector<HTMLInputElement>('[data-services-keys-file]')!
      fireEvent.change(field, { target: { files: [new File([text], 'team.idealizekeys', { type: 'application/json' })] } })
      await waitFor(() => {
        expect(view.getByRole('status').textContent).toBe('NOBODY_API_KEY is not a credential any service this app can connect takes')
      })
    })
  })

  it('reads the router\'s recent decisions when the disclosure opens', async () => {
    const view = await mount()
    expect(calls.some(call => call.url.startsWith('/idealize/router/log'))).toBe(false)
    const details = view.container.querySelector<HTMLDetailsElement>('[data-router-how]')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    await waitFor(() => { expect(view.container.querySelector('[data-router-log-row="switched"]')).not.toBeNull() })
    expect(view.container.querySelector('[data-router-log-row]')?.textContent).toContain('gpt-6 → claude-sonnet-5')
  })
})

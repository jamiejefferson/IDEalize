// @vitest-environment jsdom
// The set-up step body over the real flow controller and the real route
// client (createOnboardingApi) on a mock fetch: three numbered parts from the
// host's payloads, the Gemini row choosing agy over gemini, Continue's gate,
// the key saves and the align call behind Continue, and "Skip keys for now".
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createOnboardingFlow } from '../src/client/flow.ts'
import { createOnboardingApi } from '../src/client/api.ts'
import { OnboardingOverlay } from '../src/client/OnboardingOverlay.tsx'
import type { OnboardingOverlayProps } from '../src/client/OnboardingOverlay.tsx'
import type { AgentsState } from '../src/client/api.ts'
import { en } from '../src/client/locales.ts'
import { codingRows, firstInstalled, launchChoiceOf } from '../src/client/setup-model.ts'
import type { OnboardingSeedLike } from '../src/client/steps.ts'

afterEach(cleanup)

const t = (key: string): string => en[key as keyof typeof en] ?? key

/** Flush pending route promises and their effects. */
const flush = async (): Promise<void> => { await act(async () => {}) }

interface RecordedCall {
  path: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

interface FetchTable {
  /** GET /idealize/onboarding/agents; reassignable so a save can change the re-poll. */
  agents: AgentsState
  /** GET /idealize/brains/services. */
  services?: unknown
  /** GET /idealize/terminal/launches; absent means the route does not exist (a plain browser). */
  terminalLaunches?: unknown
  /** GET /idealize/brains/gateway; reassignable so a connect can change the re-poll. */
  gateway?: unknown
  /** Per-path POST response (default 200 { ok: true }). */
  posts?: Record<string, { status: number; body: unknown }>
}

/** A fetch stand-in serving the wizard's routes from a table, recording calls. */
function mockFetch(table: FetchTable) {
  const calls: RecordedCall[] = []
  const gets: Record<string, () => unknown> = {
    '/idealize/onboarding/agents': () => table.agents,
    '/idealize/brains/services': () => table.services,
    '/idealize/terminal/launches': () => table.terminalLaunches,
    '/idealize/brains/gateway': () => table.gateway,
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
    finish: flow.finish,
    celebrationDone: flow.celebrationDone,
    prefersReducedMotion: () => false,
  } as unknown as OnboardingOverlayProps
  render(<OnboardingOverlay {...props} />)
  return { flow, writes, calls }
}

const continueButton = (): HTMLElement => screen.getByText(en['nav.continue'])
const skipKeys = (): HTMLElement => screen.getByText(en['skip.keys'])
const one = (selector: string): HTMLElement => {
  const found = document.querySelector(selector)
  if (found === null) throw new Error(`nothing matches ${selector}`)
  return found as HTMLElement
}
const text = (selector: string): string | undefined => document.querySelector(selector)?.textContent ?? undefined
const radio = (cli: string): HTMLInputElement => one(`[data-setup-cli="${cli}"] input`) as HTMLInputElement

const DISCONNECTED: AgentsState = { claudeCode: { installed: false }, openrouter: { connected: false }, fal: { connected: false } }

/** The Terminal's launch choices with chosen apps installed. */
function launches(installed: readonly string[]) {
  const catalog = [
    { id: 'claude-code', label: 'Claude Code', command: 'claude --dangerously-skip-permissions' },
    { id: 'codex', label: 'Codex CLI', command: 'codex' },
    { id: 'gemini', label: 'Gemini CLI', command: 'gemini' },
    { id: 'antigravity', label: 'Antigravity CLI', command: 'agy' },
    { id: 'kimi', label: 'Kimi CLI', command: 'kimi' },
    { id: 'pi', label: 'Pi', command: 'pi' },
    { id: 'shell', label: 'Plain shell', command: '' },
  ].map(entry => ({ ...entry, installed: entry.command === '' || installed.includes(entry.id) }))
  return { default: 'claude --dangerously-skip-permissions', byActivity: {}, catalog }
}

describe('the coding-subscription rows', () => {
  it('lists one row per company in the fixed order', () => {
    expect(codingRows(launches(['codex']).catalog)).toEqual([
      { company: 'claude', id: 'claude-code', installed: false },
      { company: 'chatgpt', id: 'codex', installed: true },
      { company: 'gemini', id: 'antigravity', installed: false },
      { company: 'kimi', id: 'kimi', installed: false },
    ])
  })

  it('uses agy for Gemini when it is installed, and gemini otherwise', () => {
    const gemini = (installed: readonly string[]) => codingRows(launches(installed).catalog).find(row => row.company === 'gemini')
    expect(gemini(['antigravity', 'gemini'])).toEqual({ company: 'gemini', id: 'antigravity', installed: true })
    expect(gemini(['antigravity'])).toEqual({ company: 'gemini', id: 'antigravity', installed: true })
    expect(gemini(['gemini'])).toEqual({ company: 'gemini', id: 'gemini', installed: true })
  })

  it('leaves out a company the catalogue lists no app for', () => {
    const catalog = launches(['codex']).catalog.filter(entry => entry.id === 'codex')
    expect(codingRows(catalog).map(row => row.company)).toEqual(['chatgpt'])
  })

  it('starts on the first installed row, or on none', () => {
    expect(firstInstalled(codingRows(launches(['kimi', 'gemini']).catalog))).toBe('gemini')
    expect(firstInstalled(codingRows(launches([]).catalog))).toBeNull()
  })

  it('finds the launch choice a command belongs to', () => {
    const { catalog } = launches([])
    expect(launchChoiceOf('codex', catalog)?.id).toBe('codex')
    expect(launchChoiceOf('claude --resume', catalog)?.id).toBe('claude-code')
    expect(launchChoiceOf('', catalog)?.id).toBe('shell')
    expect(launchChoiceOf('ccr code', catalog)).toBeUndefined()
    expect(launchChoiceOf('', catalog.filter(entry => entry.command !== ''))).toBeUndefined()
  })
})

describe('the set-up step body', () => {
  it('renders three numbered parts, each with its reason, under the new heading', async () => {
    mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['claude-code', 'gemini']) })
    await flush()
    expect(screen.getByText('Set up your models')).toBeDefined()
    expect([...document.querySelectorAll('[data-setup-part]')].map(part => part.getAttribute('data-setup-part')))
      .toEqual(['coding', 'openrouter', 'fal'])
    expect([...document.querySelectorAll('[data-setup-part] > span')].map(number => number.textContent)).toEqual(['1', '2', '3'])
    expect(screen.getByText('Your coding subscription')).toBeDefined()
    expect(text('[data-setup-reason="coding"]')).toBe(
      'For Coding, at no cost beyond the plan you already pay for. IDEalize opens the subscription\'s own app in a terminal and never sees your sign-in.',
    )
    expect(screen.getByText('OpenRouter key')).toBeDefined()
    expect(text('[data-setup-reason="openrouter"]')).toBe(
      'For Chat, and for the image, video and sound models Studio recommends. OpenRouter bills you for what you use, and IDEalize shows the price before anything paid runs.',
    )
    expect(screen.getByText('fal key')).toBeDefined()
    expect(text('[data-setup-block="fal"] [data-setup-optional]')).toBe('Optional')
    expect(one('[data-setup-get-key="openrouter"]').getAttribute('href')).toBe('https://openrouter.ai/keys')
    expect(one('[data-setup-get-key="fal"]').getAttribute('href')).toBe('https://fal.ai/dashboard/keys')
    expect(one('[data-setup-get-key="fal"]').getAttribute('target')).toBe('_blank')
    expect(text('[data-setup-foot-note]')).toBe('Keys stay on this Mac.')
  })

  it('lists Claude, ChatGPT and Gemini with their install state, and Kimi behind a link', async () => {
    mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['codex', 'gemini']) })
    await flush()
    const rows = [...document.querySelectorAll('[data-setup-cli]')]
    expect(rows.map(row => row.getAttribute('data-setup-cli'))).toEqual(['claude-code', 'codex', 'gemini'])
    expect(rows.map(row => row.textContent)).toEqual([
      'ClaudeClaude CodeNot installed',
      'ChatGPTCodexInstalled',
      'GeminiAntigravity or Gemini CLIInstalled',
    ])
    // The first installed app starts selected; an app that is not installed cannot be.
    expect(radio('codex').checked).toBe(true)
    expect(radio('claude-code').disabled).toBe(true)
    expect(document.body.textContent).not.toMatch(/signed in/i)

    fireEvent.click(screen.getByText('Show Kimi'))
    expect(text('[data-setup-cli="kimi"]')).toBe('KimiKimi CLINot installed')
    expect(document.querySelector('[data-setup-show-kimi]')).toBeNull()
  })

  it('gives the Gemini row agy when Antigravity is installed', async () => {
    mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['antigravity', 'gemini']) })
    await flush()
    expect(document.querySelector('[data-setup-cli="gemini"]')).toBeNull()
    expect(radio('antigravity').checked).toBe(true)
  })

  it('shows Kimi at once when it is the installed app', async () => {
    mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['kimi']) })
    await flush()
    expect(radio('kimi').checked).toBe(true)
    expect(document.querySelector('[data-setup-show-kimi]')).toBeNull()
  })

  it('says which company Chat will start on once a subscription is selected', async () => {
    mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['claude-code', 'codex', 'gemini', 'kimi']) })
    await flush()
    expect(text('[data-setup-match]')).toBe('Chat will start on Claude models, to match your subscription.')
    fireEvent.click(radio('codex'))
    expect(text('[data-setup-match]')).toBe('Chat will start on OpenAI models, to match your subscription.')
    fireEvent.click(radio('gemini'))
    expect(text('[data-setup-match]')).toBe('Chat will start on Gemini models, to match your subscription.')
    fireEvent.click(screen.getByText('Show Kimi'))
    fireEvent.click(radio('kimi'))
    expect(text('[data-setup-match]')).toBe('Chat will start on Kimi models, to match your subscription.')
  })

  it('shows a tick and Connected in place of a field whose key is connected', async () => {
    mount({}, {
      agents: { claudeCode: { installed: false }, openrouter: { connected: true }, fal: { connected: true } },
      terminalLaunches: launches([]),
    })
    await flush()
    expect(text('[data-setup-connected="openrouter"]')).toBe('✓Connected')
    expect(text('[data-setup-connected="fal"]')).toBe('✓Connected')
    expect(document.querySelector('[data-setup-openrouter]')).toBeNull()
    expect(document.querySelector('[data-setup-fal]')).toBeNull()
    expect(document.querySelector('[data-setup-match]')).toBeNull()
  })

  it('names the fal model count only when the services route states one', async () => {
    mount({}, { agents: DISCONNECTED, terminalLaunches: launches([]) })
    await flush()
    expect(text('[data-setup-reason="fal"]')).toBe('For access to more image, sound and video models in Studio.')
    cleanup()

    mount({}, {
      agents: DISCONNECTED,
      terminalLaunches: launches([]),
      services: { services: [{ id: 'fal', kind: 'media', connected: false, modelCount: 612 }] },
    })
    await flush()
    expect(text('[data-setup-reason="fal"]')).toBe('For access to 612 more image, sound and video models in Studio.')
    cleanup()

    mount({}, { agents: DISCONNECTED, terminalLaunches: launches([]), services: { services: [{ id: 'fal', kind: 'media', connected: false }] } })
    await flush()
    expect(text('[data-setup-reason="fal"]')).toBe('For access to more image, sound and video models in Studio.')
  })

  it('holds Continue until a coding app is selected, a key is connected or pasted, or a gateway is connected', async () => {
    const table: FetchTable = { agents: DISCONNECTED, terminalLaunches: launches([]) }
    mount({}, table)
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(true)
    // "Skip keys for now" is always open.
    expect(skipKeys().hasAttribute('disabled')).toBe(false)

    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: 'sk-or-new' } })
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: '  ' } })
    expect(continueButton().hasAttribute('disabled')).toBe(true)
    // A fal key alone unlocks nothing the step needs.
    fireEvent.change(one('[data-setup-fal]'), { target: { value: 'fal-1' } })
    expect(continueButton().hasAttribute('disabled')).toBe(true)
    cleanup()

    mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['codex']) })
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    cleanup()

    mount({}, { agents: { ...DISCONNECTED, openrouter: { connected: true } }, terminalLaunches: launches([]) })
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    cleanup()

    mount({}, { agents: DISCONNECTED, terminalLaunches: launches([]), gateway: { connected: true } })
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    expect(text('[data-setup-connected="gateway"]')).toBe('✓Use a company key gateway')
  })

  it('falls back to Claude Code\'s own detection where the host serves no Terminal', async () => {
    mount({}, { agents: { ...DISCONNECTED, claudeCode: { installed: true, path: '/usr/local/bin/claude' } } })
    await flush()
    expect([...document.querySelectorAll('[data-setup-cli]')].map(row => row.getAttribute('data-setup-cli'))).toEqual(['claude-code'])
    expect(radio('claude-code').checked).toBe(true)
  })

  it('keeps the key gateway behind a text link, and shows the gateway\'s refusal', async () => {
    const table: FetchTable = {
      agents: DISCONNECTED,
      terminalLaunches: launches([]),
      gateway: { configured: false, connected: false, services: [] },
      posts: { '/idealize/brains/gateway': { status: 401, body: { error: 'Key not recognised.' } } },
    }
    const { calls } = mount({}, table)
    await flush()
    expect(document.querySelector('[data-gateway-address]')).toBeNull()
    fireEvent.click(screen.getByText('Use a company key gateway'))
    fireEvent.change(one('[data-gateway-address]'), { target: { value: 'https://gateway.test' } })
    fireEvent.change(one('[data-gateway-key]'), { target: { value: 'gw-1' } })
    fireEvent.click(one('[data-gateway-connect]'))
    await flush()
    expect(text('[data-gateway-error]')).toBe('Key not recognised.')
    expect(continueButton().hasAttribute('disabled')).toBe(true)

    table.posts = { '/idealize/brains/gateway': { status: 200, body: { configured: true, connected: true, services: [] } } }
    table.gateway = { configured: true, connected: true, services: [] }
    fireEvent.click(one('[data-gateway-connect]'))
    await flush()
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    const sent = calls.filter(call => call.method === 'POST' && call.path === '/idealize/brains/gateway')
    expect(sent.map(call => call.body)).toEqual([{ address: 'https://gateway.test', key: 'gw-1' }, { address: 'https://gateway.test', key: 'gw-1' }])
    expect(sent[0]?.headers['x-idealize-auth']).toBe('1')
  })

  it('Continue saves the pasted keys, then aligns the selected app, then completes the step', async () => {
    const { calls, writes } = mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['codex']) })
    await flush()
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: ' sk-or-good ' } })
    fireEvent.change(one('[data-setup-fal]'), { target: { value: 'fal-good' } })
    fireEvent.click(continueButton())
    await flush()
    await flush()

    const posts = calls.filter(call => call.method === 'POST')
    expect(posts.map(call => [call.path, call.body])).toEqual([
      ['/idealize/onboarding/openrouter', { apiKey: 'sk-or-good' }],
      ['/idealize/brains/services', { id: 'fal', kind: 'media', apiKey: 'fal-good' }],
      ['/idealize/onboarding/align', { cli: 'codex' }],
    ])
    expect(posts.every(call => call.headers['x-idealize-auth'] === '1')).toBe(true)
    expect(writes.steps).toEqual({ agents: 'done' })
  })

  it('shows a refused key under its field and keeps the step', async () => {
    const table: FetchTable = {
      agents: DISCONNECTED,
      terminalLaunches: launches(['codex']),
      posts: { '/idealize/onboarding/openrouter': { status: 400, body: { ok: false, error: 'OpenRouter rejected that key. Check it and try again.' } } },
    }
    const { calls, writes } = mount({}, table)
    await flush()
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: 'sk-or-bad' } })
    fireEvent.click(continueButton())
    await flush()
    await flush()
    expect(text('[data-setup-error="openrouter"]')).toContain('rejected')
    expect(writes.steps).toBeUndefined()
    expect(calls.some(call => call.path === '/idealize/onboarding/align')).toBe(false)

    // The fal refusal shows the same way, after the OpenRouter key has gone through.
    table.posts = { '/idealize/brains/services': { status: 400, body: { error: 'fal.ai refused this key.' } } }
    fireEvent.change(one('[data-setup-fal]'), { target: { value: 'fal-bad' } })
    fireEvent.click(continueButton())
    await flush()
    await flush()
    expect(text('[data-setup-error="fal"]')).toBe('fal.ai refused this key.')
    expect(text('[data-setup-connected="openrouter"]')).toBe('✓Connected')
    expect(writes.steps).toBeUndefined()
  })

  it('shows a refused align in place and keeps the step', async () => {
    const { writes } = mount({}, {
      agents: DISCONNECTED,
      terminalLaunches: launches(['codex']),
      posts: { '/idealize/onboarding/align': { status: 400, body: { error: 'cli must name one of the launch choices the Terminal offers' } } },
    })
    await flush()
    fireEvent.click(continueButton())
    await flush()
    await flush()
    expect(text('[data-setup-error="coding"]')).toContain('launch choices')
    expect(writes.steps).toBeUndefined()
  })

  it('Skip keys for now saves no key, still aligns the selected app, and records the skip', async () => {
    const { calls, writes } = mount({}, { agents: DISCONNECTED, terminalLaunches: launches(['claude-code']) })
    await flush()
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: 'sk-or-typed' } })
    fireEvent.click(skipKeys())
    await flush()
    await flush()
    expect(calls.filter(call => call.method === 'POST').map(call => [call.path, call.body])).toEqual([
      ['/idealize/onboarding/align', { cli: 'claude-code' }],
    ])
    expect(writes.steps).toEqual({ agents: 'skipped' })
    expect(document.querySelector('[data-rainbow-burst]')).toBeNull()
  })

  it('Skip keys for now calls nothing when no app is selected', async () => {
    const { calls, writes } = mount({}, { agents: DISCONNECTED, terminalLaunches: launches([]) })
    await flush()
    fireEvent.click(skipKeys())
    await flush()
    await flush()
    expect(calls.filter(call => call.method === 'POST')).toEqual([])
    expect(writes.steps).toEqual({ agents: 'skipped' })
  })
})

describe('the set-up copy', () => {
  it('uses the word brain in the welcome sub-line alone, and no exclamation marks', () => {
    for (const [key, value] of Object.entries(en)) {
      if (key !== 'simpler.sub') expect(value, key).not.toMatch(/brain/i)
      expect(value, key).not.toContain('!')
      expect(value, key).not.toMatch(/keychain/i)
    }
  })
})

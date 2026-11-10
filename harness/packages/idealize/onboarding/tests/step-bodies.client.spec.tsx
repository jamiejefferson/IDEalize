// @vitest-environment jsdom
// The agents step body over the real flow controller and the real
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
import type { AgentsState } from '../src/client/api.ts'
import { en } from '../src/client/locales.ts'
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
  /** GET /idealize/models/state. */
  modelsState?: unknown
  /** GET /idealize/activity/agents. */
  activityAgents?: unknown
  /** GET /idealize/brains/media. */
  brainsMedia?: unknown
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
    '/idealize/models/state': () => table.modelsState,
    '/idealize/activity/agents': () => table.activityAgents,
    '/idealize/brains/media': () => table.brainsMedia,
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

  it('lets a key gateway alone unlock Continue, and shows the gateway\'s refusal', async () => {
    const table: FetchTable = {
      agents: DISCONNECTED,
      gateway: { configured: false, connected: false, services: [] },
      posts: { '/idealize/brains/gateway': { status: 401, body: { error: 'Key not recognised.' } } },
    }
    const { calls } = mount({}, table)
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(true)
    fireEvent.change(document.querySelector('[data-gateway-address]') as Element, { target: { value: 'https://gateway.test' } })
    fireEvent.change(document.querySelector('[data-gateway-key]') as Element, { target: { value: 'gw-1' } })
    fireEvent.click(document.querySelector('[data-gateway-connect]') as Element)
    await flush()
    expect(document.querySelector('[data-gateway-error]')?.textContent).toBe('Key not recognised.')
    expect(continueButton().hasAttribute('disabled')).toBe(true)

    table.posts = { '/idealize/brains/gateway': { status: 200, body: { configured: true, connected: true, services: [] } } }
    table.gateway = { configured: true, connected: true, services: [] }
    fireEvent.click(document.querySelector('[data-gateway-connect]') as Element)
    await flush()
    await flush()
    expect(continueButton().hasAttribute('disabled')).toBe(false)
    const sent = calls.filter(call => call.method === 'POST' && call.path === '/idealize/brains/gateway')
    expect(sent.map(call => call.body)).toEqual([{ address: 'https://gateway.test', key: 'gw-1' }, { address: 'https://gateway.test', key: 'gw-1' }])
    expect(sent[0]?.headers['x-idealize-auth']).toBe('1')
  })

  it('says that OpenRouter reads each message, and that a local model skips it', async () => {
    mount({}, { agents: DISCONNECTED })
    await flush()
    const said = document.querySelector('[data-agent-reads]')?.textContent
    expect(said).toBe('OpenRouter reads each message to choose a model. Chats on a model running on your computer skip this.')
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
    fireEvent.click((document.querySelector('[data-agent-connect]') as HTMLElement))
    await flush()
    expect(document.querySelector('[data-agent-error]')?.textContent).toContain('rejected')
    expect(continueButton().hasAttribute('disabled')).toBe(true)
  })

  it('posts the key with the auth header and connects the card on success', async () => {
    const table: FetchTable = { agents: DISCONNECTED }
    const { calls } = mount({}, table)
    await flush()

    fireEvent.change(document.querySelector('[data-agent-key]')!, { target: { value: 'sk-or-good' } })
    fireEvent.click((document.querySelector('[data-agent-connect]') as HTMLElement))
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

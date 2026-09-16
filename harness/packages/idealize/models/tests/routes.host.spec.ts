// Composition coverage for the usage and prices routes over a real settings
// document and web server: a connected OpenRouter route prices itself from the
// (stubbed) directory and caches the list under the harness home, a route with
// no key or a non-USD currency prices nothing automatically, the generations
// half reports what fal billed once fal's key is stored, and the prices route
// stores, clears and refuses through the validated body.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as models from '../src/index.ts'
import { FAL_USAGE_URL } from '../src/generations.ts'
import { OPENROUTER_MODELS_URL } from '../src/prices.ts'
import type { GenerationRow } from '../src/generations.ts'
import type { ModelsConfig } from '../src/index.ts'

const LLM_NS = settingsNamespace('llm-pi-ai')
const NS = settingsNamespace('idealize-models')
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** A slice of OpenRouter's directory: two priced models, one without a completion price. */
const DIRECTORY = {
  data: [
    { id: 'anthropic/claude-sonnet-4.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'openai/gpt-oss-120b', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
    { id: 'broken/no-completion', pricing: { prompt: '0.000001' } },
  ],
}

/** One page of fal's usage report, shaped as its `time_series` schema publishes it. */
const FAL_USAGE = {
  time_series: [
    {
      bucket: `${String(new Date().getUTCFullYear())}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00+00:00`,
      results: [
        {
          endpoint_id: 'fal-ai/flux/dev',
          unit: 'image',
          quantity: 4,
          unit_price: 0.1,
          percent_discount: 20,
          cost_subtotal: 0.4,
          cost_discount: 0.08,
          cost_total: 0.32,
          cost: 0.32,
          currency: 'USD',
        },
      ],
    },
  ],
  next_cursor: null,
  has_more: false,
}

let root: string | undefined
let context: Context | undefined
let previousHome: string | undefined
const realFetch = globalThis.fetch

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot the real composition over a scratch home that is also the harness home.
 * `mediaBackends` stands in for the generation runtime `@idealize/services`
 * registers its media services with; null composes no generation service at all.
 */
async function boot(config: ModelsConfig = {}, mediaBackends: { backend: string; env: string }[] | null = [{ backend: 'fal', env: 'FAL_KEY' }]) {
  root = await mkdtemp(join(tmpdir(), 'idealize-models-routes-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const stored = new Map<string, string>()
  /** Every call the OpenRouter directory received. */
  const directoryCalls: string[] = []
  /** Every call fal's usage report received. */
  const usageCalls: string[] = []
  // Only the OpenRouter directory and fal's usage report are stubbed; the
  // routes under test are reached over the real web server through the real fetch.
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === OPENROUTER_MODELS_URL) {
      directoryCalls.push(url)
      return Promise.resolve(new Response(JSON.stringify(DIRECTORY), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    if (url.startsWith(FAL_USAGE_URL)) {
      usageCalls.push(url)
      if (stored.get('FAL_KEY') === 'refused') {
        return Promise.resolve(new Response(JSON.stringify({ error: { type: 'authorization_error', message: 'Access denied' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify(FAL_USAGE), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    return realFetch(input, init)
  })

  const ctx = new Context()
  context = ctx
  await ctx.plugin(FileSettingsProvider, { path: join(root, 'settings.yaml'), watch: false })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  ctx.provide('credentials', {
    resolve: (ref: string) => {
      if (ref === 'BROKEN_KEY') return Promise.reject(new Error('credential store unavailable'))
      const value = stored.get(ref)
      return Promise.resolve(value === undefined ? undefined : { value, source: 'test' })
    },
  } as never)
  ctx.provide('llm', {
    listConfigurableProviders: () => [
      { provider: 'openrouter', displayName: 'openrouter', settingsNs: LLM_NS, settingsPath: ['providers', 'openrouter'], declared: false },
    ],
    listModels: () => Promise.resolve([{ provider: 'openrouter', id: 'anthropic/claude-sonnet-4.5', name: 'Claude', inputModalities: ['text'] }]),
  } as never)
  // A project and a signed-in subscription, so the payload's project list and
  // subscription classification run over something.
  ctx.provide('workspaceRegistry', { list: () => [{ path: '/p/alpha', sessionIds: [] }] } as never)
  ctx.provide('idealizeOAuth', { status: () => Promise.resolve([{ id: 'openai-codex', stored: true }]) } as never)
  if (mediaBackends !== null) ctx.provide('generation', { credentials: () => mediaBackends } as never)
  // The section the route reads the OpenRouter profile from (llm-pi-ai owns the real one).
  ctx.settings.register(LLM_NS, z.object({ providers: z.dict(z.any()).default({}) }))
  await ctx.plugin(models, config)

  const deadline = Date.now() + 5_000
  while (ctx.settings.get(NS) === undefined) {
    if (Date.now() > deadline) throw new Error('idealize-models settings section never registered')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return { ctx, stored, directoryCalls, usageCalls, origin: `http://127.0.0.1:${String(ctx.webServer.port)}` }
}

interface UsagePayload {
  projects: { path: string; label: string }[]
  cost: { configured: boolean; unpricedSubscriptions: string[] }
  models: unknown[]
  openRouterPrices: { fetchedAt: string; models: number } | null
  generations: { rows: GenerationRow[]; billed?: { month: Record<string, number>; year: Record<string, number> }; currency: string | null }
  falUsage: { fetchedAt: string | null; error?: string } | null
}

describe('the /idealize/models usage route and OpenRouter prices', () => {
  it('prices a connected OpenRouter route from the directory, caches the list under the home, and skips a route without a key', async () => {
    const { ctx, stored, directoryCalls, origin } = await boot()
    const usage = async (): Promise<UsagePayload> => await (await fetch(`${origin}/idealize/models/usage`)).json() as UsagePayload

    // No OpenRouter profile at all: nothing to price with, nothing fetched.
    const bare = await usage()
    expect(bare.openRouterPrices).toBeNull()
    expect(bare.projects).toEqual([{ path: '/p/alpha', label: 'alpha' }])
    expect(bare.cost.unpricedSubscriptions).toEqual(['openai-codex'])
    // A profile whose key is not stored: still nothing.
    await ctx.settings.update(LLM_NS, { providers: { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } } })
    expect((await usage()).openRouterPrices).toBeNull()
    expect(directoryCalls).toHaveLength(0)

    stored.set('OPENROUTER_API_KEY', 'sk-or-test')
    const priced = await usage()
    expect(directoryCalls).toHaveLength(1)
    expect(priced.openRouterPrices?.models).toBe(2)
    expect(priced.cost.configured).toBe(true)
    const cache = JSON.parse(await readFile(join(root!, 'service-catalogues', 'openrouter-prices.json'), 'utf8')) as {
      fetchedAt: string
      prices: Record<string, { input: number; output: number }>
    }
    expect(cache.fetchedAt).toBe(priced.openRouterPrices?.fetchedAt)
    expect(cache.prices['anthropic/claude-sonnet-4.5']).toMatchObject({ input: 3, output: 15 })

    // A fresh cache answers the next request without a second fetch.
    expect((await usage()).openRouterPrices?.models).toBe(2)
    expect(directoryCalls).toHaveLength(1)

    // Another currency leaves the USD list unused, whatever the cache holds.
    await ctx.settings.update(NS, { currency: 'GBP' })
    expect((await usage()).openRouterPrices).toBeNull()
  }, 30_000)

  it('treats a credential store that fails to answer as no key', async () => {
    const { ctx, directoryCalls, origin } = await boot()
    await ctx.settings.update(LLM_NS, { providers: { openrouter: { apiKeyEnv: 'BROKEN_KEY' } } })
    const payload = await (await fetch(`${origin}/idealize/models/usage`)).json() as UsagePayload
    expect(payload.openRouterPrices).toBeNull()
    expect(directoryCalls).toHaveLength(0)
  }, 30_000)
})

describe('the /idealize/models usage route and generations', () => {
  it('lists what fal billed once its key is stored, and caches the report under the home', async () => {
    const { ctx, stored, usageCalls, origin } = await boot()
    const usage = async (): Promise<UsagePayload> => await (await fetch(`${origin}/idealize/models/usage`)).json() as UsagePayload

    // No stored fal key: nothing is fetched and the pane is told fal is not connected.
    const bare = await usage()
    expect(bare.falUsage).toBeNull()
    expect(bare.generations).toEqual({ rows: [], billed: undefined, currency: null })
    expect(usageCalls).toHaveLength(0)

    stored.set('FAL_KEY', 'fal-test')
    const billed = await usage()
    expect(usageCalls).toHaveLength(1)
    expect(new URL(usageCalls[0]!).searchParams.get('timeframe')).toBe('month')
    expect(billed.falUsage?.error).toBeUndefined()
    expect(typeof billed.falUsage?.fetchedAt).toBe('string')
    // Nothing was generated in this composition, so the only row is fal's own line.
    expect(billed.generations.rows).toEqual([
      { provider: 'fal', model: 'fal-ai/flux/dev', count: 0, billed: { quantity: 4, unit: 'image', cost: 0.32, currency: 'USD' } },
    ])
    expect(billed.generations.billed?.month).toEqual({ USD: 0.32 })
    expect(billed.generations.currency).toBe('USD')
    const cache = JSON.parse(await readFile(join(root!, 'service-catalogues', 'fal-usage.json'), 'utf8')) as { fetchedAt: string }
    expect(cache.fetchedAt).toBe(billed.falUsage?.fetchedAt)

    // A fresh cache answers the next request without a second read.
    expect((await usage()).generations.rows).toHaveLength(1)
    expect(usageCalls).toHaveLength(1)

    // Never fetching leaves the cached report standing.
    await ctx.settings.update(NS, { falUsageRefreshMinutes: 0 })
    expect((await usage()).generations.rows).toHaveLength(1)
    expect(usageCalls).toHaveLength(1)
  }, 30_000)

  it('says nothing about fal without a generation runtime, whatever key is stored', async () => {
    const { stored, origin, usageCalls } = await boot({}, null)
    stored.set('FAL_KEY', 'fal-test')
    expect(((await (await fetch(`${origin}/idealize/models/usage`)).json()) as UsagePayload).falUsage).toBeNull()
    expect(usageCalls).toHaveLength(0)
  }, 30_000)

  it('says nothing about fal while the runtime names no fal backend', async () => {
    const { stored, origin, usageCalls } = await boot({}, [{ backend: 'mediahub', env: 'MEDIAHUB_API_KEY' }])
    stored.set('FAL_KEY', 'fal-test')
    expect(((await (await fetch(`${origin}/idealize/models/usage`)).json()) as UsagePayload).falUsage).toBeNull()
    expect(usageCalls).toHaveLength(0)
  }, 30_000)

  it('passes fal’s own refusal through to the pane', async () => {
    const { stored, origin } = await boot()
    stored.set('FAL_KEY', 'refused')
    const payload = await (await fetch(`${origin}/idealize/models/usage`)).json() as UsagePayload
    expect(payload.falUsage).toEqual({ fetchedAt: null, error: 'fal.ai answered 403: Access denied' })
    expect(payload.generations.rows).toEqual([])
  }, 30_000)

  it('prices a catalogue route from the shipped model catalogue, in the currency the catalogue publishes', async () => {
    const { ctx, origin } = await boot()
    const usage = async (): Promise<UsagePayload> => await (await fetch(`${origin}/idealize/models/usage`)).json() as UsagePayload
    // No profile: no catalogue route to price, so nothing is configured.
    expect((await usage()).cost.configured).toBe(false)
    // A profile for a catalogue route prices it with no key and no directory read.
    await ctx.settings.update(LLM_NS, { providers: { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } } })
    expect((await usage()).cost.configured).toBe(true)
    // Another currency leaves the catalogue out rather than converting a figure.
    await ctx.settings.update(NS, { currency: 'GBP' })
    expect((await usage()).cost.configured).toBe(false)
  }, 30_000)
})

describe('the /idealize/models/prices route', () => {
  it('stores a validated price, clears it on null, and refuses an incomplete body or a missing auth header', async () => {
    const { ctx, origin } = await boot()
    const post = (body: unknown, headers: Record<string, string> = HEADERS): Promise<Response> =>
      fetch(`${origin}/idealize/models/prices`, { method: 'POST', headers, body: JSON.stringify(body) })
    const prices = (): Record<string, Record<string, unknown>> | undefined =>
      (ctx.settings.get(NS) as ModelsConfig | undefined)?.tokenPrices

    const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    const saved = await post({ provider: 'anthropic', model: 'claude', price })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ ok: true, provider: 'anthropic', model: 'claude', price })
    expect(prices()).toEqual({ anthropic: { claude: price } })

    // A second model merges beside the first rather than replacing it.
    expect((await post({ provider: 'anthropic', model: 'haiku', price })).status).toBe(200)
    expect(Object.keys(prices()?.anthropic ?? {}).sort()).toEqual(['claude', 'haiku'])

    const cleared = await post({ provider: 'anthropic', model: 'claude', price: null })
    expect(cleared.status).toBe(200)
    expect(prices()).toEqual({ anthropic: { haiku: price } })

    // A missing kind is refused, never stored as free.
    const refused = await post({ provider: 'anthropic', model: 'haiku', price: { input: 1, output: 2 } })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toContain('cacheRead')
    expect(prices()).toEqual({ anthropic: { haiku: price } })

    expect((await post({ provider: 'anthropic', model: 'haiku', price: null }, { 'content-type': 'application/json' })).status).toBe(403)
  }, 30_000)
})

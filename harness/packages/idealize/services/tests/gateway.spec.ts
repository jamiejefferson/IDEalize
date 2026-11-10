/**
 * The key gateway: one organisation key reaching every model service, read
 * from the gateway's own `/v1/me`, with no gateway named in the app.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chatRoutesFor, gatewayAddress, gatewayDecisionsUrl, GATEWAY_STATE_FILE, installGateway, mediaRowsFor, readMe, statusOf,
} from '../src/gateway.ts'
import type { GatewayMe } from '../src/gateway.ts'

const ADDRESS = 'https://gateway.test'
const ME: GatewayMe = {
  key: { id: 'k1', name: 'JJ', kind: 'person', last4: 'ab12' },
  preset: 'Designer',
  budget_gbp: 50,
  spent_this_month_gbp: 3.5,
  services: [
    { id: 'anthropic', label: 'Claude', base_url: `${ADDRESS}/anthropic` },
    { id: 'openrouter', label: 'OpenRouter', base_url: `${ADDRESS}/openrouter/v1` },
    { id: 'fal', label: 'fal', base_url: `${ADDRESS}/fal` },
    { id: 'canon', label: 'Canon', base_url: `${ADDRESS}/agents/canon/v1` },
  ],
}

/** A copy of a record without one key. */
const withoutKey = (record: Record<string, unknown>, key: string | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the gateway address', () => {
  it('takes https, or http on this computer, and trims the trailing slash', () => {
    expect(gatewayAddress('https://gateway.test/')).toEqual({ address: 'https://gateway.test' })
    expect(gatewayAddress('http://127.0.0.1:8787')).toEqual({ address: 'http://127.0.0.1:8787' })
    expect(gatewayAddress('http://gateway.test')).toEqual({ error: 'The gateway address must start with https.' })
    expect(gatewayAddress('gateway')).toEqual({ error: 'That is not a web address.' })
  })
})

describe('reading the gateway', () => {
  it('sends the key as a bearer token and returns the answer', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json(200, ME)))
    expect(await readMe(ADDRESS, 'kb-x', fetchImpl as never)).toEqual({ ok: true, me: ME })
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(`${ADDRESS}/v1/me`)
    expect(init.headers).toMatchObject({ authorization: 'Bearer kb-x' })
  })

  it('passes on the gateway\'s own words when it refuses, and says so when nothing answers', async () => {
    const refused = vi.fn(() => Promise.resolve(json(401, { error: { message: 'Key revoked.' } })))
    expect(await readMe(ADDRESS, 'kb-x', refused as never)).toEqual({ ok: false, status: 401, error: 'Key revoked.' })
    const down = vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    expect(await readMe(ADDRESS, 'kb-x', down as never)).toEqual({ ok: false, status: 0, error: 'The gateway did not answer.' })
  })
})

describe('routes from the gateway\'s answer', () => {
  it('adds a chat route per provider, serving the installed catalog at the gateway', () => {
    expect(chatRoutesFor(ADDRESS, ME)).toEqual({
      'gateway-anthropic': { displayName: 'Anthropic via gateway', catalog: 'anthropic', baseURL: `${ADDRESS}/anthropic`, apiKeyEnv: 'GATEWAY_API_KEY' },
      'gateway-openrouter': { displayName: 'OpenRouter via gateway', catalog: 'openrouter', baseURL: `${ADDRESS}/openrouter/v1`, apiKeyEnv: 'GATEWAY_API_KEY' },
    })
  })

  it('adds fal and OpenRouter media, with no price read that would send the key past the gateway', () => {
    const rows = mediaRowsFor(ADDRESS, ME)
    expect(rows.map(row => row.id)).toEqual(['gateway-fal', 'gateway-openrouter'])
    expect(rows[0]).toMatchObject({ queueUrl: `${ADDRESS}/fal/queue`, apiKeyEnv: 'GATEWAY_API_KEY', auth: { prefix: 'Key ' } })
    expect(rows[0]?.pricingUrl).toBeUndefined()
    expect(rows[1]).toMatchObject({ adapter: 'images', baseUrl: `${ADDRESS}/openrouter/v1`, catalogUrl: 'https://openrouter.ai/api/v1' })
  })

  it('falls back to <address>/<id> when the gateway gives no base_url, and adds nothing it does not list', () => {
    const bare: GatewayMe = { services: [{ id: 'openrouter' }] }
    expect(chatRoutesFor(ADDRESS, bare)).toEqual({
      'gateway-openrouter': expect.objectContaining({ baseURL: `${ADDRESS}/openrouter/v1` }) as unknown,
    })
    expect(mediaRowsFor(ADDRESS, { services: [] })).toEqual([])
    expect(gatewayDecisionsUrl(ADDRESS, ME)).toBe(`${ADDRESS}/openrouter/alpha/decisions`)
    expect(gatewayDecisionsUrl(ADDRESS, { services: [] })).toBeUndefined()
  })

  it('reports the key, the preset and the spend, never the key itself', () => {
    const status = statusOf(ADDRESS, ME, { connected: true })
    expect(status).toMatchObject({ configured: true, connected: true, preset: 'Designer', budgetGbp: 50, spentGbp: 3.5, last4: 'ab12' })
    expect(status.services).toEqual(['Claude', 'OpenRouter', 'fal', 'Canon'])
    expect(status.used).toEqual(['anthropic', 'openrouter', 'fal'])
    expect(JSON.stringify(status)).not.toContain('kb-')
  })
})

class FakeRequest extends EventEmitter {
  headers: Record<string, string>
  constructor(public method: string, private readonly body = '') {
    super()
    this.headers = { host: '127.0.0.1:3000', 'x-idealize-auth': '1' }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  body = ''
  writeHead(status: number) {
    this.status = status
    return this
  }

  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
  json(): Record<string, unknown> { return JSON.parse(this.body) as Record<string, unknown> }
}

describe('the gateway in the app', () => {
  const contexts: Context[] = []
  const homes: string[] = []
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.fiber.dispose()
    for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
  })

  async function mount(answer: () => Response, stored: Record<string, string> = {}) {
    const home = await mkdtemp(join(tmpdir(), 'idealize-gateway-'))
    homes.push(home)
    const ctx = new Context()
    contexts.push(ctx)
    const credentials = new Map(Object.entries(stored))
    const settings: { providers: Record<string, unknown> } = { providers: { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } } }
    const backends = new Set<string>()
    let handler: ((req: FakeRequest, res: FakeResponse) => Promise<void>) | undefined
    const reconsider = vi.fn(() => Promise.resolve())
    ctx.provide('credentials', {
      resolve: (ref: string) => Promise.resolve(credentials.has(ref) ? { value: credentials.get(ref) } : undefined),
      set: (ref: string, value: string) => { credentials.set(ref, value); return Promise.resolve() },
      unset: (ref: string) => { credentials.delete(ref); return Promise.resolve() },
    } as never)
    ctx.provide('settings', {
      get: () => settings,
      update: (_ns: unknown, patch: { providers?: Record<string, unknown> }) => {
        Object.assign(settings.providers, patch.providers)
        return Promise.resolve()
      },
      mutate: (_ns: unknown, ops: Array<{ op: string; path: string[] }>) => {
        for (const op of ops) if (op.op === 'unset') settings.providers = withoutKey(settings.providers, op.path[1])
        return Promise.resolve()
      },
    } as never)
    ctx.provide('generation', {
      register: (backend: { id: string }) => { backends.add(backend.id); return () => { backends.delete(backend.id) } },
    } as never)
    ctx.provide('webServer', { register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } } as never)
    ctx.provide('idealizeDefaultModel', { reconsider } as never)
    const fetchImpl = vi.fn((url: string) => {
      if (url.endsWith('/v1/me')) return Promise.resolve(answer())
      // Catalogue reads of the media rows: an empty page.
      return Promise.resolve(json(200, { models: [], has_more: false }))
    })
    const registrar = { home, timeoutMs: 1000, pollIntervalMs: 10, refreshMinutes: 0 }
    const face = installGateway(ctx, { home, registrar, fetchImpl: fetchImpl as never })
    await new Promise(resolve => setTimeout(resolve, 20))
    const call = async (method: string, body?: unknown) => {
      const res = new FakeResponse()
      await handler?.(new FakeRequest(method, body === undefined ? '' : JSON.stringify(body)), res)
      return res
    }
    return { face, call, credentials, settings, backends, reconsider, home }
  }

  it('checks the key with the gateway, stores it, adds every route and moves a stranded default', async () => {
    const app = await mount(() => json(200, ME))
    const res = await app.call('POST', { address: `${ADDRESS}/`, key: 'kb-secret' })
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ connected: true, preset: 'Designer' })
    expect(res.body).not.toContain('kb-secret')
    expect(app.credentials.get('GATEWAY_URL')).toBe(ADDRESS)
    expect(app.credentials.get('GATEWAY_API_KEY')).toBe('kb-secret')
    expect(Object.keys(app.settings.providers).sort()).toEqual(['gateway-anthropic', 'gateway-openrouter', 'openrouter'])
    expect([...app.backends].sort()).toEqual(['gateway-fal', 'gateway-openrouter'])
    expect(app.reconsider).toHaveBeenCalled()
    expect(await app.face.decisions()).toEqual({ url: `${ADDRESS}/openrouter/alpha/decisions`, key: 'kb-secret' })
    const saved = await readFile(join(app.home, GATEWAY_STATE_FILE), 'utf8')
    expect(saved).not.toContain('kb-secret')
  })

  it('stores nothing when the gateway refuses the key, and shows its words', async () => {
    const app = await mount(() => json(401, { error: { message: 'Key revoked.' } }))
    const res = await app.call('POST', { address: ADDRESS, key: 'kb-old' })
    expect(res.status).toBe(401)
    expect(res.json()).toEqual({ error: 'Key revoked.' })
    expect(app.credentials.size).toBe(0)
    expect(Object.keys(app.settings.providers)).toEqual(['openrouter'])
  })

  it('removes the key, the address and every gateway route, and leaves the person\'s own routes', async () => {
    const app = await mount(() => json(200, ME))
    await app.call('POST', { address: ADDRESS, key: 'kb-secret' })
    const res = await app.call('DELETE')
    expect(res.json()).toMatchObject({ configured: false, connected: false })
    expect(app.credentials.size).toBe(0)
    expect(Object.keys(app.settings.providers)).toEqual(['openrouter'])
    expect(app.backends.size).toBe(0)
  })

  it('starts with the routes it last had when the gateway does not answer', async () => {
    const first = await mount(() => json(200, ME))
    await first.call('POST', { address: ADDRESS, key: 'kb-secret' })
    // A second start on the same home, with the gateway down.
    const ctx = new Context()
    contexts.push(ctx)
    let providers: Record<string, unknown> = {}
    ctx.provide('credentials', { resolve: (ref: string) => Promise.resolve({ value: ref === 'GATEWAY_URL' ? ADDRESS : 'kb-secret' }) } as never)
    ctx.provide('settings', {
      get: () => ({ providers }),
      update: (_ns: unknown, patch: { providers?: Record<string, unknown> }) => {
        Object.assign(providers, patch.providers)
        return Promise.resolve()
      },
      mutate: (_ns: unknown, ops: Array<{ path: string[] }>) => {
        for (const op of ops) providers = withoutKey(providers, op.path[1])
        return Promise.resolve()
      },
    } as never)
    ctx.provide('generation', { register: () => () => {} } as never)
    const fetchImpl = vi.fn((url: string) => url.endsWith('/v1/me')
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(json(200, { models: [], has_more: false })))
    const registrar = { home: first.home, timeoutMs: 1000, pollIntervalMs: 10, refreshMinutes: 0 }
    const face = installGateway(ctx, { home: first.home, registrar, fetchImpl: fetchImpl as never })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(Object.keys(providers).sort()).toEqual(['gateway-anthropic', 'gateway-openrouter'])
    expect(face.status()).toMatchObject({ connected: true, error: 'The gateway did not answer.' })
  })
})

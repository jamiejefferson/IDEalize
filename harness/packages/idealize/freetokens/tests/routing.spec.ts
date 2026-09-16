/**
 * The routing host routes: GET relays the engine's strategy + vectors under
 * the stored admin session; POST validates the strategy and weight vector
 * before the engine's PUT, and refuses without the auth marker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void> | void

class FakeRequest extends EventEmitter {
  headers: Record<string, string>
  constructor(public url: string, headers: Record<string, string>, private readonly body = '') {
    super()
    this.headers = { host: '127.0.0.1:3180', ...headers }
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  chunks: string[] = []
  writeHead(status: number) {
    this.status = status
    return this
  }
  end(chunk?: string) {
    if (chunk !== undefined) this.chunks.push(chunk)
  }
  json(): unknown { return JSON.parse(this.chunks.join('')) }
}

const ENGINE = 'http://127.0.0.1:3001'
const ROUTING = {
  strategy: 'balanced',
  weights: { reliability: 0.5, speed: 0.25, intelligence: 0.25 },
  customWeights: { reliability: 0.5, speed: 0.25, intelligence: 0.25 },
  scores: [],
}

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function mount(options: { password?: string } = { password: 'pw' }) {
  calls = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, ...init === undefined ? {} : { init } })
    if (url === `${ENGINE}/api/auth/login`) return Promise.resolve(json({ token: 'tok' }))
    if (url === `${ENGINE}/api/fallback/routing` && init?.method === 'PUT') {
      const body = JSON.parse(init.body as string) as { strategy: string }
      return Promise.resolve(json({ strategy: body.strategy, presets: {} }))
    }
    if (url === `${ENGINE}/api/fallback/routing`) return Promise.resolve(json(ROUTING))
    return Promise.resolve(json({ error: 'unexpected' }, 500))
  }))
  const ctx = new Context()
  const routes = new Map<string, Handler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      routes.set(route.path, route.handler)
      return () => { routes.delete(route.path) }
    },
  })
  ctx.provide('credentials', {
    resolve: (ref: unknown) =>
      Promise.resolve(options.password !== undefined && JSON.stringify(ref).includes('FREETOKENS_ADMIN_PASSWORD') ? { value: options.password } : undefined),
    set: () => Promise.resolve(),
  })
  ctx.provide('settings', { get: () => undefined, update: () => Promise.resolve() })
  await ctx.plugin({ name: 'idealize-freetokens', inject: [], apply }, { baseURL: ENGINE })
  await new Promise(resolve => setTimeout(resolve, 0))
  const call = async (path: string, init: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {}) => {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    const headers: Record<string, string> = init.auth === false ? {} : { 'x-idealize-auth': '1' }
    const res = new FakeResponse()
    await handler(new FakeRequest(path, headers, init.body === undefined ? '' : JSON.stringify(init.body)), res)
    return res
  }
  return { call }
}

const engineCalls = (): Call[] => calls.filter(call => call.url === `${ENGINE}/api/fallback/routing`)

afterEach(() => { vi.unstubAllGlobals() })

describe('freetokens routing routes', () => {
  it('relays the engine routing payload under the admin session', async () => {
    const { call } = await mount()
    const res = await call('/idealize/freetokens/routing')
    expect(res.status).toBe(200)
    expect(res.json()).toEqual(ROUTING)
    expect((engineCalls()[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('fails loud when this host never provisioned the engine', async () => {
    const { call } = await mount({})
    const res = await call('/idealize/freetokens/routing')
    expect(res.status).toBe(500)
    expect((res.json() as { error: string }).error).toContain('no stored admin password')
  })

  it('puts a preset strategy, and the custom vector with its weights', async () => {
    const { call } = await mount()
    const preset = await call('/idealize/freetokens/routing/strategy', { method: 'POST', body: { strategy: 'fastest' } })
    expect(preset.status).toBe(200)
    expect(JSON.parse(engineCalls()[0]!.init?.body as string)).toEqual({ strategy: 'fastest' })
    const custom = await call('/idealize/freetokens/routing/strategy', {
      method: 'POST', body: { strategy: 'custom', weights: { reliability: 80, speed: 33, intelligence: 33 } },
    })
    expect(custom.json()).toEqual({ strategy: 'custom', presets: {} })
    expect(JSON.parse(engineCalls()[1]!.init?.body as string)).toEqual({
      strategy: 'custom', weights: { reliability: 80, speed: 33, intelligence: 33 },
    })
  })

  it('rejects an unknown strategy, a short or all-zero vector, and a missing auth marker before reaching the engine', async () => {
    const { call } = await mount()
    const post = (body: unknown, auth = true) => call('/idealize/freetokens/routing/strategy', { method: 'POST', body, auth })
    expect((await post({ strategy: 'cheapest' })).status).toBe(400)
    expect((await post({ strategy: 'custom', weights: { reliability: 1 } })).status).toBe(400)
    expect((await post({ strategy: 'custom', weights: { reliability: 0, speed: 0, intelligence: 0 } })).status).toBe(400)
    expect((await post({ strategy: 'custom' }, false)).status).toBe(403)
    expect(engineCalls()).toHaveLength(0)
  })
})

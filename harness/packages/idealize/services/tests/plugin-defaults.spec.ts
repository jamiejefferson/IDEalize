/**
 * The plugin's own defaults and the sign-in join: what it uses when the
 * composition names no timings, and how a route offered by signing in is kept
 * out of the key list unless it already holds a key.
 */

import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import GenerationRuntime from '@idealize/generate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void>

class FakeRequest extends EventEmitter {
  method = 'GET'
  headers: Record<string, string> = {}
  #body = ''
  constructor(method: string, headers: Record<string, string>, body?: string) {
    super()
    this.method = method
    this.headers = headers
    if (body !== undefined) this.#body = body
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    yield Buffer.from(this.#body, 'utf8')
  }
}

class FakeResponse {
  status = 0
  body = ''
  writeHead(status: number) { this.status = status; return this }
  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
  json(): { services: { id: string; kind: string; connected: boolean }[] } {
    return JSON.parse(this.body) as { services: { id: string; kind: string; connected: boolean }[] }
  }
}

const contexts: Context[] = []
const homes: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** One host root over a scratch home, mounted with no composition config at all. */
async function mount(options: {
  providers?: Record<string, { apiKeyEnv?: string }>
  section?: false
  oauth?: false | { throws?: boolean }
  storedKeys?: string[]
  refusing?: true
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'idealize-services-defaults-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ models: [] })))

  const ctx = new Context()
  contexts.push(ctx)
  let handler: Handler | undefined
  const stored = new Set(options.storedKeys ?? [])
  let section: unknown = options.section === false ? {} : { providers: options.providers ?? {} }

  ctx.provide('webServer', {
    // The plugin registers the list route and the keys-file import beside it;
    // these tests drive the list route.
    register(route: { path: string; handler: Handler }) {
      if (route.path === '/idealize/brains/services') handler = route.handler
      return () => { if (route.path === '/idealize/brains/services') handler = undefined }
    },
  } as never)
  ctx.provide('credentials', {
    resolve: async (ref: string) => {
      if (options.refusing === true) throw new Error('the credential store is unreadable')
      return stored.has(ref) ? { value: 'k', source: 'test' } : undefined
    },
    set: async (ref: string) => { stored.add(ref) },
    unset: async (ref: string) => { stored.delete(ref) },
  } as never)
  ctx.provide('settings', {
    get: () => section,
    update: async (_ns: unknown, patch: unknown) => { section = patch },
  } as never)
  ctx.provide('llm', {
    listConfigurableProviders: () => [
      { provider: 'acme', displayName: 'Acme Gateway' },
      { provider: 'openai-codex', displayName: 'ChatGPT' },
    ],
  } as never)
  const oauth = options.oauth
  if (oauth !== false) {
    ctx.provide('idealizeOAuth', {
      status: async () => {
        if (oauth?.throws === true) throw new Error('the sign-in surface is down')
        return [
          { id: 'openai-codex', name: 'ChatGPT', keyless: true, stored: false, pending: false },
          { id: 'kimi-coding', name: 'Kimi', keyless: false, stored: false, pending: false },
        ]
      },
    } as never)
  }
  await ctx.plugin(GenerationRuntime).await()
  await ctx.plugin({ name: 'idealize-services', inject: ['llm', 'generation', 'settings', 'credentials', 'webServer'], apply }, {}).await()

  const call = async (method: string, body?: unknown): Promise<FakeResponse> => {
    if (handler === undefined) throw new Error('the services route was never registered')
    const res = new FakeResponse()
    const headers = { host: '127.0.0.1:3180', 'x-idealize-auth': '1' }
    await handler(new FakeRequest(method, headers, body === undefined ? undefined : JSON.stringify(body)), res)
    return res
  }
  const list = async (): Promise<{ id: string; kind: string; connected: boolean; signIn?: boolean }[]> => (await call('GET')).json().services
  return { ctx, call, list, section: () => section }
}

describe('the plugin with no composition config', () => {
  it('registers the shipped media services and serves the list', async () => {
    const { ctx, list } = await mount()
    expect([...ctx.generation.backends()].length).toBeGreaterThan(0)
    expect((await list()).some(row => row.kind === 'media')).toBe(true)
  })

  it('reads a settings section that names no providers as none', async () => {
    const { list } = await mount({ section: false })
    expect((await list()).some(row => row.id === 'acme')).toBe(true)
  })
})

describe('a route reached by signing in', () => {
  it('is left out of the key list while it holds no key', async () => {
    const { list } = await mount()
    const ids = (await list()).filter(row => row.kind === 'chat').map(row => row.id)
    expect(ids).toEqual(['acme'])
  })

  it('stays in the list once a key is stored for it, marked sign-in when sign-in is its only auth', async () => {
    const { list } = await mount({ storedKeys: ['OPENAI_CODEX_API_KEY', 'ACME_API_KEY'] })
    const chat = (await list()).filter(row => row.kind === 'chat')
    expect(chat.find(row => row.id === 'openai-codex')?.signIn).toBe(true)
    // A keyed route with no sign-in on offer carries no mark.
    expect(chat.find(row => row.id === 'acme')?.signIn).toBeUndefined()
  })

  it('reads no offers at all when the sign-in surface is absent or refuses', async () => {
    const absent = await mount({ oauth: false })
    expect((await absent.list()).filter(row => row.kind === 'chat').map(row => row.id))
      .toEqual(['acme', 'openai-codex'])

    const refusing = await mount({ oauth: { throws: true } })
    expect((await refusing.list()).filter(row => row.kind === 'chat').map(row => row.id))
      .toEqual(['acme', 'openai-codex'])
  })

  it('reads a route’s own recorded credential name rather than the one it would store', async () => {
    const { list } = await mount({ providers: { acme: { apiKeyEnv: 'ACME_TOKEN' } }, storedKeys: ['ACME_TOKEN'] })
    expect((await list()).find(row => row.id === 'acme')?.connected).toBe(true)
  })
})

describe('storing a chat route key', () => {
  it('records the credential name once and leaves a recorded one alone', async () => {
    const first = await mount()
    expect((await first.call('POST', { id: 'acme', kind: 'chat', apiKey: 'sk-one' })).status).toBe(200)
    expect(first.section()).toEqual({ providers: { acme: { apiKeyEnv: 'ACME_API_KEY' } } })

    const written = first.section()
    expect((await first.call('POST', { id: 'acme', kind: 'chat', apiKey: 'sk-two' })).status).toBe(200)
    expect(first.section()).toBe(written)
    // Removing the key forgets the record it made, and only that record.
    expect((await first.call('POST', { id: 'acme', kind: 'chat', apiKey: '' })).status).toBe(200)
    expect(first.section()).toEqual({ providers: { acme: {} } })
  })
})

describe('a credential store that refuses to read', () => {
  it('lists every route as unconnected rather than failing the request', async () => {
    const { list } = await mount({ refusing: true })
    expect((await list()).every(row => !row.connected)).toBe(true)
  })
})

/**
 * The `/idealize/brains/services` route: one list of everything the app can
 * connect, and one write that decides for itself where a key belongs.
 */

import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { chatKeyEnv, installServicesRoute, KEYS_FILE_FORMAT } from '../src/routes.ts'
import type { ServicesRuntime } from '../src/routes.ts'

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void>

class FakeRequest extends EventEmitter {
  headers: Record<string, string>
  constructor(public method: string, headers: Record<string, string>, private readonly body = '') {
    super()
    this.headers = headers
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(status: number, headers: Record<string, string> = {}) {
    this.status = status
    this.headers = headers
    return this
  }

  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
  json(): { [key: string]: unknown } { return JSON.parse(this.body) as { [key: string]: unknown } }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** One host root serving the route over a recording runtime and key store. */
async function mount(options: { setThrows?: unknown; refreshThrows?: unknown } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, Handler>()
  const recorded: string[] = []
  const stored = new Map<string, string>()

  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  } as never)
  ctx.provide('credentials', {
    set: async (ref: string, key: string) => {
      if (options.setThrows !== undefined) throw options.setThrows
      stored.set(ref, key)
    },
    unset: async (ref: string) => { stored.delete(ref) },
  } as never)

  const runtime: ServicesRuntime = {
    chat: async () => [
      { provider: 'acme', displayName: 'Acme Gateway', connected: false },
      { provider: 'openai-codex', displayName: 'ChatGPT', connected: true, signIn: true },
    ],
    media: () => [
      { backend: 'fal', displayName: 'fal.ai', env: 'FAL_KEY', connected: false, artefacts: ['image'] },
      { backend: 'keyless', displayName: 'Keyless', env: '', connected: true, artefacts: ['audio'] },
    ],
    recordChatKeyEnv: async (provider, env) => { recorded.push(`${provider}=${env}`) },
    forgetChatKeyEnv: async (provider, env) => { recorded.push(`-${provider}=${env}`) },
    refreshBackend: async () => {
      if (options.refreshThrows !== undefined) throw options.refreshThrows
      return true
    },
  }
  await ctx.plugin({ name: 'idealize-services-route', inject: [], apply: (pluginCtx: Context) => { installServicesRoute(pluginCtx, runtime) } }).await()

  const call = async (
    init: { method?: string; body?: unknown; auth?: boolean; host?: string; path?: string } = {},
  ) => {
    const handler = handlers.get(init.path ?? '/idealize/brains/services')
    if (handler === undefined) throw new Error('the services route was never registered')
    // An empty host stands for a request that carries no Host header at all.
    const headers: Record<string, string> = init.host === '' ? {} : { host: init.host ?? '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const res = new FakeResponse()
    await handler(new FakeRequest(
      init.method ?? 'GET',
      headers,
      init.body === undefined ? '' : (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)),
    ), res)
    return res
  }
  return { call, recorded, stored }
}

describe('the credential name a chat route’s key lands under', () => {
  it('is the twin of what the models page derives', () => {
    expect(chatKeyEnv('openai-codex')).toBe('OPENAI_CODEX_API_KEY')
    expect(chatKeyEnv('acme')).toBe('ACME_API_KEY')
  })
})

describe('reading the list', () => {
  it('serves chat routes and generation backends together', async () => {
    const answer = await (await mount()).call()
    const services = (answer.json().services as { id: string; kind: string }[]).map(row => `${row.kind}:${row.id}`)
    expect(answer.status).toBe(200)
    expect(services).toContain('chat:acme')
    expect(services).toContain('media:fal')
  })
})

describe('storing a key', () => {
  it('stores a chat route’s key and names the credential its profile needs', async () => {
    const { call, recorded, stored } = await mount()
    const answer = await call({ method: 'POST', body: { id: 'acme', kind: 'chat', apiKey: '  sk-live-1  ' } })

    expect(answer.status).toBe(200)
    expect(stored.get('ACME_API_KEY')).toBe('sk-live-1')
    expect(recorded).toEqual(['acme=ACME_API_KEY'])
  })

  it('stores a generation backend’s key under the name the backend declares', async () => {
    const { call, stored } = await mount()
    expect((await call({ method: 'POST', body: { id: 'fal', kind: 'media', apiKey: 'fal-1' } })).status).toBe(200)
    expect(stored.get('FAL_KEY')).toBe('fal-1')
  })

  it('removes the key when the field is emptied, and records no profile for it', async () => {
    const { call, recorded, stored } = await mount()
    await call({ method: 'POST', body: { id: 'acme', kind: 'chat', apiKey: 'sk-live-1' } })
    expect((await call({ method: 'POST', body: { id: 'acme', kind: 'chat', apiKey: '' } })).status).toBe(200)
    expect(stored.has('ACME_API_KEY')).toBe(false)
    // The removal takes the profile record with it.
    expect(recorded).toEqual(['acme=ACME_API_KEY', '-acme=ACME_API_KEY'])
  })

  it('keeps the key when the catalogue cannot be re-read', async () => {
    const { call, stored } = await mount({ refreshThrows: new Error('the catalogue is down') })
    expect((await call({ method: 'POST', body: { id: 'fal', kind: 'media', apiKey: 'fal-1' } })).status).toBe(200)
    expect(stored.get('FAL_KEY')).toBe('fal-1')
  })

  it('says the environment already names the key rather than blaming the key', async () => {
    const { call } = await mount({ setThrows: new Error('FAL_KEY is set in the launching environment') })
    const refused = await call({ method: 'POST', body: { id: 'fal', kind: 'media', apiKey: 'fal-1' } })
    expect([refused.status, refused.json()]).toEqual([409, { error: 'FAL_KEY is set in the launching environment' }])

    const thrown = await mount({ setThrows: 'the store said no' })
    expect((await thrown.call({ method: 'POST', body: { id: 'fal', kind: 'media', apiKey: 'k' } })).json())
      .toEqual({ error: 'the store said no' })
  })
})

describe('what the write refuses', () => {
  it('refuses a body that is not JSON, and one naming no service', async () => {
    const { call } = await mount()
    expect((await call({ method: 'POST', body: 'not json at all' })).json()).toEqual({ error: 'invalid JSON' })
    expect((await call({ method: 'POST', body: { id: 'nope', kind: 'chat' } })).json())
      .toEqual({ error: 'id and kind must name a service this app can connect' })
  })

  it('refuses a key for a route that is reached by signing in, and still lets a stray one go', async () => {
    const { call, recorded, stored } = await mount()
    expect((await call({ method: 'POST', body: { id: 'openai-codex', kind: 'chat', apiKey: 'k' } })).json())
      .toEqual({ error: 'ChatGPT is connected by signing in, not with a key' })
    // A value stored under the route's name before the mark existed (14 Sep
    // 2026) is removed the same way as any key, record and all.
    stored.set('OPENAI_CODEX_API_KEY', 'nsec-not-a-token')
    expect((await call({ method: 'POST', body: { id: 'openai-codex', kind: 'chat', apiKey: '' } })).status).toBe(200)
    expect(stored.has('OPENAI_CODEX_API_KEY')).toBe(false)
    expect(recorded).toEqual(['-openai-codex=OPENAI_CODEX_API_KEY'])
  })

  it('refuses a key carrying characters an API key cannot hold', async () => {
    const { call } = await mount()
    expect((await call({ method: 'POST', body: { id: 'acme', kind: 'chat', apiKey: 'sk live 1' } })).json())
      .toEqual({ error: 'apiKey contains characters an API key cannot carry' })
    // A body carrying no key at all reads as an empty one, which removes.
    expect((await call({ method: 'POST', body: { id: 'acme', kind: 'chat' } })).status).toBe(200)
  })

  it('refuses a backend that declares no key to store', async () => {
    const { call } = await mount()
    expect((await call({ method: 'POST', body: { id: 'keyless', kind: 'media', apiKey: 'k' } })).json())
      .toEqual({ error: 'Keyless declares no key to store' })
  })

  it('refuses any other method', async () => {
    const { call } = await mount()
    const refused = await call({ method: 'DELETE' })
    expect([refused.status, refused.headers.allow]).toEqual([405, 'GET, POST'])
  })
})

describe('the fences', () => {
  it('answer this machine alone, and demand the header before a write', async () => {
    const { call } = await mount()
    expect((await call({ host: 'example.com' })).status).toBe(403)
    expect((await call({ host: '' })).status).toBe(403)
    expect((await call({ method: 'POST', body: {}, auth: false })).status).toBe(403)
    expect((await call({ host: 'localhost:3180' })).status).toBe(200)
    expect((await call({ host: '[::1]:3180' })).status).toBe(200)
  })
})

describe('importing a keys file', () => {
  const IMPORT = '/idealize/brains/services/import'
  const file = (credentials: Record<string, unknown>, format: unknown = KEYS_FILE_FORMAT) => ({ format, credentials })

  it('connects every service the file names, chat and media alike, in one call', async () => {
    const { call, recorded, stored } = await mount()
    const answer = await call({ method: 'POST', path: IMPORT, body: file({ ACME_API_KEY: ' sk-acme ', FAL_KEY: 'fal-1' }) })

    expect(answer.status).toBe(200)
    expect(answer.json().connected).toEqual([
      { id: 'acme', kind: 'chat', name: 'Acme Gateway' },
      { id: 'fal', kind: 'media', name: 'fal.ai' },
    ])
    expect(stored.get('ACME_API_KEY')).toBe('sk-acme')
    expect(stored.get('FAL_KEY')).toBe('fal-1')
    expect(recorded).toEqual(['acme=ACME_API_KEY'])
    expect(Array.isArray(answer.json().services)).toBe(true)
  })

  it('refuses the whole file when one name belongs to no service, storing nothing', async () => {
    const { call, stored } = await mount()
    const answer = await call({ method: 'POST', path: IMPORT, body: file({ FAL_KEY: 'fal-1', NOBODY_API_KEY: 'x' }) })
    expect([answer.status, answer.json()]).toEqual([400, { error: 'NOBODY_API_KEY is not a credential any service this app can connect takes' }])
    expect(stored.size).toBe(0)
  })

  it('refuses a name a sign-in route would derive, and one a keyless backend declares', async () => {
    const { call } = await mount()
    expect((await call({ method: 'POST', path: IMPORT, body: file({ OPENAI_CODEX_API_KEY: 'k' }) })).json())
      .toEqual({ error: 'OPENAI_CODEX_API_KEY is not a credential any service this app can connect takes' })
  })

  it('names what a malformed file got wrong', async () => {
    const { call } = await mount()
    const refused = async (body: unknown) => (await call({ method: 'POST', path: IMPORT, body })).json().error
    expect(await refused('nope')).toBe('invalid JSON')
    expect(await refused([1])).toBe('a keys file is a JSON object')
    expect(await refused(file({ FAL_KEY: 'k' }, 2))).toBe('keys file format 2 is not one this app reads (expected 1)')
    expect(await refused({ credentials: { FAL_KEY: 'k' } })).toBe('the keys file names no format')
    expect(await refused({ format: 1, credentials: 'FAL_KEY=k' })).toBe('credentials must be an object of credential names to keys')
    expect(await refused(file({}))).toBe('the keys file carries no credentials')
    expect(await refused(file({ '': 'k' }))).toBe('"" is not a credential name')
    expect(await refused(file({ 'FAL-KEY': 'k' }))).toBe('"FAL-KEY" is not a credential name')
    expect(await refused(file({ FAL_KEY: '   ' }))).toBe('FAL_KEY carries no key')
    expect(await refused(file({ FAL_KEY: 7 }))).toBe('FAL_KEY carries no key')
    expect(await refused(file({ FAL_KEY: 'fal 1' }))).toBe('FAL_KEY carries characters an API key cannot carry')
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`K${String(i)}`, 'v']))
    expect(await refused(file(many))).toBe('the keys file carries more than 64 credentials')
  })

  it('reports the store’s refusal under the service’s name, with what connected before it', async () => {
    const { call } = await mount({ setThrows: new Error('FAL_KEY is set in the launching environment') })
    const answer = await call({ method: 'POST', path: IMPORT, body: file({ FAL_KEY: 'fal-1' }) })
    expect([answer.status, answer.json()])
      .toEqual([409, { error: 'fal.ai: FAL_KEY is set in the launching environment', connected: [] }])
  })

  it('takes POST alone, from this machine, with the header', async () => {
    const { call } = await mount()
    const method = await call({ method: 'GET', path: IMPORT })
    expect([method.status, method.headers.allow]).toEqual([405, 'POST'])
    expect((await call({ method: 'POST', path: IMPORT, body: {}, auth: false })).status).toBe(403)
    expect((await call({ method: 'POST', path: IMPORT, body: {}, host: 'example.com' })).status).toBe(403)
  })
})

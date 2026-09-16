/**
 * The sign-in surface: which providers it offers, what it reports about each,
 * and the loopback + header fences that keep the endpoints on this machine.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, IdealizeOAuth } from '../src/index.ts'
import { pendingFields } from '../src/pending.ts'

type Handler = (req: { url?: string; headers: Record<string, string> }, res: FakeResponse) => Promise<void> | void

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
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** One host root over a scratch home, with every route the pack registers. */
async function mount() {
  vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'idealize-oauth-home-')))
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, Handler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  } as never)

  await ctx.plugin({ name: 'idealize-provider-pack', inject: [], apply }).await()

  const call = async (path: string, init: { query?: string | null; auth?: boolean; host?: string } = {}) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    // An empty host stands for a request that carries no Host header at all.
    const headers: Record<string, string> = init.host === '' ? {} : { host: init.host ?? '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const res = new FakeResponse()
    // A null query stands for a request that carries no url at all.
    const url = init.query === null ? undefined : `${path}${init.query ?? ''}`
    await handler({ ...url === undefined ? {} : { url }, headers }, res)
    return res
  }
  return { ctx, oauth: ctx.idealizeOAuth, call }
}

/**
 * How many provider rows a status body lists.
 * @param body - the route's JSON body.
 * @returns the row count.
 */
function rows(body: string): number {
  return (JSON.parse(body) as unknown[]).length
}

describe('what a live attempt reads as', () => {
  it('is pending while it runs, carries a device code, and keeps its last error', () => {
    const settled = Promise.resolve()
    expect(pendingFields(undefined)).toEqual({ pending: false })
    expect(pendingFields({ done: false, settled })).toEqual({ pending: true })
    expect(pendingFields({ done: false, settled, userCode: 'ABCD-1234' })).toEqual({ pending: true, userCode: 'ABCD-1234' })
    // A finished attempt shows neither pending nor its code, only its failure.
    expect(pendingFields({ done: true, settled, userCode: 'ABCD-1234', error: 'the code expired' }))
      .toEqual({ pending: false, error: 'the code expired' })
  })
})

describe('the offered providers', () => {
  it('are the OAuth-capable ones, without Anthropic', async () => {
    const { oauth } = await mount()
    const ids = oauth.oauthProviders().map(provider => provider.id)
    expect(ids).toContain('openai-codex')
    expect(ids).not.toContain('anthropic')
    expect(oauth.oauthProviders().every(provider => provider.name.length > 0)).toBe(true)
  })

  it('is what ctx.idealizeOAuth holds', async () => {
    const { ctx } = await mount()
    expect(ctx.idealizeOAuth).toBeInstanceOf(IdealizeOAuth)
  })
})

describe('the sign-in endpoints', () => {
  it('serve the page and the provider rows', async () => {
    const { call } = await mount()
    const page = await call('/idealize/signin')
    expect(page.status).toBe(200)
    expect(page.body).toContain('idealize/auth/providers')

    const rows = JSON.parse((await call('/idealize/auth/providers')).body) as { id: string; keyless: boolean; stored: boolean; pending: boolean }[]
    expect(rows.every(row => !row.stored && !row.pending)).toBe(true)
    // Sign-in is ChatGPT's only auth; a route that also takes a key says so.
    expect(rows.find(row => row.id === 'openai-codex')?.keyless).toBe(true)
    expect(rows.some(row => !row.keyless)).toBe(true)
  })

  it('report one provider, or say it does not know it', async () => {
    const { call } = await mount()
    expect((await call('/idealize/auth/status', { query: '?provider=openai-codex' })).json()).toMatchObject({ id: 'openai-codex' })
    expect((await call('/idealize/auth/status', { query: '?provider=nope' })).json()).toEqual({ error: 'unknown provider' })
    // No provider named means every row, and an empty one reads the same way.
    expect(rows((await call('/idealize/auth/status')).body)).toBeGreaterThan(1)
    expect(rows((await call('/idealize/auth/status', { query: '?provider=' })).body)).toBeGreaterThan(1)
  })

  it('sign out of a provider, and forget the credential', async () => {
    const { oauth, call } = await mount()
    await oauth.store.modify('openai-codex', async () => ({ type: 'oauth', access: 'a', refresh: 'r', expires: 0 } as never))
    expect((await call('/idealize/auth/providers')).body).toContain('"stored":true')

    expect((await call('/idealize/auth/logout', { query: '?provider=openai-codex' })).json()).toEqual({ ok: true })
    expect((await call('/idealize/auth/providers')).body).not.toContain('"stored":true')
  })

  it('demand a provider on both writes', async () => {
    const { call } = await mount()
    expect((await call('/idealize/auth/login')).json()).toEqual({ error: 'provider query parameter required' })
    expect((await call('/idealize/auth/logout')).json()).toEqual({ error: 'provider query parameter required' })
    // A request that carries no url names no provider either.
    expect((await call('/idealize/auth/login', { query: null })).json()).toEqual({ error: 'provider query parameter required' })
  })

  it('say so when the named provider offers no OAuth flow', async () => {
    const { call } = await mount()
    const refused = await call('/idealize/auth/login', { query: '?provider=not-a-provider' })
    expect(refused.status).toBe(500)
    expect(String(refused.json().error)).toContain('not an OAuth-capable catalog provider')
  })
})

describe('the fences', () => {
  it('answer this machine alone, and demand the header before a write', async () => {
    const { call } = await mount()
    expect((await call('/idealize/signin', { host: 'example.com' })).status).toBe(403)
    expect((await call('/idealize/auth/providers', { host: '' })).status).toBe(403)
    expect((await call('/idealize/auth/logout', { query: '?provider=xai', auth: false })).status).toBe(403)
    // Reading needs no header, and localhost is the same machine.
    expect((await call('/idealize/auth/status', { auth: false, host: 'localhost:3180' })).status).toBe(200)
    expect((await call('/idealize/signin', { host: '[::1]:3180' })).status).toBe(200)
  })
})

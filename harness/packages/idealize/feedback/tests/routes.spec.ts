/**
 * The feedback proxy over a real mount: the loopback fence, what the submit
 * route accepts, the local backup that lands whether or not the network does,
 * and the announcements read passed through verbatim.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

type RouteHandler = (req: FakeRequest, res: FakeResponse) => Promise<void> | void

class FakeRequest extends EventEmitter {
  constructor(
    public url: string,
    public method: string,
    public headers: Record<string, string>,
    private readonly body = '',
  ) {
    super()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  body = ''
  writeHead(status: number, _headers: Record<string, string>) {
    this.status = status
    return this
  }

  end(chunk?: string) {
    if (chunk !== undefined) this.body += chunk
  }

  json(): unknown {
    return JSON.parse(this.body)
  }
}

const SUBMIT = '/idealize/feedback/submit'
const ANNOUNCEMENTS = '/idealize/announcements'

const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** One upstream answer, or a thrown value for the route's own 500 path. */
type Upstream = { ok: boolean; status: number; text?: string } | { throws: unknown }

type MountConfig = { appVersion?: string; endpoint?: string; publishableKey?: string }

/** The upstream every mount names unless a test unsets it (empty strings, or `named` false for a config that omits the fields). */
const UPSTREAM: MountConfig = { endpoint: 'https://feedback.test/rest/v1/', publishableKey: 'test-publishable-key' }

async function mount(upstream: Upstream = { ok: true, status: 201 }, config: MountConfig = { appVersion: '1.2.3-test' }, named = true) {
  const home = await mkdtemp(join(tmpdir(), 'idealize-feedback-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  const sent: { url: string; body: unknown; apikey: string | undefined }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : undefined
    const headers = init?.headers
    const apikey = headers !== undefined && !Array.isArray(headers) && !(headers instanceof Headers) ? headers.apikey : undefined
    sent.push({ url: String(url), body: body === undefined ? undefined : JSON.parse(body) as unknown, apikey })
    if ('throws' in upstream) throw upstream.throws
    return new Response(upstream.text ?? '[]', { status: upstream.status })
  }))
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, RouteHandler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: RouteHandler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  })
  await ctx.plugin({ name: 'idealize-feedback', inject: [], apply }, named ? { ...UPSTREAM, ...config } : config)
  await new Promise(resolve => setTimeout(resolve, 0))

  const call = async (path: string, init: { body?: unknown; auth?: boolean; host?: string } = {}) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    // An empty host means the request carries no Host header at all.
    const headers: Record<string, string> = init.host === '' ? {} : { host: init.host ?? '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const req = new FakeRequest(
      path,
      init.body === undefined ? 'GET' : 'POST',
      headers,
      init.body === undefined ? '' : JSON.stringify(init.body),
    )
    const res = new FakeResponse()
    await handler(req, res)
    return res
  }

  const backup = async (): Promise<string> =>
    await readFile(join(home, 'idealize-feedback-backup.md'), 'utf8').catch(() => '')

  return { call, sent, backup }
}

describe('the feedback proxy', () => {
  it('records a submission upstream and keeps a local copy', async () => {
    const { call, sent, backup } = await mount()
    const answer = await call(SUBMIT, { body: { text: '  the chip is too small  ', feedbackType: 'bug' } })
    expect([answer.status, answer.json()]).toEqual([200, { ok: true }])
    expect(sent[0]?.url).toContain('/idealize_feedback')
    expect(sent[0]?.body).toMatchObject({
      text: 'the chip is too small',
      feedback_type: 'bug',
      app_version: '1.2.3-test',
    })
    expect(await backup()).toContain('the chip is too small')
  })

  it('defaults the kind, and carries a screenshot when one is offered', async () => {
    const { call, sent, backup } = await mount()
    expect((await call(SUBMIT, { body: { text: 'plain note', screenshot: 'QUJD' } })).status).toBe(200)
    expect(sent[0]?.body).toMatchObject({ feedback_type: 'feedback', screenshot_b64: 'QUJD' })
    expect(await backup()).toContain('(feedback)')
  })

  it('refuses an empty note and a screenshot the column cannot hold', async () => {
    const { call, sent } = await mount()
    expect((await call(SUBMIT, { body: { text: '   ' } })).status).toBe(400)
    // A note that is no text at all is the same refusal.
    expect((await call(SUBMIT, { body: { text: 42 } })).status).toBe(400)
    expect((await call(SUBMIT, { body: { text: 'note', screenshot: 'not base64!' } })).status).toBe(400)
    expect((await call(SUBMIT, { body: { text: 'note', screenshot: 'A'.repeat(2_000_001) } })).status).toBe(400)
    // Nothing refused here reached the network.
    expect(sent).toHaveLength(0)
  })

  it('stamps the shipped version when the composition names none, and takes any kind it is given', async () => {
    const { call, sent } = await mount({ ok: true, status: 201 }, {})
    expect((await call(SUBMIT, { body: { text: 'note', feedbackType: '' } })).status).toBe(200)
    expect(sent[0]?.body).toMatchObject({ app_version: '1.0.0-dev', feedback_type: 'feedback' })
  })

  it('says the note was kept when the upstream refuses it', async () => {
    const { call, backup } = await mount({ ok: false, status: 503 })
    const answer = await call(SUBMIT, { body: { text: 'offline note' } })
    expect([answer.status, answer.json()]).toEqual([502, { error: 'the feedback service returned HTTP 503', backedUpLocally: true }])
    expect(await backup()).toContain('offline note')
  })

  it('answers its own failure rather than hanging up', async () => {
    const { call } = await mount({ throws: new Error('the network went away') })
    const answer = await call(SUBMIT, { body: { text: 'a note nobody can send' } })
    expect([answer.status, answer.json()]).toEqual([500, { error: 'the network went away' }])
  })

  it('reports a thrown value that is no Error, and a request that names no host', async () => {
    const thrown = await mount({ throws: 'the network said no' })
    const answer = await thrown.call(SUBMIT, { body: { text: 'a note' } })
    expect([answer.status, answer.json()]).toEqual([500, { error: 'the network said no' }])

    const { call } = await mount()
    const handlerless = await call(ANNOUNCEMENTS, { host: '' })
    expect(handlerless.status).toBe(403)
  })

  it('serves the newest announcement verbatim, and states an upstream refusal', async () => {
    const row = '[{"id":"a-1","title":"New build","body":"Reopen to get it"}]'
    const { call, sent } = await mount({ ok: true, status: 200, text: row })
    const answer = await call(ANNOUNCEMENTS)
    expect([answer.status, answer.body]).toEqual([200, row])
    expect(sent[0]?.url).toContain('active=eq.true')

    const refused = await mount({ ok: false, status: 500 })
    expect((await refused.call(ANNOUNCEMENTS)).status).toBe(502)
  })

  it('answers only on loopback, and demands the header before it writes', async () => {
    const { call } = await mount()
    expect((await call(SUBMIT, { body: { text: 'note' }, host: 'example.com' })).status).toBe(403)
    expect((await call(SUBMIT, { body: { text: 'note' }, auth: false })).status).toBe(403)
    // Reading needs no header, and localhost is the same machine.
    expect((await call(ANNOUNCEMENTS, { auth: false, host: 'localhost:3180' })).status).toBe(200)
    expect((await call(ANNOUNCEMENTS, { host: '[::1]:3180' })).status).toBe(200)
  })
})

describe('without a configured upstream', () => {
  it('keeps the local copy and says so, sending nothing', async () => {
    const { call, sent, backup } = await mount({ ok: true, status: 201 }, { endpoint: '', publishableKey: '' })
    const answer = await call(SUBMIT, { body: { text: 'kept locally' } })
    expect([answer.status, answer.json()]).toEqual([503, { error: 'no feedback service is configured', backedUpLocally: true }])
    expect(sent).toHaveLength(0)
    expect(await backup()).toContain('kept locally')
  })

  it('reads the endpoint and key from the environment when the config names none', async () => {
    vi.stubEnv('IDEALIZE_FEEDBACK_ENDPOINT', 'https://env.feedback.test/rest/v1')
    vi.stubEnv('IDEALIZE_FEEDBACK_KEY', 'env-key')
    const { call, sent } = await mount({ ok: true, status: 201 }, { appVersion: '1.2.3-test' }, false)
    expect((await call(SUBMIT, { body: { text: 'via env' } })).status).toBe(200)
    expect(sent[0]).toMatchObject({ url: 'https://env.feedback.test/rest/v1/idealize_feedback', apikey: 'env-key' })
  })

  it('answers an empty announcements list', async () => {
    const { call, sent } = await mount({ ok: true, status: 200 }, { endpoint: '', publishableKey: '' })
    const answer = await call(ANNOUNCEMENTS)
    expect([answer.status, answer.json()]).toEqual([200, []])
    expect(sent).toHaveLength(0)
  })
})

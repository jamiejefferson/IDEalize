// The route handlers over synthetic requests, for the two things a real
// server cannot produce: a request carrying no Host header (HTTP/1.0 may omit
// it) and one carrying no URL, plus a failure the seam did not tag.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { installTranscribeRoutes, rateOf, STATE_PATH, TRANSCRIBE_PATH } from '../src/routes.ts'
import { TranscriptionRuntime } from '../src/service.ts'
import type { TranscriptionProvider } from '../src/types.ts'

/** What a handler wrote. */
interface Written { status: number; body: string }

/** A response that records the one write a handler makes. */
function recorder(): { res: ServerResponse; written: Written } {
  const written: Written = { status: 0, body: '' }
  const res = {
    writeHead(status: number) { written.status = status; return res },
    end(body?: string) { written.body = body ?? ''; return res },
  } as unknown as ServerResponse
  return { res, written }
}

/** A request with exactly the parts a handler reads. */
function requestOf(options: { url?: string; host?: string | null; auth?: boolean; body?: Buffer } = {}): IncomingMessage {
  const headers: Record<string, string> = {}
  if (options.host !== null) headers['host'] = options.host ?? '127.0.0.1'
  if (options.auth === true) headers['x-idealize-auth'] = '1'
  const chunks = options.body === undefined ? [] : [options.body]
  return Object.assign(
    { headers, url: options.url, method: 'POST' },
    { [Symbol.asyncIterator]: async function* () { yield* chunks } },
  ) as unknown as IncomingMessage
}

/** A provider that is simply ready. */
const ready: TranscriptionProvider = {
  id: 'ready',
  describe: () => ({ id: 'ready', label: 'Ready', location: 'on-device', model: 'test', sampleRate: 16_000 }),
  readiness: () => Promise.resolve({ state: 'ready' }),
  prepare: () => Promise.resolve({ state: 'ready' }),
  transcribe: () => Promise.resolve({ text: 'hello', confident: true, ms: 1 }),
}

/** A provider whose readiness throws something the seam never tagged. */
const untagged: TranscriptionProvider = {
  id: 'untagged',
  describe: () => ({ id: 'untagged', label: 'Untagged', location: 'on-device', model: 'test', sampleRate: 16_000 }),
  readiness: () => Promise.reject(new Error('onnx session vanished')),
  prepare: () => Promise.resolve({ state: 'ready' }),
  transcribe: () => Promise.resolve({ text: '', confident: false, ms: 0 }),
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/** Compose the runtime over a web server stub that hands back the handlers. */
async function mount(provider?: TranscriptionProvider) {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>>()
  const ctx = new Context()
  context = ctx
  ctx.provide('webServer', {
    register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) => {
      handlers.set(route.path, route.handler)
      return () => handlers.delete(route.path)
    },
  } as never)
  await ctx.plugin(TranscriptionRuntime, { minCaptureMs: 400, maxCaptureMs: 5_000 })
  if (provider !== undefined) ctx.transcription.register(provider)
  installTranscribeRoutes(ctx, ctx.transcription)
  return async (path: string, options?: Parameters<typeof requestOf>[0]): Promise<Written> => {
    const { res, written } = recorder()
    await handlers.get(path)!(requestOf(options), res)
    return written
  }
}

/** One second of samples, as the bytes a request carries. */
const ONE_SECOND = Buffer.from(new Float32Array(16_000).buffer)

describe('the route fences', () => {
  it('refuses a request that carries no Host header at all', async () => {
    const call = await mount(ready)
    expect(await call(STATE_PATH, { host: null })).toEqual({ status: 403, body: 'loopback only' })
  })

  it('accepts localhost and the IPv6 loopback by name', async () => {
    const call = await mount(ready)
    expect((await call(STATE_PATH, { host: 'localhost:8080' })).status).toBe(200)
    expect((await call(STATE_PATH, { host: '[::1]' })).status).toBe(200)
  })
})

describe('the transcribe handler', () => {
  it('refuses a capture that carries no mutating-request header', async () => {
    const call = await mount(ready)
    expect(await call(TRANSCRIBE_PATH, { url: TRANSCRIBE_PATH, body: ONE_SECOND }))
      .toEqual({ status: 403, body: 'missing x-idealize-auth header' })
  })

  it('reads the default rate when the request carries no URL', async () => {
    const call = await mount(untagged)
    const written = await call(TRANSCRIBE_PATH, { auth: true, body: ONE_SECOND })
    // No URL means no `rate` query, so the capture is read at whisper's rate
    // and reaches the provider, which is where this one fails.
    expect(written.status).toBe(500)
  })

  it('reads the rate the URL names', async () => {
    const call = await mount(ready)
    const written = await call(TRANSCRIBE_PATH, { url: `${TRANSCRIBE_PATH}?rate=16000`, auth: true, body: ONE_SECOND })
    expect(written.status).toBe(200)
    expect(JSON.parse(written.body)).toEqual({ text: 'hello', confident: true, ms: 1 })
  })

  it('reports a failure the seam never tagged as a failed run', async () => {
    const call = await mount(untagged)
    const written = await call(TRANSCRIBE_PATH, { url: TRANSCRIBE_PATH, auth: true, body: ONE_SECOND })
    expect(written.status).toBe(500)
    expect(JSON.parse(written.body)).toEqual({ refusal: 'failed', message: 'onnx session vanished' })
  })

  it('reports a rejection that is not an Error by its text', async () => {
    // A provider that rejects with something other than an Error is exactly
    // what this path reports, so the rule against it does not apply here.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    const rude: TranscriptionProvider = { ...untagged, readiness: () => Promise.reject('no runtime') }
    const call = await mount(rude)
    const written = await call(TRANSCRIBE_PATH, { url: TRANSCRIBE_PATH, auth: true, body: ONE_SECOND })
    expect(JSON.parse(written.body)).toEqual({ refusal: 'failed', message: 'no runtime' })
  })
})

describe('the declared sample rate', () => {
  it('falls back to whisper’s rate for a request with no URL and for one with no rate', () => {
    expect(rateOf(undefined)).toBe(16_000)
    expect(rateOf('/idealize/transcribe')).toBe(16_000)
  })

  it('reads the rate the URL names', () => {
    expect(rateOf('/idealize/transcribe?rate=44100')).toBe(44_100)
  })
})

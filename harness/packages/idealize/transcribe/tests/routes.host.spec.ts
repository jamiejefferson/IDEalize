// The three routes over a real web server and the real runtime, with a stub
// provider in place of the on-device model: what state answers before and
// after a provider is registered, the loopback and auth fences, the body
// format the transcribe route accepts, and the status each refusal answers.
import { request as httpRequest } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { installTranscribeRoutes, PREPARE_PATH, samplesOf, STATE_PATH, TRANSCRIBE_PATH } from '../src/routes.ts'
import { TranscriptionRuntime } from '../src/service.ts'
import type { TranscriptionProvider, TranscriptionReadiness, TranscriptionResult } from '../src/types.ts'

const AUTH = { 'x-idealize-auth': '1' }

/** A provider that answers whatever the test wants. */
function stub(options: {
  readiness?: TranscriptionReadiness
  result?: TranscriptionResult
  sampleRate?: number
} = {}): TranscriptionProvider {
  return {
    id: 'stub',
    describe: () => ({ id: 'stub', label: 'Stub', location: 'on-device', model: 'test', sampleRate: options.sampleRate ?? 16_000 }),
    readiness: () => Promise.resolve(options.readiness ?? { state: 'ready' }),
    prepare: () => Promise.resolve(options.readiness ?? { state: 'ready' }),
    transcribe: () => Promise.resolve(options.result ?? { text: 'hello', confident: true, ms: 3 }),
  }
}

/** A capture of `ms` milliseconds at 16 kHz, as the bytes the route reads. */
function body(ms: number): ArrayBuffer {
  return new Float32Array(Math.round((ms / 1000) * 16_000)).buffer
}

/** One raw request, so a test can send a Host header `fetch` refuses to set. */
function raw(port: number, path: string, headers: Record<string, string>, method = 'GET'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
    })
    req.on('error', reject)
    req.end()
  })
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/** Boot the runtime, the routes and (optionally) a provider over a real server. */
async function boot(provider?: TranscriptionProvider): Promise<{ origin: string; port: number }> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(TranscriptionRuntime, { minCaptureMs: 400, maxCaptureMs: 5_000 })
  if (provider !== undefined) ctx.transcription.register(provider)
  installTranscribeRoutes(ctx, ctx.transcription)
  const port = ctx.webServer.port
  return { origin: `http://127.0.0.1:${String(port)}`, port }
}

describe('the state route', () => {
  it('says no provider is composed while nothing is registered', async () => {
    const { origin } = await boot()
    const payload = await (await fetch(`${origin}${STATE_PATH}`)).json() as { providers: unknown[]; readiness: { state: string; detail: string } }
    expect(payload.providers).toEqual([])
    expect(payload.readiness).toEqual({ state: 'unavailable', detail: 'no speech provider is composed' })
  })

  it('publishes the descriptor and the readiness of the provider a capture would reach', async () => {
    const { origin } = await boot(stub({ readiness: { state: 'preparing', percent: 30 } }))
    const payload = await (await fetch(`${origin}${STATE_PATH}`)).json() as {
      providers: { id: string; location: string; sampleRate: number }[]
      readiness: unknown
    }
    expect(payload.providers).toEqual([{ id: 'stub', label: 'Stub', location: 'on-device', model: 'test', sampleRate: 16_000 }])
    expect(payload.readiness).toEqual({ state: 'preparing', percent: 30 })
  })

  it('refuses a request that did not come from loopback', async () => {
    const { port } = await boot(stub())
    expect(await raw(port, STATE_PATH, { host: 'example.com' })).toMatchObject({ status: 403, body: 'loopback only' })
  })
})

describe('the prepare route', () => {
  it('answers the readiness the attempt settled at', async () => {
    const { origin } = await boot(stub())
    const response = await fetch(`${origin}${PREPARE_PATH}`, { method: 'POST', headers: AUTH })
    expect(await response.json()).toEqual({ readiness: { state: 'ready' } })
  })

  it('refuses a request without the mutating-request header', async () => {
    const { origin } = await boot(stub())
    const response = await fetch(`${origin}${PREPARE_PATH}`, { method: 'POST' })
    expect(response.status).toBe(403)
    expect(await response.text()).toBe('missing x-idealize-auth header')
  })
})

describe('the transcribe route', () => {
  it('answers the transcript for a capture inside the bounds', async () => {
    const { origin } = await boot(stub({ result: { text: 'move the plan icon', confident: true, ms: 9 } }))
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}?rate=16000`, { method: 'POST', headers: AUTH, body: body(1_000) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: 'move the plan icon', confident: true, ms: 9 })
  })

  it('takes the provider sample rate when the query names none', async () => {
    const { origin } = await boot(stub())
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: body(1_000) })
    expect(response.status).toBe(200)
  })

  it('refuses a body that is not whole 32-bit floats', async () => {
    const { origin } = await boot(stub())
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: new Uint8Array([1, 2, 3]).buffer })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ refusal: 'failed', message: 'body is not a whole number of 32-bit float samples' })
  })

  it('refuses an empty body the same way', async () => {
    const { origin } = await boot(stub())
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: new ArrayBuffer(0) })
    expect(response.status).toBe(400)
  })

  it('answers 422 for a capture below the floor and 413 for one above the ceiling', async () => {
    const { origin } = await boot(stub())
    const short = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: body(100) })
    expect(short.status).toBe(422)
    expect((await short.json() as { refusal: string }).refusal).toBe('too-short')
    const long = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: body(6_000) })
    expect(long.status).toBe(413)
    expect((await long.json() as { refusal: string }).refusal).toBe('too-long')
  })

  it('answers 422 when the capture rate is not the one the provider requires', async () => {
    const { origin } = await boot(stub())
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}?rate=44100`, { method: 'POST', headers: AUTH, body: body(1_000) })
    expect(response.status).toBe(422)
    expect((await response.json() as { refusal: string }).refusal).toBe('sample-rate')
  })

  it('answers 503 while the provider is still preparing', async () => {
    const { origin } = await boot(stub({ readiness: { state: 'preparing', percent: 12 } }))
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: body(1_000) })
    expect(response.status).toBe(503)
    expect((await response.json() as { refusal: string }).refusal).toBe('not-ready')
  })

  it('answers 501 when no provider is composed', async () => {
    const { origin } = await boot()
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: body(1_000) })
    expect(response.status).toBe(501)
    expect((await response.json() as { refusal: string }).refusal).toBe('no-provider')
  })
})

describe('the body reader', () => {
  it('reads samples out of a buffer whose bytes are not 4-byte aligned', () => {
    const samples = Float32Array.from([0.25, -0.5])
    const padded = Buffer.alloc(Buffer.from(samples.buffer).length + 1)
    Buffer.from(samples.buffer).copy(padded, 1)
    expect([...samplesOf(padded.subarray(1))!]).toEqual([0.25, -0.5])
  })
})

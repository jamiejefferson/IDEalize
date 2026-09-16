/**
 * The `/idealize/generate/inputs` route on a real web server: the space's
 * chosen media model and the inputs its backend publishes, the empty answers
 * for an unchosen model and a backend that publishes nothing, the logged
 * fallback when a backend's schema fetch fails, and the refusals.
 */
import { get as httpGet } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import GenerationRuntime, { GenerationError } from '../src/index.ts'
import type { GenerationBackend, GenInputField } from '../src/index.ts'

const ACTIVITY_NS = settingsNamespace('idealize-activity-pills')

const FIELDS: GenInputField[] = [
  { name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['16:9', '9:16'], default: '16:9' },
  { name: 'duration', label: 'Duration', kind: 'enum', values: ['4', '5'], default: '5' },
]

let context: Context | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/** A context with the generation seam, a loopback web server, and a settings face holding the given models map. */
async function boot(
  models: Record<string, { provider: string; model: string }>,
): Promise<{ ctx: Context; port: number; warnings: string[] }> {
  const ctx = new Context()
  context = ctx
  const warnings: string[] = []
  ctx.logger.warn = (message: unknown) => { warnings.push(String(message)) }
  ctx.provide('settings', {
    get: (ns: unknown) => (ns === ACTIVITY_NS ? { models } : undefined),
  } as never)
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(GenerationRuntime).await()
  const talkative: GenerationBackend = {
    id: 'fx',
    describe: () => [],
    models: () => [{ id: 'cut', name: 'cut', artefact: 'video', inputModalities: ['text'], outputMediaTypes: ['video/*'] }],
    inputs: modelId => (modelId === 'cut'
      ? Promise.resolve(FIELDS)
      : Promise.reject(new GenerationError('schema refused (404)', 'INVALID_REQUEST'))),
    generate: () => Promise.reject(new Error('unused')),
  }
  const quiet: GenerationBackend = {
    id: 'mute',
    describe: () => [],
    models: () => [],
    generate: () => Promise.reject(new Error('unused')),
  }
  ctx.generation.register(talkative)
  ctx.generation.register(quiet)
  return { ctx, port: ctx.webServer.port, warnings }
}

/** One GET over node:http, which lets the test set the Host header fetch forbids. */
function get(port: number, path: string, host = '127.0.0.1'): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const json = res.headers['content-type']?.includes('json') === true
        const body: unknown = json ? JSON.parse(text) : text
        resolve({ status: res.statusCode ?? 0, body })
      })
    }).on('error', reject)
  })
}

describe('GET /idealize/generate/inputs', () => {
  it('answers the space\'s chosen model and the fields its backend publishes', async () => {
    const { port } = await boot({ motion: { provider: 'fx', model: 'cut' }, images: { provider: 'mute', model: 'still' } })
    expect(await get(port, '/idealize/generate/inputs?space=motion')).toEqual({
      status: 200,
      body: { model: { provider: 'fx', model: 'cut' }, fields: FIELDS },
    })
    // A backend that publishes no schema: the model, and no fields.
    expect(await get(port, '/idealize/generate/inputs?space=gallery')).toEqual({
      status: 200,
      body: { model: { provider: 'mute', model: 'still' }, fields: [] },
    })
    // No model chosen for the space yet.
    expect(await get(port, '/idealize/generate/inputs?space=soundstage')).toEqual({ status: 200, body: { model: null, fields: [] } })
  })

  it('answers the model with no fields, and logs, when the backend cannot read the schema', async () => {
    const { port, warnings } = await boot({ motion: { provider: 'fx', model: 'gone' } })
    expect(await get(port, '/idealize/generate/inputs?space=motion')).toEqual({
      status: 200,
      body: { model: { provider: 'fx', model: 'gone' }, fields: [] },
    })
    expect(warnings).toEqual(['idealize-generate: input schema for fx/gone unavailable: schema refused (404)'])
    // A stored choice naming a backend nobody registered reads the same way, without a warning.
    const { port: other, warnings: none } = await boot({ motion: { provider: 'nobody', model: 'x' } })
    expect(await get(other, '/idealize/generate/inputs?space=motion')).toEqual({
      status: 200,
      body: { model: { provider: 'nobody', model: 'x' }, fields: [] },
    })
    expect(none).toEqual([])
  })

  it('refuses a space that does not generate, a method other than GET, and a non-loopback host', async () => {
    const { port } = await boot({})
    const chat = await get(port, '/idealize/generate/inputs?space=chat')
    expect(chat.status).toBe(400)
    expect((chat.body as { error: string }).error).toContain('gallery, soundstage or motion')
    expect(await get(port, '/idealize/generate/inputs')).toMatchObject({ status: 400 })
    const post = await fetch(`http://127.0.0.1:${String(port)}/idealize/generate/inputs?space=motion`, { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET')
    expect((await get(port, '/idealize/generate/inputs?space=motion', 'evil.example')).status).toBe(403)
  })
})

describe('GenerationRuntime.inputs', () => {
  it('asks the backend, and answers empty for an unknown backend or one without inputs', async () => {
    const ctx = new Context()
    await ctx.plugin(GenerationRuntime).await()
    ctx.generation.register({ id: 'quiet', describe: () => [], models: () => [], generate: () => Promise.reject(new Error('unused')) })
    ctx.generation.register({
      id: 'loud', describe: () => [], models: () => [], generate: () => Promise.reject(new Error('unused')),
      inputs: modelId => Promise.resolve([{ name: modelId, label: modelId, kind: 'enum', values: ['a'] }]),
    })
    expect(await ctx.generation.inputs({ backend: 'quiet', model: 'x' })).toEqual([])
    expect(await ctx.generation.inputs({ backend: 'nobody', model: 'x' })).toEqual([])
    expect(await ctx.generation.inputs({ backend: 'loud', model: 'x' })).toEqual([{ name: 'x', label: 'x', kind: 'enum', values: ['a'] }])
  })
})

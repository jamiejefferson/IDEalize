/**
 * The queue adapter's pure translation (catalogue pages, queue body, result
 * files, refusals) and its queue flow against a scripted fetch: enqueue,
 * poll, read the result, download the files, and every failure translated
 * into a GenerationError code. Driven with fal.ai's directory row, the only
 * queue service the app carries.
 */
import { describe, expect, it, vi } from 'vitest'
import { GENERATION_SCHEMA_VERSION, isGenerationError } from '@idealize/generate'
import type { GenerationProgress, GenerationRequest, GenModelInfo } from '@idealize/generate'
import { createQueueBackend } from '../src/adapters/queue.ts'
import { liveModelsFrom, mergeCatalog } from '../src/adapters/queue-catalog.ts'
import {
  classifyStatus, endpointFor, queuePayload, refusalReason, refusedFields, REQUIRED_FIELD_DEFAULTS, requiredFieldDefaults,
  resultFilesFrom,
} from '../src/adapters/queue-api.ts'
import type { InputSchema } from '../src/adapters/input-schema.ts'
import { MEDIA_SERVICES } from '../src/media-directory.ts'
import { SEEDANCE_DOCUMENT } from './seedance-document.ts'

/** fal's directory row: the endpoints, categories and auth the adapter is driven with. */
const FAL = MEDIA_SERVICES.find(row => row.id === 'fal')!
const FAL_BACKEND_ID = FAL.id
const CATEGORIES = FAL.categories!

/** One catalogue row, as the cache would hold it. */
function model(id: string, name: string, artefact: 'image' | 'video' | 'audio'): GenModelInfo {
  return { id, name, artefact, inputModalities: ['text'], outputMediaTypes: [`${artefact}/*`] }
}

const PAGE = {
  models: [
    { endpoint_id: 'fal-ai/flux/dev', metadata: { display_name: 'FLUX.1 [dev]', category: 'text-to-image', status: 'active', kind: 'inference' } },
    { endpoint_id: 'acme/cut', metadata: { display_name: 'Cut', category: 'text-to-video', status: 'active', kind: 'inference' } },
    { endpoint_id: 'acme/old', metadata: { display_name: 'Old', category: 'text-to-video', status: 'deprecated', kind: 'inference' } },
    { endpoint_id: 'acme/train', metadata: { display_name: 'Train', category: 'text-to-video', status: 'active', kind: 'training' } },
    { endpoint_id: 'acme/edit', metadata: { display_name: 'Edit', category: 'image-to-image', status: 'active', kind: 'inference' } },
    { endpoint_id: 'acme/nameless', metadata: { category: 'text-to-audio' } },
    { metadata: { category: 'text-to-audio' } },
  ],
  has_more: true,
  next_cursor: 'Mg',
}

function request(model: string, artefact: 'image' | 'video' | 'audio' = 'video', overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    taskIntent: `generate-${artefact}`,
    requiredCapabilities: [{ operation: 'generate', artefact, inputModalities: ['text'] }],
    model: { backend: FAL_BACKEND_ID, model },
    prompt: 'a kite over a beach',
    ...overrides,
  }
}

describe('catalogue mapping', () => {
  it('keeps active inference rows of the listed categories, typed by category', () => {
    const models = liveModelsFrom(PAGE, CATEGORIES)
    expect(models.map(model => `${model.artefact}:${model.id}:${model.name}`)).toEqual([
      'image:fal-ai/flux/dev:FLUX.1 [dev]',
      'video:acme/cut:Cut',
      'audio:acme/nameless:acme/nameless',
    ])
    expect(models[0]!.inputModalities).toEqual(['text'])
    expect(liveModelsFrom(null, CATEGORIES)).toEqual([])
    // A page carrying a null row skips it rather than failing the fetch.
    expect(liveModelsFrom({ models: [null] }, CATEGORIES)).toEqual([])
    expect(liveModelsFrom({ models: 'x' }, CATEGORIES)).toEqual([])
  })

  it('merges live rows over the rows already known, by id', () => {
    // What the cache held on the last start: one row the live page re-lists
    // under a newer name, and one it has dropped.
    const known = liveModelsFrom({
      models: [
        { endpoint_id: 'fal-ai/flux/dev', metadata: { display_name: 'FLUX (cached)', category: 'text-to-image', status: 'active', kind: 'inference' } },
        { endpoint_id: 'acme/retired', metadata: { display_name: 'Retired', category: 'text-to-image', status: 'active', kind: 'inference' } },
      ],
    }, CATEGORIES)
    const merged = mergeCatalog(known, liveModelsFrom(PAGE, CATEGORIES))
    expect(merged.find(model => model.id === 'fal-ai/flux/dev')?.name).toBe('FLUX.1 [dev]')
    expect(merged.filter(model => model.id === 'fal-ai/flux/dev')).toHaveLength(1)
    // A row the live page omits stays selectable, so a partial fetch never
    // shrinks the picker.
    expect(merged.map(model => model.id)).toContain('acme/retired')
    expect(merged.map(model => model.id)).toContain('acme/cut')
    expect(merged.length).toBe(known.length + 2)
  })
})

describe('wire translation', () => {
  it('builds the queue body from the prompt, the first image attachment and the neutral settings', () => {
    expect(queuePayload(request('m', 'image', {
      settings: { prompt: 'ignored', aspect: '16:9', duration_s: 5, seed: 7 },
      attachments: [
        { mediaType: 'audio/wav', data: 'AUD' },
        { mediaType: 'image/png', data: 'IMG' },
      ],
    }))).toEqual({
      prompt: 'a kite over a beach',
      aspect_ratio: '16:9',
      duration: 5,
      seed: 7,
      image_url: 'data:image/png;base64,IMG',
    })
    expect(queuePayload(request('m', 'image', { settings: { aspect: '1024x768' } }))).toEqual({
      prompt: 'a kite over a beach',
      image_size: { width: 1024, height: 768 },
    })
    expect(queuePayload(request('m', 'image', { settings: { aspect: 'wide', duration_s: -1 } }))).toEqual({ prompt: 'a kite over a beach' })
  })

  it('lets a setting under fal\'s own name win over the neutral one, and maps count to num_images', () => {
    expect(queuePayload(request('m', 'video', {
      settings: { aspect: '16:9', aspect_ratio: '9:16', duration_s: 5, duration: '8', count: 3, resolution: '1080p' },
    }))).toEqual({ prompt: 'a kite over a beach', aspect_ratio: '9:16', duration: '8', num_images: 3, resolution: '1080p' })
    expect(queuePayload(request('m', 'image', { settings: { aspect: '1024x768', image_size: 'square_hd', count: 2, num_images: 4 } })))
      .toEqual({ prompt: 'a kite over a beach', image_size: 'square_hd', num_images: 4 })
    expect(queuePayload(request('m', 'image', { settings: { count: 0.5 } }))).toEqual({ prompt: 'a kite over a beach' })
  })

  it('sends a request carrying an image to the image-to-video sibling of a text-to-video endpoint', () => {
    const withImage = request('m', 'video', { attachments: [{ mediaType: 'image/png', data: 'IMG' }] })
    expect(endpointFor('fal-ai/bytedance/seedance/v1/pro/text-to-video', withImage)).toBe('fal-ai/bytedance/seedance/v1/pro/image-to-video')
    expect(endpointFor('fal-ai/kling-video/v2.5-turbo/pro/text-to-video', withImage)).toBe('fal-ai/kling-video/v2.5-turbo/pro/image-to-video')
    // No image, or an endpoint not named that way: the model's own endpoint.
    expect(endpointFor('fal-ai/bytedance/seedance/v1/pro/text-to-video', request('m'))).toBe('fal-ai/bytedance/seedance/v1/pro/text-to-video')
    expect(endpointFor('fal-ai/veo3.1', withImage)).toBe('fal-ai/veo3.1')
    expect(endpointFor('fal-ai/flux/dev', request('m', 'image', { attachments: [{ mediaType: 'audio/wav', data: 'A' }] }))).toBe('fal-ai/flux/dev')
  })

  it('finds every result file whatever the endpoint names it', () => {
    expect(resultFilesFrom({
      images: [{ url: 'https://f/a.png', content_type: 'image/png', width: 1 }, { url: 'https://f/b.png' }],
      video: { url: 'https://f/c.mp4', content_type: 'video/mp4' },
      audio_file: { url: 'https://f/d.wav', content_type: '' },
      seed: 3,
      nested: { deeper: [{ url: 'ftp://no' }, { url: 'https://f/e.mp3' }] },
    })).toEqual([
      { url: 'https://f/a.png', contentType: 'image/png' },
      { url: 'https://f/b.png' },
      { url: 'https://f/c.mp4', contentType: 'video/mp4' },
      { url: 'https://f/d.wav' },
      { url: 'https://f/e.mp3' },
    ])
    expect(resultFilesFrom(null)).toEqual([])
  })

  it('reads the plain reason out of a fal error body', () => {
    expect(refusalReason('{"detail":"Exhausted balance"}')).toBe('Exhausted balance')
    expect(refusalReason('{"detail":[{"loc":["body","duration"],"msg":"unexpected value"},{"msg":"x"}]}')).toBe('duration: unexpected value; x')
    expect(refusalReason('{"detail":[]}')).toBe('{"detail":[]}')
    expect(refusalReason('<html>')).toBe('<html>')
    expect(classifyStatus(401)).toBe('AUTH')
    expect(classifyStatus(402)).toBe('QUOTA')
    expect(classifyStatus(408)).toBe('TIMEOUT')
    expect(classifyStatus(429)).toBe('RATE_LIMIT')
    expect(classifyStatus(422)).toBe('INVALID_REQUEST')
    expect(classifyStatus(503)).toBe('PROVIDER_ERROR')
  })

  it('names the defaults for a 422 that wants only fields the seam can fill', () => {
    const missingLyrics = '{"detail":[{"loc":["body","lyrics"],"msg":"Field required"}]}'
    expect(requiredFieldDefaults(missingLyrics, { prompt: 'p' })).toEqual({ lyrics: REQUIRED_FIELD_DEFAULTS['lyrics'] })
    expect(requiredFieldDefaults(missingLyrics, { prompt: 'p' })).toEqual({ lyrics: '[instrumental]' })
    // The field is in the body already: fal is refusing its value, not its absence.
    expect(requiredFieldDefaults(missingLyrics, { prompt: 'p', lyrics: '' })).toBeUndefined()
    // A required field with no default, alone or beside one that has.
    expect(requiredFieldDefaults('{"detail":[{"loc":["body","voice"],"msg":"Field required"}]}', { prompt: 'p' })).toBeUndefined()
    expect(requiredFieldDefaults(
      '{"detail":[{"loc":["body","lyrics"],"msg":"Field required"},{"loc":["body","voice"],"msg":"Field required"}]}',
      { prompt: 'p' },
    )).toBeUndefined()
    // A 422 for another reason, an entry with no location, and bodies that are not fal's validation JSON.
    expect(requiredFieldDefaults('{"detail":[{"loc":["body","duration"],"msg":"unexpected value"}]}', { prompt: 'p' })).toBeUndefined()
    expect(requiredFieldDefaults('{"detail":[{"msg":"Field required"}]}', { prompt: 'p' })).toBeUndefined()
    expect(requiredFieldDefaults('{"detail":"Exhausted balance"}', { prompt: 'p' })).toBeUndefined()
    expect(requiredFieldDefaults('<html>', { prompt: 'p' })).toBeUndefined()
  })

  it('lists the refused fields of a 422 body', () => {
    expect(refusedFields('{"detail":[{"loc":["body","duration"],"msg":"Input should be \'4\' or \'5\'"},{"msg":"x"}]}'))
      .toEqual([{ field: 'duration', msg: "Input should be '4' or '5'" }, { field: '', msg: 'x' }])
    expect(refusedFields('{"detail":"Exhausted balance"}')).toEqual([])
    expect(refusedFields('<html>')).toEqual([])
  })
})

/** A scripted fal: catalogue pages, the queue, and the file host, on one fetch. */
function fakeFal(script: {
  enqueue?: (body: unknown) => Response
  /** The OpenAPI document per endpoint id; absent answers 404 to every schema request. */
  schema?: (endpoint: string) => Response
  statuses?: string[]
  result?: unknown
  files?: Record<string, { type: string; bytes: string }>
} = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const statuses = [...script.statuses ?? ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']]
  const bodyOf = (init?: RequestInit): string => typeof init?.body === 'string' ? init.body : ''
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.startsWith('https://catalog/models')) return Promise.resolve(json(PAGE))
    if (url.startsWith('https://schema/?endpoint_id=')) {
      if (script.schema === undefined) return Promise.resolve(new Response('not found', { status: 404 }))
      return Promise.resolve(script.schema(decodeURIComponent(url.slice('https://schema/?endpoint_id='.length))))
    }
    if (url === 'https://queue/acme/requests/r1/status') return Promise.resolve(json({ status: statuses.shift() ?? 'COMPLETED', queue_position: 2 }))
    if (url === 'https://queue/acme/requests/r1') return Promise.resolve(json(script.result ?? { video: { url: 'https://files/out.mp4', content_type: 'video/mp4' } }))
    if (url === 'https://queue/acme/requests/r1/cancel') return Promise.resolve(json({}, 202))
    if (url.startsWith('https://queue/')) {
      if (script.enqueue !== undefined) return Promise.resolve(script.enqueue(JSON.parse(bodyOf(init))))
      return Promise.resolve(json({
        request_id: 'r1',
        status_url: 'https://queue/acme/requests/r1/status',
        response_url: 'https://queue/acme/requests/r1',
        cancel_url: 'https://queue/acme/requests/r1/cancel',
      }))
    }
    const file = script.files?.[url] ?? (url === 'https://files/out.mp4' ? { type: 'video/mp4', bytes: 'MP4BYTES' } : undefined)
    if (file !== undefined) return Promise.resolve(new Response(file.bytes, { status: 200, headers: { 'content-type': file.type } }))
    return Promise.resolve(new Response('not found', { status: 404 }))
  }
  return { fetchImpl, calls, bodyOf }
}

/**
 * The catalogue a previous run cached. Nothing is compiled in any more, so a
 * backend that has not refreshed knows only what the cache gave it — which is
 * the state most of these cases start from.
 */
const CACHED: readonly GenModelInfo[] = [
  model('fal-ai/flux/dev', 'FLUX.1 [dev]', 'image'),
  model('fal-ai/veo3.1', 'Veo 3.1', 'video'),
]

function backend(
  fal: ReturnType<typeof fakeFal>, key: string | null = 'fal-secret',
  extra: {
    cached?: readonly GenModelInfo[]
    onCatalog?: (models: readonly GenModelInfo[]) => void
    /** The schema address; null builds a backend for a service that publishes none. */
    inputSchemaUrl?: string | null
    cachedInputs?: (modelId: string) => InputSchema | undefined
    onInputSchema?: (modelId: string, schema: InputSchema) => void
  } = {},
) {
  const { inputSchemaUrl = 'https://schema/?endpoint_id={id}', ...rest } = extra
  return createQueueBackend({
    id: FAL.id,
    name: FAL.name,
    baseUrl: 'https://catalog',
    queueUrl: 'https://queue',
    categories: CATEGORIES,
    auth: FAL.auth!,
    timeoutMs: 5_000,
    pollIntervalMs: 1,
    credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
    resolveApiKey: () => Promise.resolve(key ?? undefined),
    fetchImpl: fal.fetchImpl,
    cached: CACHED,
    ...inputSchemaUrl === null ? {} : { inputSchemaUrl },
    ...rest,
  })
}

/** The seedance schema document as fal serves it, for every endpoint asked. */
const seedanceSchema = (): Response => Response.json(SEEDANCE_DOCUMENT)

describe('the backend', () => {
  it('describes the artefacts it serves as no-credential until a refresh sees a key, then merges the live pages', async () => {
    const fal = fakeFal()
    const fresh = backend(fal, null)
    expect(fresh.credential).toEqual({ displayName: 'fal.ai', env: 'FAL_KEY' })
    expect(fresh.describe().map(descriptor => `${descriptor.artefact}:${descriptor.availability}`)).toEqual([
      'image:no-credential', 'video:no-credential', 'audio:no-credential',
    ])
    await fresh.refresh()
    expect(fresh.describe().every(descriptor => descriptor.availability === 'no-credential')).toBe(true)
    expect(fal.calls.map(call => call.url)).toEqual([
      'https://catalog/models?limit=100&category=text-to-image',
      'https://catalog/models?limit=100&category=text-to-video',
      'https://catalog/models?limit=100&category=text-to-audio',
    ])
    expect(fal.calls[0]!.init?.headers).not.toHaveProperty('authorization')
    expect(fresh.models().map(model => model.id)).toContain('acme/cut')

    const keyed = backend(fal)
    await keyed.refresh()
    expect(keyed.describe().every(descriptor => descriptor.availability === 'available')).toBe(true)
  })

  it('runs the queue flow: enqueue with the key, poll to completion, read the result, download the files', async () => {
    const fal = fakeFal()
    const fresh = backend(fal)
    await fresh.refresh()
    const phases: GenerationProgress[] = []
    const result = await fresh.generate(request('acme/cut', 'video', { settings: { aspect: '16:9' } }), progress => phases.push(progress), new AbortController().signal)
    expect(result).toMatchObject({ backend: 'fal', model: 'acme/cut', artefact: 'video', schemaVersion: GENERATION_SCHEMA_VERSION })
    expect(result.outputs).toEqual([{ mediaType: 'video/mp4', data: Buffer.from('MP4BYTES').toString('base64') }])
    const enqueue = fal.calls.find(call => call.url === 'https://queue/acme/cut')!
    expect(enqueue.init?.method).toBe('POST')
    expect((enqueue.init?.headers as Record<string, string>)['authorization']).toBe('Key fal-secret')
    expect(JSON.parse(fal.bodyOf(enqueue.init))).toEqual({ prompt: 'a kite over a beach', aspect_ratio: '16:9' })
    expect(fal.calls.filter(call => call.url.endsWith('/status'))).toHaveLength(3)
    expect(phases.map(phase => phase.phase)).toEqual(['queued', 'sending', 'queued', 'queued', 'sending', 'receiving', 'done'])
    expect(phases[3]!.message).toBe('queued (position 2)')
  })

  it('enqueues a reference image on the image-to-video sibling, with the sibling\'s schema and the image as a data URL', async () => {
    const fal = fakeFal({ schema: seedanceSchema })
    const fresh = backend(fal, 'fal-secret', { cached: [model('acme/v1/text-to-video', 'Acme', 'video')] })
    const result = await fresh.generate(
      request('acme/v1/text-to-video', 'video', { attachments: [{ mediaType: 'image/png', data: 'IMG' }], settings: { duration_s: 5 } }),
      () => {},
      new AbortController().signal,
    )
    expect(result.model).toBe('acme/v1/text-to-video')
    expect(result.outputs).toHaveLength(1)
    const enqueue = fal.calls.find(call => call.init?.method === 'POST')!
    expect(enqueue.url).toBe('https://queue/acme/v1/image-to-video')
    expect(JSON.parse(fal.bodyOf(enqueue.init))).toEqual({ prompt: 'a kite over a beach', duration: '5', image_url: 'data:image/png;base64,IMG' })
    expect(fal.calls.filter(call => call.url.startsWith('https://schema/')).map(call => call.url))
      .toEqual(['https://schema/?endpoint_id=acme/v1/image-to-video'])
  })

  it('keeps only files of the requested artefact and types them from the header or the extension', async () => {
    const fal = fakeFal({
      result: { images: [{ url: 'https://files/a' }, { url: 'https://files/b.webp' }], preview: { url: 'https://files/p.mp4' } },
      files: {
        'https://files/a': { type: 'image/png', bytes: 'A' },
        'https://files/b.webp': { type: 'application/octet-stream', bytes: 'B' },
        'https://files/p.mp4': { type: 'video/mp4', bytes: 'P' },
      },
    })
    const fresh = backend(fal)
    const result = await fresh.generate(request('fal-ai/flux/dev', 'image'), () => {}, new AbortController().signal)
    expect(result.outputs.map(output => output.mediaType)).toEqual(['image/png', 'image/webp'])
  })

  it('refuses an unknown model, a missing key, and translates fal refusals with their reason', async () => {
    const noKey = backend(fakeFal(), null)
    await expect(noKey.generate(request('acme/nope'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'NO_MODEL' })
    await expect(noKey.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })

    const refused = backend(fakeFal({
      enqueue: () => new Response('{"detail":[{"loc":["body","duration"],"msg":"unexpected value"}]}', { status: 422 }),
    }))
    const error = await refused.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal).catch((thrown: unknown) => thrown)
    expect(isGenerationError(error)).toBe(true)
    expect(error).toMatchObject({ code: 'INVALID_REQUEST', message: 'fal.ai refused the video generation (422): duration: unexpected value' })

    const unauthorised = backend(fakeFal({ enqueue: () => new Response('{"detail":"Unauthorized"}', { status: 401 }) }))
    await expect(unauthorised.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'AUTH' })

    const limited = backend(fakeFal({ enqueue: () => new Response('', { status: 429, headers: { 'retry-after': '30' } }) }))
    await expect(limited.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'RATE_LIMIT', retryAfterMs: 30_000 })

    const empty = backend(fakeFal({ result: { seed: 1 } }))
    await expect(empty.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })

    const odd = backend(fakeFal({ statuses: ['FAILED'] }))
    await expect(odd.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })

    const noTicket = backend(fakeFal({ enqueue: () => new Response('{}', { status: 200 }) }))
    await expect(noTicket.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  /** fal's music endpoint as the cache holds it, and a scripted queue that serves one mp3 for it. */
  const MUSIC = model('minimax/music-3', 'MiniMax Music 3', 'audio')
  const music = (enqueue?: (body: unknown) => Response) => fakeFal({
    ...enqueue === undefined ? {} : { enqueue },
    result: { audio: { url: 'https://files/out.mp3', content_type: 'audio/mpeg' } },
    files: { 'https://files/out.mp3': { type: 'audio/mpeg', bytes: 'MP3BYTES' } },
  })
  const ticket = () => new Response(JSON.stringify({
    request_id: 'r1',
    status_url: 'https://queue/acme/requests/r1/status',
    response_url: 'https://queue/acme/requests/r1',
    cancel_url: 'https://queue/acme/requests/r1/cancel',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  const enqueues = (fal: ReturnType<typeof fakeFal>) => fal.calls
    .filter(call => call.url === `https://queue/${MUSIC.id}`)
    .map(call => JSON.parse(fal.bodyOf(call.init)) as Record<string, unknown>)

  it('fills a required field fal names and enqueues once more', async () => {
    const fal = music(body => (body as { lyrics?: unknown }).lyrics === undefined
      ? new Response('{"detail":[{"loc":["body","lyrics"],"msg":"Field required"}]}', { status: 422 })
      : ticket())
    const result = await backend(fal, 'fal-secret', { cached: [MUSIC] })
      .generate(request(MUSIC.id, 'audio'), () => {}, new AbortController().signal)
    expect(result.outputs.map(output => output.mediaType)).toEqual(['audio/mpeg'])
    expect(enqueues(fal)).toEqual([
      { prompt: 'a kite over a beach' },
      { prompt: 'a kite over a beach', lyrics: '[instrumental]' },
    ])
  })

  it('sends the lyrics a request carries once, with no retry', async () => {
    const fal = music(body => (body as { lyrics?: unknown }).lyrics === undefined
      ? new Response('{"detail":[{"loc":["body","lyrics"],"msg":"Field required"}]}', { status: 422 })
      : ticket())
    const result = await backend(fal, 'fal-secret', { cached: [MUSIC] })
      .generate(request(MUSIC.id, 'audio', { settings: { lyrics: '[verse] salt on the wind' } }), () => {}, new AbortController().signal)
    expect(result.outputs).toHaveLength(1)
    expect(enqueues(fal)).toEqual([{ prompt: 'a kite over a beach', lyrics: '[verse] salt on the wind' }])
  })

  it('still refuses a 422 naming a required field it cannot fill, and a second 422', async () => {
    const fal = music(() => new Response('{"detail":[{"loc":["body","voice"],"msg":"Field required"}]}', { status: 422 }))
    await expect(backend(fal, 'fal-secret', { cached: [MUSIC] })
      .generate(request(MUSIC.id, 'audio'), () => {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'fal.ai refused the audio generation (422): voice: Field required' })
    expect(enqueues(fal)).toHaveLength(1)

    // The retry carries the default and fal still wants something: that answer is the refusal.
    const twice = music(body => (body as { lyrics?: unknown }).lyrics === undefined
      ? new Response('{"detail":[{"loc":["body","lyrics"],"msg":"Field required"}]}', { status: 422 })
      : new Response('{"detail":[{"loc":["body","lyrics"],"msg":"too short"}]}', { status: 422 }))
    await expect(backend(twice, 'fal-secret', { cached: [MUSIC] })
      .generate(request(MUSIC.id, 'audio'), () => {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'fal.ai refused the audio generation (422): lyrics: too short' })
    expect(enqueues(twice)).toHaveLength(2)
  })

  it('coerces the body to the endpoint\'s input schema before enqueueing, and offers the schema\'s enums as inputs', async () => {
    const written: [string, InputSchema][] = []
    const fal = fakeFal({ schema: seedanceSchema })
    const fresh = backend(fal, 'fal-secret', { onInputSchema: (id, schema) => { written.push([id, schema]) } })
    const result = await fresh.generate(
      request('fal-ai/veo3.1', 'video', { settings: { duration_s: 7.5, resolution: '1080p', camera_fixed: 'true' } }),
      () => {},
      new AbortController().signal,
    )
    expect(result.outputs).toHaveLength(1)
    const enqueue = fal.calls.find(call => call.url === 'https://queue/fal-ai/veo3.1')!
    expect(JSON.parse(fal.bodyOf(enqueue.init))).toEqual({ prompt: 'a kite over a beach', duration: '8', resolution: '1080p', camera_fixed: true })
    expect(fal.calls.filter(call => call.url.startsWith('https://schema/')).map(call => call.url))
      .toEqual(['https://schema/?endpoint_id=fal-ai/veo3.1'])
    expect(written.map(([id]) => id)).toEqual(['fal-ai/veo3.1'])

    // The schema is held in memory: inputs() and a second generation fetch nothing.
    const fields = await fresh.inputs('fal-ai/veo3.1')
    expect(fields.map(field => `${field.label}=${String(field.default ?? '')}`)).toEqual(['Aspect=16:9', 'Resolution=720p', 'Duration=5', 'Fixed camera=false', 'Audio=true'])
    await fresh.generate(request('fal-ai/veo3.1', 'video', { settings: { duration_s: 5 } }), () => {}, new AbortController().signal)
    expect(fal.calls.filter(call => call.url.startsWith('https://schema/'))).toHaveLength(1)
    expect(written).toHaveLength(1)
  })

  it('reads a cached schema before asking the service, and answers no inputs where none is published', async () => {
    const fal = fakeFal({ schema: seedanceSchema })
    const cached: InputSchema = { properties: [{ name: 'resolution', type: 'string', enum: ['480p'], required: false }] }
    const fromDisk = backend(fal, 'fal-secret', { cachedInputs: id => (id === 'fal-ai/veo3.1' ? cached : undefined) })
    expect(await fromDisk.inputs('fal-ai/veo3.1')).toEqual([{ name: 'resolution', label: 'Resolution', kind: 'enum', values: ['480p'] }])
    expect(fal.calls).toHaveLength(0)
    // Another endpoint has no cache: fetched.
    expect((await fromDisk.inputs('acme/cut')).map(field => field.name)).toEqual(['aspect_ratio', 'resolution', 'duration', 'camera_fixed', 'generate_audio'])
    expect(fal.calls).toHaveLength(1)

    // A service that publishes no schema URL offers nothing and fetches nothing.
    const silent = backend(fakeFal({ schema: seedanceSchema }), 'fal-secret', { inputSchemaUrl: null })
    expect(await silent.inputs('fal-ai/veo3.1')).toEqual([])

    // A document with no input schema offers nothing, and is asked for again next time.
    const bare = fakeFal({ schema: () => Response.json({ components: { schemas: {} } }) })
    const empty = backend(bare)
    expect(await empty.inputs('fal-ai/veo3.1')).toEqual([])
    expect(await empty.inputs('fal-ai/veo3.1')).toEqual([])
    expect(bare.calls).toHaveLength(2)
  })

  it('reports a schema the service refuses, and still generates without it', async () => {
    const refused = backend(fakeFal())
    await expect(refused.inputs('fal-ai/veo3.1')).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 404 })
    const down = backend(fakeFal({ schema: () => { throw new TypeError('socket hang up') } }))
    await expect(down.inputs('fal-ai/veo3.1')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })

    // No schema known: the number goes out as sent, and a 422 that names the
    // literals is answered once with the coerced one.
    const fal = fakeFal({
      enqueue: body => (typeof (body as { duration?: unknown }).duration === 'number'
        ? new Response('{"detail":[{"loc":["body","duration"],"msg":"Input should be \'4\', \'5\', \'6\', \'7\', \'8\', \'9\', \'10\', \'11\' or \'12\'"}]}', { status: 422 })
        : ticket()),
    })
    const result = await backend(fal).generate(request('fal-ai/veo3.1', 'video', { settings: { duration_s: 5 } }), () => {}, new AbortController().signal)
    expect(result.outputs).toHaveLength(1)
    expect(fal.calls.filter(call => call.url === 'https://queue/fal-ai/veo3.1').map(call => JSON.parse(fal.bodyOf(call.init)) as unknown)).toEqual([
      { prompt: 'a kite over a beach', duration: 5 },
      { prompt: 'a kite over a beach', duration: '5' },
    ])

    // A 422 whose literals the body cannot be coerced to is the refusal it reads as.
    const stuck = backend(fakeFal({
      enqueue: () => new Response('{"detail":[{"loc":["body","aspect_ratio"],"msg":"Input should be \'16:9\' or \'9:16\'"}]}', { status: 422 }),
    }))
    await expect(stuck.generate(request('fal-ai/veo3.1', 'video', { settings: { aspect: '4:3' } }), () => {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', message: "fal.ai refused the video generation (422): aspect_ratio: Input should be '16:9' or '9:16'" })
  })

  it('reports an abort while polling as ABORTED and asks fal to cancel', async () => {
    const fal = fakeFal({ statuses: ['IN_QUEUE', 'IN_QUEUE', 'IN_QUEUE', 'IN_QUEUE'] })
    const fresh = backend(fal)
    const controller = new AbortController()
    const pending = fresh.generate(request('fal-ai/veo3.1'), (progress) => {
      if (progress.message === 'queued (position 2)') controller.abort()
    }, controller.signal)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(fal.calls.some(call => call.url.endsWith('/cancel') && call.init?.method === 'PUT')).toBe(true)
  })

  it('reports the whole-generation timeout as TIMEOUT', async () => {
    const fal = fakeFal({ statuses: Array.from({ length: 50 }, () => 'IN_PROGRESS') })
    const slow = createQueueBackend({
      id: FAL.id,
      name: FAL.name,
      baseUrl: 'https://catalog',
      queueUrl: 'https://queue',
      categories: CATEGORIES,
      auth: FAL.auth!,
      timeoutMs: 30,
      pollIntervalMs: 5,
      credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
      resolveApiKey: () => Promise.resolve('k'),
      fetchImpl: fal.fetchImpl,
      cached: [model('fal-ai/veo3.1', 'Veo 3.1', 'video')],
    })
    await expect(slow.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('surfaces a refused catalogue page as a GenerationError and keeps the last-known list', async () => {
    const fal = fakeFal()
    // The last-known list is what the cache gave, since nothing is compiled in.
    const cached = [model('fal-ai/veo3.1', 'Veo 3.1', 'video')]
    const limited = createQueueBackend({
      id: FAL.id,
      name: FAL.name,
      baseUrl: 'https://catalog',
      queueUrl: 'https://queue',
      categories: CATEGORIES,
      auth: FAL.auth!,
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
      resolveApiKey: () => Promise.reject(new Error('store down')),
      fetchImpl: () => Promise.resolve(new Response('', { status: 429 })),
      cached,
    })
    await expect(limited.refresh()).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(limited.models()).toEqual(cached)
    expect(limited.describe()[0]?.availability).toBe('no-credential')
    await expect(limited.generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(fal.calls).toHaveLength(0)
  })
})

/** A queue whose every answer the case scripts itself, for the paths fakeFal never reaches. */
function scripted(fetchImpl: typeof fetch) {
  return { fetchImpl, calls: [] as { url: string; init: RequestInit | undefined }[], bodyOf: () => '' }
}

/** The ticket every scripted queue answers an enqueue with. */
function ticketBody(cancel = true): unknown {
  return {
    request_id: 'r1',
    status_url: 'https://queue/acme/requests/r1/status',
    response_url: 'https://queue/acme/requests/r1',
    ...cancel ? { cancel_url: 'https://queue/acme/requests/r1/cancel' } : {},
  }
}

describe('a queue that answers oddly', () => {
  const video = request('fal-ai/veo3.1')

  /** Route one scripted queue: enqueue, then whatever the case says for status, result and download. */
  function route(script: {
    status?: () => Response
    result?: () => Response
    download?: () => Response
    cancel?: boolean
    onCancel?: () => void
  }) {
    return scripted((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://queue/acme/requests/r1/status') {
        return Promise.resolve(script.status?.() ?? Response.json({ status: 'COMPLETED' }))
      }
      if (url === 'https://queue/acme/requests/r1') {
        return Promise.resolve(script.result?.() ?? Response.json({ video: { url: 'https://files/out.mp4' } }))
      }
      if (url === 'https://queue/acme/requests/r1/cancel') {
        script.onCancel?.()
        return Promise.resolve(Response.json({}, { status: 202 }))
      }
      if (url.startsWith('https://queue/')) return Promise.resolve(Response.json(ticketBody(script.cancel ?? true)))
      if (url.startsWith('https://files/')) {
        return Promise.resolve(script.download?.() ?? new Response('MP4', { headers: { 'content-type': 'video/mp4' } }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
  }

  const fails = async (fal: ReturnType<typeof scripted>): Promise<unknown> =>
    backend(fal).generate(video, () => {}, new AbortController().signal).catch((error: unknown) => error)

  it('reports a ticket that is not JSON as a provider error', async () => {
    const fal = scripted(() => Promise.resolve(new Response('<html>', { status: 200 })))
    expect(isGenerationError(await fails(fal)) && (await fails(fal) as { code: string }).code).toBe('PROVIDER_ERROR')
  })

  it('refuses a status read the queue turned down', async () => {
    const failure = await fails(route({ status: () => new Response('gone', { status: 410 }) }))
    expect(isGenerationError(failure) && failure.message).toContain('refused the status read (410)')
  })

  it('reports a status body that is not JSON as an unknown state', async () => {
    const failure = await fails(route({ status: () => new Response('<html>', { status: 200 }) }))
    expect(isGenerationError(failure) && failure.message).toContain('unknown state "undefined"')
  })

  it('refuses a result read the queue turned down', async () => {
    const failure = await fails(route({ result: () => new Response('gone', { status: 410 }) }))
    expect(isGenerationError(failure) && failure.message).toContain('refused the video generation (410)')
  })

  it('treats a result body that is not JSON as no output at all', async () => {
    const failure = await fails(route({ result: () => new Response('<html>', { status: 200 }) }))
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
  })

  it('refuses a download the file host turned down', async () => {
    const failure = await fails(route({ download: () => new Response('gone', { status: 404 }) }))
    expect(isGenerationError(failure) && failure.message).toContain('refused the result download (404)')
  })

  it('names a refusal whose body could not be read by its status alone', async () => {
    const failure = await fails(route({
      result: () => new Response(
        new ReadableStream({ start(controller) { controller.error(new Error('the connection dropped')) } }),
        { status: 502 },
      ),
    }))
    expect(isGenerationError(failure) && failure.message).toBe('fal.ai refused the video generation (502)')
  })

  it('keeps no file whose type it cannot read as the artefact asked for', async () => {
    const failure = await fails(route({
      result: () => Response.json({ video: { url: 'https://files/out' } }),
      download: () => new Response('BYTES', { headers: { 'content-type': 'application/octet-stream' } }),
    }))
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
  })

  it('keeps no file whose extension names no media type', async () => {
    const failure = await fails(route({
      result: () => Response.json({ video: { url: 'https://files/out.zzz' } }),
      download: () => new Response('BYTES', { headers: { 'content-type': 'application/octet-stream' } }),
    }))
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
  })

  it('reports a queue position it cannot read as no position at all', async () => {
    const states = ['IN_QUEUE', 'COMPLETED']
    const fal = route({ status: () => Response.json({ status: states.shift(), queue_position: 'second' }) })
    const phases: GenerationProgress[] = []
    await backend(fal).generate(video, progress => phases.push(progress), new AbortController().signal)
    expect(phases.find(phase => phase.message !== undefined)?.message).toBe('queued')
  })
})

describe('a queue the caller walks away from', () => {
  const video = request('fal-ai/veo3.1')

  it('reports a send that never reached the service as a provider error', async () => {
    const fal = scripted(() => Promise.reject(new Error('connection refused')))
    const failure = await backend(fal).generate(video, () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
  })

  it('reports a send the caller aborted as an abort, and a send that ran out of time as a timeout', async () => {
    const aborted = new AbortController()
    const abortedFal = scripted(() => {
      aborted.abort()
      return Promise.reject(new Error('aborted'))
    })
    await expect(backend(abortedFal).generate(video, () => {}, aborted.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })

    const timedOut = new AbortController()
    const timedOutFal = scripted(() => {
      timedOut.abort()
      return Promise.reject(new DOMException('timed out', 'TimeoutError'))
    })
    await expect(backend(timedOutFal).generate(video, () => {}, timedOut.signal))
      .rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('cancels the ticket when the wait is cut short, and reports the reason it was given', async () => {
    let cancelled = 0
    const controller = new AbortController()
    const fal = scripted((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://queue/acme/requests/r1/status') {
        controller.abort('the person closed the space')
        return Promise.resolve(Response.json({ status: 'IN_QUEUE' }))
      }
      if (url === 'https://queue/acme/requests/r1/cancel') {
        cancelled += 1
        return Promise.reject(new Error('the cancel never landed'))
      }
      return Promise.resolve(Response.json(ticketBody()))
    })
    await expect(backend(fal).generate(video, () => {}, controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
    expect(cancelled).toBe(1)
  })

  it('reports an abort with no ticket to cancel', async () => {
    const controller = new AbortController()
    const fal = scripted((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://queue/acme/requests/r1/status') {
        controller.abort(new DOMException('timed out', 'TimeoutError'))
        return Promise.resolve(Response.json({ status: 'IN_PROGRESS' }))
      }
      return Promise.resolve(Response.json(ticketBody(false)))
    })
    await expect(backend(fal).generate(video, () => {}, controller.signal))
      .rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('a service the app knows nothing about yet', () => {
  it('starts with an empty catalogue and describes only the categories it was given', () => {
    const fresh = createQueueBackend({
      id: FAL.id,
      name: FAL.name,
      baseUrl: 'https://catalog',
      queueUrl: 'https://queue',
      categories: CATEGORIES.filter(category => category.artefact === 'video'),
      auth: FAL.auth!,
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
      resolveApiKey: () => Promise.resolve('fal-secret'),
      fetchImpl: fakeFal().fetchImpl,
    })
    expect(fresh.models()).toEqual([])
    expect(fresh.describe().map(descriptor => descriptor.artefact)).toEqual(['video'])
  })

  it('groups a cached model of an artefact the categories never named', () => {
    const fresh = createQueueBackend({
      id: FAL.id,
      name: FAL.name,
      baseUrl: 'https://catalog',
      queueUrl: 'https://queue',
      categories: CATEGORIES.filter(category => category.artefact === 'video'),
      auth: FAL.auth!,
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
      resolveApiKey: () => Promise.resolve('fal-secret'),
      fetchImpl: fakeFal().fetchImpl,
      cached: [model('acme/painter', 'Acme Painter', 'image')],
    })
    expect(fresh.describe().map(descriptor => descriptor.artefact).sort()).toEqual(['image', 'video'])
  })

  it('reads no schema from a document that is not JSON', async () => {
    const written: string[] = []
    const fal = scripted((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('https://schema/')) return Promise.resolve(new Response('<html>', { status: 200 }))
      if (url === 'https://queue/acme/requests/r1/status') return Promise.resolve(Response.json({ status: 'COMPLETED' }))
      if (url === 'https://queue/acme/requests/r1') return Promise.resolve(Response.json({ video: { url: 'https://files/out.mp4' } }))
      if (url.startsWith('https://queue/')) return Promise.resolve(Response.json(ticketBody()))
      return Promise.resolve(new Response('MP4', { headers: { 'content-type': 'video/mp4' } }))
    })
    const result = await backend(fal, 'fal-secret', { onInputSchema: id => written.push(id) })
      .generate(request('fal-ai/veo3.1'), () => {}, new AbortController().signal)
    expect(result.outputs).toHaveLength(1)
    expect(written).toEqual([])
  })
})

describe('the backend as the composition builds it', () => {
  it('reaches the service through the platform fetch when the composition injects none', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      return Promise.resolve(Response.json(PAGE))
    })
    const fresh = createQueueBackend({
      id: FAL.id,
      name: FAL.name,
      baseUrl: 'https://catalog',
      queueUrl: 'https://queue',
      categories: CATEGORIES,
      auth: FAL.auth!,
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
      resolveApiKey: () => Promise.resolve('fal-secret'),
    })
    await fresh.refresh()
    expect(seen[0]).toContain('https://catalog/models')
    vi.unstubAllGlobals()
  })

  it('reports a wait cut short mid-poll with the reason it was given', async () => {
    const controller = new AbortController()
    const fal = scripted((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://queue/acme/requests/r1/status') {
        setTimeout(() => { controller.abort('the person closed the space') }, 0)
        return Promise.resolve(Response.json({ status: 'IN_QUEUE' }))
      }
      if (url === 'https://queue/acme/requests/r1/cancel') return Promise.resolve(Response.json({}, { status: 202 }))
      return Promise.resolve(Response.json(ticketBody()))
    })
    await expect(backend(fal).generate(request('fal-ai/veo3.1'), () => {}, controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })
})

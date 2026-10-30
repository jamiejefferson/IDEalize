/**
 * What the model browser reads from a queue service: the whole catalogue
 * across pages (and through rate limits), each row's description, picture,
 * tags, licence, date and maker, and each model's price stated per output.
 * The pricing response is a fixture written to fal's documented shape.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GenModelInfo } from '@idealize/generate'
import { createQueueBackend } from '../src/adapters/queue.ts'
import { liveModelsFrom, makerOf, mergeCatalog, tagsFrom } from '../src/adapters/queue-catalog.ts'
import { modelPrice, pricesFrom, pricingUrls } from '../src/adapters/queue-pricing.ts'
import { readCatalogCache, readInputSchemaCache, writeCatalogCache, writeInputSchemaCache } from '../src/adapters/catalog-cache.ts'
import { exampleOutput } from '../src/adapters/example-output.ts'
import type { InputSchema } from '../src/adapters/input-schema.ts'
import { coerceBody } from '../src/adapters/input-schema.ts'
import { MEDIA_SERVICES } from '../src/media-directory.ts'

const FAL = MEDIA_SERVICES.find(row => row.id === 'fal')!
const CATEGORIES = FAL.categories!

/** One live catalogue row as fal lists it. */
function row(id: string, category: string, metadata: Record<string, unknown> = {}) {
  return { endpoint_id: id, metadata: { display_name: id, category, status: 'active', kind: 'inference', ...metadata } }
}

/** fal's pricing answer for a set of endpoints, in its documented shape. */
const PRICING = {
  prices: [
    { endpoint_id: 'fal-ai/nano-banana-2', unit_price: 0.08, unit: 'image', currency: 'USD' },
    { endpoint_id: 'fal-ai/flux-2-pro', unit_price: 0.03, unit: 'megapixels', currency: 'USD' },
    { endpoint_id: 'minimax/h3-max/text-to-video', unit_price: 0.0125, unit: 'seconds', currency: 'USD' },
    { endpoint_id: 'bytedance/seedream/v5/pro/text-to-image', unit_price: 0.0675, unit: 'units', currency: 'USD' },
    { endpoint_id: 'bad/negative', unit_price: -1, unit: 'image', currency: 'USD' },
    { endpoint_id: 'bad/no-unit', unit_price: 1 },
    null,
  ],
  next_cursor: null,
  has_more: false,
}

describe('catalogue metadata', () => {
  it('carries description, picture, tags, licence, date and maker from each row', () => {
    const [model] = liveModelsFrom({
      models: [row('bytedance/seedream/v5/pro/text-to-image', 'text-to-image', {
        display_name: 'Seedream 5.0 Pro',
        description: '  Flagship text-to-image model. ',
        thumbnail_url: 'https://v3b.fal.media/files/b/x.jpg',
        tags: ['Realism', 'text-to-image', 'Text to Image', '', 'realism', 'typography'],
        license_type: 'commercial',
        date: '2026-07-07T10:00:00.000Z',
      })],
    }, CATEGORIES)
    expect(model).toEqual({
      id: 'bytedance/seedream/v5/pro/text-to-image',
      name: 'Seedream 5.0 Pro',
      artefact: 'image',
      inputModalities: ['text'],
      outputMediaTypes: ['image/*'],
      description: 'Flagship text-to-image model.',
      thumbnailUrl: 'https://v3b.fal.media/files/b/x.jpg',
      tags: ['realism', 'typography'],
      licence: 'commercial',
      released: '2026-07-07',
      maker: 'bytedance',
    })
  })

  it('leaves out fields a row does not state, and a picture that is not https', () => {
    const [model] = liveModelsFrom({ models: [row('fal-ai/flux-2-pro', 'text-to-image', { thumbnail_url: 'javascript:alert(1)', tags: [], date: 'soon' })] }, CATEGORIES)
    expect(model).toEqual({
      id: 'fal-ai/flux-2-pro', name: 'fal-ai/flux-2-pro', artefact: 'image',
      inputModalities: ['text'], outputMediaTypes: ['image/*'], maker: 'flux-2-pro',
    })
  })

  it('drops tags that restate the category, whatever their separators', () => {
    expect(tagsFrom(['image-to-video', 'Image to Video', 'image_to_video', 'lipsync', '  Motion '], 'image-to-video')).toEqual(['lipsync', 'motion'])
    expect(tagsFrom('stylized', 'text-to-image')).toEqual([])
    expect(tagsFrom([3, null, 'vector'], 'text-to-image')).toEqual(['vector'])
  })

  it('reads the maker from the endpoint id, past fal\'s own namespace', () => {
    expect(makerOf('fal-ai/flux-2-pro')).toBe('flux-2-pro')
    expect(makerOf('openai/gpt-image-2')).toBe('openai')
    expect(makerOf('fal-ai')).toBe('fal-ai')
    expect(makerOf('solo')).toBe('solo')
  })

  it('keeps a known price when a live row replaces its model', () => {
    const price = modelPrice({ unitPrice: 0.08, unit: 'image', currency: 'USD' }, 'image')
    const known: GenModelInfo[] = [{ id: 'a', name: 'A', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'], price }]
    const live: GenModelInfo[] = [{ id: 'a', name: 'A2', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'] }]
    expect(mergeCatalog(known, live)).toEqual([{ ...live[0], price }])
  })
})

describe('prices', () => {
  it('names every endpoint across batches', () => {
    const ids = Array.from({ length: 5 }, (_, index) => `fal-ai/m${String(index)}`)
    const urls = pricingUrls('https://api.fal.ai/v1/models/pricing', ids, 2)
    expect(urls).toHaveLength(3)
    expect(new URL(urls[0]!).searchParams.getAll('endpoint_id')).toEqual(['fal-ai/m0', 'fal-ai/m1'])
    expect(new URL(urls[2]!).searchParams.getAll('endpoint_id')).toEqual(['fal-ai/m4'])
    expect(pricingUrls('https://api.fal.ai/v1/models/pricing', [])).toEqual([])
  })

  it('reads the documented response and drops rows it cannot price', () => {
    const prices = pricesFrom(PRICING)
    expect([...prices.keys()]).toEqual([
      'fal-ai/nano-banana-2', 'fal-ai/flux-2-pro', 'minimax/h3-max/text-to-video', 'bytedance/seedream/v5/pro/text-to-image',
    ])
    expect(prices.get('fal-ai/flux-2-pro')).toEqual({ unitPrice: 0.03, unit: 'megapixels', currency: 'USD' })
    expect(pricesFrom(null).size).toBe(0)
    expect(pricesFrom({ prices: 'x' }).size).toBe(0)
    expect(pricesFrom({ prices: [{ endpoint_id: 'a', unit_price: 1, unit: 'image' }] }).get('a')?.currency).toBe('USD')
  })

  it('states a price per output where the unit allows it, and not otherwise', () => {
    const per = (unitPrice: number, unit: string, artefact: 'image' | 'video' | 'audio') =>
      modelPrice({ unitPrice, unit, currency: 'USD' }, artefact).perOutput
    expect(per(0.08, 'image', 'image')).toEqual({ amount: 0.08, output: 'image' })
    expect(per(0.04, 'images', 'image')).toEqual({ amount: 0.04, output: 'image' })
    expect(per(0.03, 'processed megapixels', 'image')).toEqual({ amount: 0.03, output: '1 MP image' })
    expect(per(0.0125, 'seconds', 'video')).toEqual({ amount: 0.0625, output: '5 s clip' })
    expect(per(0.002, 'seconds', 'audio')).toEqual({ amount: 0.12, output: 'minute of audio' })
    expect(per(0.6, 'minutes', 'audio')).toEqual({ amount: 0.6, output: 'minute of audio' })
    expect(per(0.0675, 'units', 'image')).toBeUndefined()
    expect(per(1.2, '1m tokens', 'video')).toBeUndefined()
    expect(per(0.0001, 'compute seconds', 'audio')).toBeUndefined()
    expect(per(0.08, 'image', 'video')).toBeUndefined()
  })
})

/** A scripted fal: catalogue pages by cursor, pricing, and a log of every request. */
function scriptedFal(script: {
  pages?: Record<string, unknown>
  pricing?: () => Response
  limitFirst?: number
}) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  let limited = script.limitFirst ?? 0
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    if (limited > 0) {
      limited--
      return Promise.resolve(new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }))
    }
    if (url.startsWith('https://pricing')) return Promise.resolve(script.pricing?.() ?? Response.json(PRICING))
    const parsed = new URL(url)
    const key = `${parsed.searchParams.get('category') ?? ''}:${parsed.searchParams.get('cursor') ?? ''}`
    return Promise.resolve(Response.json(script.pages?.[key] ?? { models: [], has_more: false }))
  }
  return { fetchImpl, calls }
}

function backendWith(fal: ReturnType<typeof scriptedFal>, key: string | undefined, extra: {
  cached?: readonly GenModelInfo[]
  onCatalog?: (models: readonly GenModelInfo[]) => void
} = {}) {
  return createQueueBackend({
    id: FAL.id,
    name: FAL.name,
    baseUrl: 'https://catalog',
    queueUrl: 'https://queue',
    categories: [CATEGORIES[0]!],
    auth: FAL.auth!,
    timeoutMs: 5_000,
    pollIntervalMs: 1,
    retryDelayMs: 1,
    credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
    resolveApiKey: () => Promise.resolve(key),
    pricingUrl: 'https://pricing/v1/models/pricing',
    fetchImpl: fal.fetchImpl,
    ...extra,
  })
}

const THREE_PAGES = {
  'text-to-image:': { models: [row('fal-ai/nano-banana-2', 'text-to-image')], has_more: true, next_cursor: 'p2' },
  'text-to-image:p2': { models: [row('fal-ai/flux-2-pro', 'text-to-image')], has_more: true, next_cursor: 'p3' },
  'text-to-image:p3': { models: [row('bytedance/seedream/v5/pro/text-to-image', 'text-to-image')], has_more: false, next_cursor: null },
}

describe('a refresh', () => {
  it('reads every page of a category, not only the first', async () => {
    const fal = scriptedFal({ pages: THREE_PAGES })
    const backend = backendWith(fal, undefined)
    await backend.refresh()
    expect(backend.models().map(model => model.id)).toEqual([
      'fal-ai/nano-banana-2', 'fal-ai/flux-2-pro', 'bytedance/seedream/v5/pro/text-to-image',
    ])
    expect(fal.calls.map(call => new URL(call.url).searchParams.get('cursor'))).toEqual([null, 'p2', 'p3'])
  })

  it('stops when the service repeats a cursor', async () => {
    const fal = scriptedFal({ pages: { 'text-to-image:': { models: [], has_more: true, next_cursor: 'p2' }, 'text-to-image:p2': { models: [], has_more: true, next_cursor: 'p2' } } })
    await backendWith(fal, undefined).refresh()
    expect(fal.calls).toHaveLength(2)
  })

  it('waits out a rate limit and carries on', async () => {
    const fal = scriptedFal({ pages: THREE_PAGES, limitFirst: 2 })
    const backend = backendWith(fal, undefined)
    await backend.refresh()
    expect(backend.models()).toHaveLength(3)
    expect(fal.calls).toHaveLength(5)
  })

  it('prices every model with the stored key, and records the priced catalogue', async () => {
    const fal = scriptedFal({ pages: THREE_PAGES })
    const recorded: (readonly GenModelInfo[])[] = []
    const backend = backendWith(fal, 'fal-secret', { onCatalog: models => recorded.push(models) })
    await backend.refresh()
    const pricing = fal.calls.filter(call => call.url.startsWith('https://pricing'))
    expect(pricing).toHaveLength(1)
    expect(pricing[0]!.headers).toMatchObject({ authorization: 'Key fal-secret' })
    expect(new URL(pricing[0]!.url).searchParams.getAll('endpoint_id')).toEqual([
      'fal-ai/nano-banana-2', 'fal-ai/flux-2-pro', 'bytedance/seedream/v5/pro/text-to-image',
    ])
    const byId = new Map(backend.models().map(model => [model.id, model.price]))
    expect(byId.get('fal-ai/nano-banana-2')).toEqual({ unitPrice: 0.08, unit: 'image', currency: 'USD', perOutput: { amount: 0.08, output: 'image' } })
    expect(byId.get('bytedance/seedream/v5/pro/text-to-image')).toEqual({ unitPrice: 0.0675, unit: 'units', currency: 'USD' })
    expect(recorded.at(-1)?.find(model => model.id === 'fal-ai/flux-2-pro')?.price?.perOutput).toEqual({ amount: 0.03, output: '1 MP image' })
    // The catalogue pages themselves go out without the key.
    expect(fal.calls[0]!.headers).not.toHaveProperty('authorization')
  })

  it('asks for no prices without a key', async () => {
    const fal = scriptedFal({ pages: THREE_PAGES })
    await backendWith(fal, undefined).refresh()
    expect(fal.calls.some(call => call.url.startsWith('https://pricing'))).toBe(false)
  })

  it('keeps known prices and still records the catalogue when the price read is refused', async () => {
    const price = modelPrice({ unitPrice: 0.08, unit: 'image', currency: 'USD' }, 'image')
    const cached: GenModelInfo[] = [{ id: 'fal-ai/nano-banana-2', name: 'Nano', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'], price }]
    const fal = scriptedFal({ pages: THREE_PAGES, pricing: () => new Response('no', { status: 403 }) })
    const recorded: (readonly GenModelInfo[])[] = []
    const backend = backendWith(fal, 'fal-secret', { cached, onCatalog: models => recorded.push(models) })
    await expect(backend.refresh()).rejects.toMatchObject({ status: 403 })
    expect(backend.models()).toHaveLength(3)
    expect(backend.models().find(model => model.id === 'fal-ai/nano-banana-2')?.price).toEqual(price)
    expect(recorded).toHaveLength(1)
  })
})

describe('the catalogue cache', () => {
  const homes: string[] = []
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  })
  const home = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'idealize-browser-'))
    homes.push(dir)
    return dir
  }

  it('round-trips the browser fields', () => {
    const dir = home()
    const model: GenModelInfo = {
      id: 'fal-ai/kling/image-to-video', name: 'Kling', artefact: 'video',
      inputModalities: ['text', 'image'], outputMediaTypes: ['video/*'], requiredInputs: ['image'],
      description: 'Animates a picture.', thumbnailUrl: 'https://x/y.jpg', tags: ['motion'],
      licence: 'commercial', released: '2026-01-02', maker: 'kling',
      price: modelPrice({ unitPrice: 0.07, unit: 'seconds', currency: 'USD' }, 'video'),
    }
    writeCatalogCache(dir, 'fal', [model])
    expect(readCatalogCache(dir, 'fal')).toEqual([model])
  })

  it('reads a cache written before the browser fields existed, and drops bad values field by field', () => {
    const dir = home()
    mkdirSync(join(dir, 'service-catalogues'), { recursive: true })
    writeFileSync(join(dir, 'service-catalogues', 'fal.json'), JSON.stringify({
      fetchedAt: '2026-10-01T00:00:00.000Z',
      models: [
        { id: 'old', name: 'Old', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'] },
        {
          id: 'odd', name: 'Odd', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'],
          tags: 'realism', licence: 4, price: { unitPrice: 'cheap', unit: 'image', currency: 'USD' },
          requiredInputs: [], maker: 'acme',
        },
      ],
    }))
    expect(readCatalogCache(dir, 'fal')).toEqual([
      { id: 'old', name: 'Old', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'] },
      { id: 'odd', name: 'Odd', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'], maker: 'acme' },
    ])
  })
})

describe('the picture field', () => {
  it('goes out as image_urls when the endpoint takes a list', () => {
    const body = { prompt: 'p', image_url: 'data:image/png;base64,AA' }
    const listOnly = { properties: [{ name: 'image_urls', type: 'other' as const, required: true }] }
    expect(coerceBody(body, listOnly)).toEqual({ prompt: 'p', image_urls: ['data:image/png;base64,AA'] })
    const single = { properties: [{ name: 'image_url', type: 'string' as const, required: true }] }
    expect(coerceBody(body, single)).toEqual(body)
    expect(coerceBody({ prompt: 'p' }, listOnly)).toEqual({ prompt: 'p' })
  })
})

/** An OpenAPI document shaped like fal's: catalogue thumbnail in info, an input example picture, and the output example. */
function documentWith(output: unknown, extra: Record<string, unknown> = {}) {
  return {
    info: { 'x-fal-metadata': { thumbnailUrl: 'https://v3b.fal.media/thumb.jpg' } },
    components: {
      schemas: {
        AcmeInput: {
          properties: { prompt: { type: 'string' }, image_url: { type: 'string', examples: ['https://storage/input-picture.png'] } },
          required: ['prompt'],
        },
        AcmeOutput: output,
        File: { properties: { url: { type: 'string' } } },
      },
    },
    ...extra,
  }
}

const VIDEO_OUTPUT = {
  properties: {
    video: { $ref: '#/components/schemas/File', examples: [{ url: 'https://v3b.fal.media/files/b/out.mp4', content_type: 'video/mp4', file_name: 'out.mp4' }] },
  },
}

describe('example outputs', () => {
  it('reads the response schema\'s example, by its stated type', () => {
    expect(exampleOutput(documentWith(VIDEO_OUTPUT), 'video')).toEqual({ url: 'https://v3b.fal.media/files/b/out.mp4', mediaType: 'video/mp4' })
    const audio = documentWith({ properties: { audio: { examples: [{ url: 'https://storage/example_outputs/music', content_type: 'audio/mpeg' }] } } })
    expect(exampleOutput(audio, 'audio')).toEqual({ url: 'https://storage/example_outputs/music', mediaType: 'audio/mpeg' })
  })

  it('reads an example written as a bare URL string, after any file object', () => {
    const bare = documentWith({ properties: { audio: { examples: ['https://v3.fal.media/files/zebra/clip.wav'] }, seed: { type: 'integer' } } })
    expect(exampleOutput(bare, 'audio')).toEqual({ url: 'https://v3.fal.media/files/zebra/clip.wav', mediaType: 'audio/wav' })
    const both = documentWith({ properties: { a: { examples: ['https://x/first.mp3'] }, b: { examples: [{ url: 'https://x/object', content_type: 'audio/mpeg' }] } } })
    expect(exampleOutput(both, 'audio')).toEqual({ url: 'https://x/object', mediaType: 'audio/mpeg' })
  })

  it('reads the extension when no type is stated, and skips files of another kind', () => {
    const images = documentWith({ properties: { images: { examples: [[{ url: 'https://storage/a.json' }, { url: 'https://storage/out.PNG?x=1' }]] } } })
    expect(exampleOutput(images, 'image')).toEqual({ url: 'https://storage/out.PNG?x=1', mediaType: 'image/png' })
    expect(exampleOutput(documentWith(VIDEO_OUTPUT), 'audio')).toBeUndefined()
  })

  it('falls back to a fitting URL elsewhere, never the info thumbnail or an input example', () => {
    const empty = { properties: { image: { $ref: '#/components/schemas/File' } } }
    expect(exampleOutput(documentWith(empty), 'image')).toBeUndefined()
    const elsewhere = documentWith(empty, { paths: { '/acme': { get: { responses: { 200: { content: { 'application/json': { example: { image: 'https://storage/sample.webp' } } } } } } } } })
    expect(exampleOutput(elsewhere, 'image')).toEqual({ url: 'https://storage/sample.webp', mediaType: 'image/webp' })
  })

  it('ignores anything that is not https, and documents that are not objects', () => {
    expect(exampleOutput(documentWith({ properties: { video: { examples: [{ url: 'http://plain/out.mp4' }, { url: 'javascript:x.mp4' }] } } }), 'video')).toBeUndefined()
    expect(exampleOutput(null, 'video')).toBeUndefined()
    expect(exampleOutput('x', 'video')).toBeUndefined()
  })

  it('keeps an animated thumbnail when the catalogue row has one', () => {
    const [model] = liveModelsFrom({ models: [row('acme/clip', 'text-to-video', {
      thumbnail_url: 'https://x/still.jpg', thumbnail_animated_url: 'https://x/moving.mp4',
    })] }, CATEGORIES)
    expect(model?.thumbnailAnimatedUrl).toBe('https://x/moving.mp4')
    const [plain] = liveModelsFrom({ models: [row('acme/clip', 'text-to-video', { thumbnail_animated_url: 'ftp://x' })] }, CATEGORIES)
    expect(plain).not.toHaveProperty('thumbnailAnimatedUrl')
  })
})

describe('the example lookup', () => {
  /** A queue backend whose catalogue holds one video model, serving one schema document. */
  function exampleBackend(document: unknown, cachedInputs?: (id: string) => InputSchema | undefined) {
    const calls: string[] = []
    const recorded: { id: string; schema: InputSchema }[] = []
    const backend = createQueueBackend({
      id: FAL.id, name: FAL.name, baseUrl: 'https://catalog', queueUrl: 'https://queue', categories: CATEGORIES, auth: FAL.auth!,
      timeoutMs: 5_000, pollIntervalMs: 1, retryDelayMs: 1,
      credential: { displayName: 'fal.ai', env: 'FAL_KEY' },
      resolveApiKey: () => Promise.resolve(undefined),
      cached: [{ id: 'acme/clip', name: 'Clip', artefact: 'video', inputModalities: ['text'], outputMediaTypes: ['video/*'] }],
      inputSchemaUrl: 'https://schema/?endpoint_id={id}',
      ...cachedInputs === undefined ? {} : { cachedInputs },
      onInputSchema: (id, schema) => recorded.push({ id, schema }),
      fetchImpl: (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls.push(url)
        if (url.startsWith('https://schema/')) return Promise.resolve(Response.json(document))
        return Promise.resolve(Response.json({ models: [], has_more: false }))
      },
    })
    return { backend, calls, recorded }
  }

  it('reads nothing up front, fetches a model\'s document once on first ask, and records the example with its schema', async () => {
    const { backend, calls, recorded } = exampleBackend(documentWith(VIDEO_OUTPUT))
    await backend.refresh()
    expect(calls.some(url => url.startsWith('https://schema/'))).toBe(false)
    const example = { url: 'https://v3b.fal.media/files/b/out.mp4', mediaType: 'video/mp4' }
    expect(await backend.example('acme/clip')).toEqual(example)
    expect(await backend.example('acme/clip')).toEqual(example)
    expect(calls.filter(url => url.startsWith('https://schema/'))).toEqual(['https://schema/?endpoint_id=acme/clip'])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]!.schema.example).toEqual(example)
    expect(recorded[0]!.schema.properties.map(property => property.name)).toEqual(['prompt', 'image_url'])
    // The inputs read the same schema without fetching again.
    await backend.inputs('acme/clip')
    expect(calls.filter(url => url.startsWith('https://schema/'))).toHaveLength(1)
  })

  it('remembers that a model has no example', async () => {
    const { backend, calls, recorded } = exampleBackend(documentWith({ properties: {} }))
    expect(await backend.example('acme/clip')).toBeUndefined()
    expect(await backend.example('acme/clip')).toBeUndefined()
    expect(calls.filter(url => url.startsWith('https://schema/'))).toHaveLength(1)
    expect(recorded[0]!.schema.example).toBeNull()
  })

  it('answers from a cached schema that has looked, and reads again one cached before examples existed', async () => {
    const looked = exampleBackend(documentWith(VIDEO_OUTPUT), () => ({ properties: [], example: { url: 'https://cached/out.mp4', mediaType: 'video/mp4' } }))
    expect(await looked.backend.example('acme/clip')).toEqual({ url: 'https://cached/out.mp4', mediaType: 'video/mp4' })
    expect(looked.calls).toHaveLength(0)
    const older = exampleBackend(documentWith(VIDEO_OUTPUT), () => ({ properties: [] }))
    expect(await older.backend.example('acme/clip')).toEqual({ url: 'https://v3b.fal.media/files/b/out.mp4', mediaType: 'video/mp4' })
    expect(older.calls).toHaveLength(1)
  })

  it('answers nothing for a model outside the catalogue', async () => {
    const { backend } = exampleBackend(documentWith(VIDEO_OUTPUT))
    expect(await backend.example('acme/unknown')).toBeUndefined()
  })

  it('caches the example beside the input schema on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idealize-example-'))
    try {
      writeInputSchemaCache(dir, 'fal', 'acme/clip', { properties: [], example: { url: 'https://x/out.mp4', mediaType: 'video/mp4' } })
      expect(readInputSchemaCache(dir, 'fal', 'acme/clip')?.example).toEqual({ url: 'https://x/out.mp4', mediaType: 'video/mp4' })
      writeInputSchemaCache(dir, 'fal', 'acme/none', { properties: [], example: null })
      expect(readInputSchemaCache(dir, 'fal', 'acme/none')?.example).toBeNull()
      writeInputSchemaCache(dir, 'fal', 'acme/old', { properties: [] })
      expect(readInputSchemaCache(dir, 'fal', 'acme/old')).not.toHaveProperty('example')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

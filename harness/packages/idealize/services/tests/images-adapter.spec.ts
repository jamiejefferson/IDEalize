import { afterEach, describe, expect, it, vi } from 'vitest'
import { GENERATION_SCHEMA_VERSION, isGenerationError } from '@idealize/generate'
import type { GenerationProgress, GenerationRequest, GenModelInfo } from '@idealize/generate'
import { createImagesBackend } from '../src/adapters/images.ts'
import { artefactOf, fromImagesModel, liveModelsFrom, mergeCatalog } from '../src/adapters/images-catalog.ts'
import {
  chatMediaPayload, classifyFailureMessage, classifyStatus, outputsFromChatResponse, parseDataUrl,
} from '../src/adapters/images-api.ts'

/** The audio rows a previous run's cache would hold; nothing is compiled in. */
const CACHED_AUDIO: readonly GenModelInfo[] = [
  { id: 'openai/gpt-audio', name: 'OpenAI: GPT Audio', artefact: 'audio', inputModalities: ['text', 'audio'], outputMediaTypes: ['audio/*'] },
  { id: 'google/lyria-3-pro-preview', name: 'Google: Lyria 3 Pro (preview)', artefact: 'audio', inputModalities: ['text', 'image'], outputMediaTypes: ['audio/*'] },
]

const LIVE_BODY = {
  data: [
    { id: 'plain/chat', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    {
      id: 'google/gemini-3-pro-image',
      name: 'Google: Gemini 3 Pro Image',
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image', 'text'] },
    },
    {
      id: 'google/lyria-3-pro-preview',
      name: 'Google: Lyria 3 Pro',
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text', 'audio'] },
    },
    {
      id: 'acme/motion-1',
      name: 'Acme Motion',
      architecture: { input_modalities: ['text'], output_modalities: ['text', 'video'] },
    },
    { architecture: { output_modalities: ['image'] } },
    { id: 'no-architecture' },
  ],
}

function request(model: string, overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    taskIntent: 'generate-audio',
    requiredCapabilities: [{ operation: 'generate', artefact: 'audio', inputModalities: ['text'] }],
    model: { backend: 'openrouter', model },
    prompt: 'a short jingle',
    ...overrides,
  }
}

describe('catalogue mapping', () => {
  it('keeps only media-generating rows, typed by their richest output modality', () => {
    const models = liveModelsFrom(LIVE_BODY)
    expect(models.map(model => `${model.artefact}:${model.id}`)).toEqual([
      'image:google/gemini-3-pro-image',
      'audio:google/lyria-3-pro-preview',
      'video:acme/motion-1',
    ])
    expect(models[0]!.inputModalities).toEqual(['image', 'text'])
  })

  it('returns empty for bodies without a data array', () => {
    expect(liveModelsFrom(undefined)).toEqual([])
    expect(liveModelsFrom({ data: 'nope' })).toEqual([])
  })

  it('artefactOf prefers video over audio over image', () => {
    expect(artefactOf(['text'])).toBeUndefined()
    expect(artefactOf(['image', 'audio', 'video'])).toBe('video')
    expect(artefactOf(['image', 'audio'])).toBe('audio')
  })

  it('mergeCatalog lets live rows replace shipped ids and keeps unlisted shipped rows', () => {
    const shipped: GenModelInfo[] = [
      { id: 'a', name: 'shipped a', artefact: 'audio', inputModalities: ['text'], outputMediaTypes: ['audio/*'] },
      { id: 'b', name: 'shipped b', artefact: 'audio', inputModalities: ['text'], outputMediaTypes: ['audio/*'] },
    ]
    const live: GenModelInfo[] = [
      { id: 'b', name: 'live b', artefact: 'audio', inputModalities: ['text', 'audio'], outputMediaTypes: ['audio/*'] },
      { id: 'c', name: 'live c', artefact: 'audio', inputModalities: ['text'], outputMediaTypes: ['audio/*'] },
    ]
    const merged = mergeCatalog(shipped, live)
    expect(merged.map(model => `${model.id}:${model.name}`)).toEqual(['a:shipped a', 'b:live b', 'c:live c'])
  })
})

describe('wire translation', () => {
  it('builds a prompt-only payload with the artefact modality', () => {
    expect(chatMediaPayload(request('m'), 'audio')).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'a short jingle' }],
      modalities: ['text', 'audio'],
    })
    expect(chatMediaPayload(request('m'), 'video')).toMatchObject({ modalities: ['text', 'video'] })
  })

  it('carries image and audio attachments as content parts and passes settings through', () => {
    const payload = chatMediaPayload(request('m', {
      attachments: [
        { mediaType: 'image/png', data: 'IMG' },
        { mediaType: 'audio/wav', data: 'AUD' },
      ],
      settings: { audio: { voice: 'alloy' } },
    }), 'audio')
    expect(payload).toMatchObject({ audio: { voice: 'alloy' } })
    const content = (payload.messages as { content: unknown }[])[0]!.content
    expect(content).toEqual([
      { type: 'text', text: 'a short jingle' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,IMG' } },
      { type: 'input_audio', input_audio: { data: 'AUD', format: 'wav' } },
    ])
  })

  it('reads audio data and image data URLs out of a chat response', () => {
    expect(outputsFromChatResponse({
      choices: [{
        message: {
          audio: { data: 'AUDIO64', format: 'wav' },
          images: [{ image_url: { url: 'data:image/png;base64,IMG64' } }, { image_url: { url: 'https://x/y.png' } }],
        },
      }],
    })).toEqual([
      { mediaType: 'audio/wav', data: 'AUDIO64' },
      { mediaType: 'image/png', data: 'IMG64' },
    ])
    expect(outputsFromChatResponse({ choices: [{ message: {} }] })).toEqual([])
    expect(parseDataUrl('not-a-data-url')).toBeUndefined()
  })
})

describe('what the wire refuses to carry', () => {
  it('leaves an attachment that is neither image nor audio out of the payload', () => {
    const payload = chatMediaPayload(request('m', {
      attachments: [{ mediaType: 'application/pdf', data: 'PDF' }],
    }), 'audio')
    expect(payload.messages).toEqual([{ role: 'user', content: 'a short jingle' }])
  })

  it('takes audio with no format as raw bytes, and skips an image row naming no url', () => {
    expect(outputsFromChatResponse({ choices: [{ message: { audio: { data: 'AUD' } } }] }))
      .toEqual([{ mediaType: 'application/octet-stream', data: 'AUD' }])
    expect(outputsFromChatResponse({ choices: [{ message: { images: [{ image_url: { url: 7 } }, null] } }] }))
      .toEqual([])
  })

  it('skips a catalogue row that is not an object, and names an unnamed one by its id', () => {
    expect(liveModelsFrom({ data: [null] })).toEqual([])
    const [row] = liveModelsFrom({
      data: [{ id: 'acme/one', architecture: { input_modalities: ['text'], output_modalities: ['image'] } }],
    })
    expect(row).toMatchObject({ id: 'acme/one', name: 'acme/one' })
  })
})

describe('failure classification', () => {
  it('maps statuses onto the shared code union', () => {
    expect(classifyStatus(401)).toBe('AUTH')
    expect(classifyStatus(403)).toBe('AUTH')
    expect(classifyStatus(402)).toBe('QUOTA')
    expect(classifyStatus(408)).toBe('TIMEOUT')
    expect(classifyStatus(429)).toBe('RATE_LIMIT')
    expect(classifyStatus(422)).toBe('INVALID_REQUEST')
    expect(classifyStatus(500)).toBe('PROVIDER_ERROR')
  })

  it('maps in-band failure messages onto the shared code union', () => {
    expect(classifyFailureMessage('The operation was aborted')).toBe('ABORTED')
    expect(classifyFailureMessage('Request timed out')).toBe('TIMEOUT')
    expect(classifyFailureMessage('401 Unauthorized: invalid API key')).toBe('AUTH')
    expect(classifyFailureMessage('Insufficient credits')).toBe('QUOTA')
    expect(classifyFailureMessage('Rate limit exceeded')).toBe('RATE_LIMIT')
    expect(classifyFailureMessage('something odd')).toBe('PROVIDER_ERROR')
  })
})

interface FetchCall {
  url: string
  init?: RequestInit
}

function stubFetch(respond: (url: string) => Response): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = []
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.href
    calls.push({ url: target, ...init === undefined ? {} : { init } })
    return Promise.resolve(respond(target))
  }) as typeof fetch
  return { calls, fetchImpl }
}

function backendWith(
  respond: (url: string) => Response, apiKey = 'sk-test',
  extra: { cached?: readonly GenModelInfo[]; onCatalog?: (models: readonly GenModelInfo[]) => void } = {},
) {
  const { calls, fetchImpl } = stubFetch(respond)
  const backend = createImagesBackend({
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.test/api/v1',
    timeoutMs: 5000,
    resolveApiKey: () => Promise.resolve(apiKey),
    fetchImpl,
    cached: CACHED_AUDIO,
    ...extra,
  })
  return { backend, calls }
}

describe('createImagesBackend', () => {
  it('carries the vendored library\'s image shapes plus whatever the cache held', () => {
    const { backend } = backendWith(() => new Response('{}'))
    const models = backend.models()
    expect(models.some(model => model.artefact === 'image')).toBe(true)
    for (const cached of CACHED_AUDIO) {
      expect(models.some(model => model.id === cached.id)).toBe(true)
    }
  })

  it('offers only the library\'s image shapes on a first run, with no cache to read', () => {
    const { calls, fetchImpl } = stubFetch(() => new Response('{}'))
    const fresh = createImagesBackend({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.test/api/v1',
      timeoutMs: 5000,
      resolveApiKey: () => Promise.resolve('sk-test'),
      fetchImpl,
    })
    expect(fresh.models().every(model => model.artefact === 'image')).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('hands a freshly fetched catalogue to its owner, which is what the cache records', async () => {
    const written: (readonly GenModelInfo[])[] = []
    const { backend } = backendWith(
      url => url.endsWith('/models') ? Response.json(LIVE_BODY) : new Response('{}', { status: 500 }),
      'sk-test',
      { onCatalog: (models) => { written.push(models) } },
    )
    await backend.refresh()
    expect(written).toHaveLength(1)
    expect(written[0]?.map(model => model.id)).toContain('google/lyria-3-pro-preview')
  })

  it('describes one capability per artefact, and a refresh is what reads the credential', async () => {
    // Before the first refresh nothing is known about the key, so every
    // descriptor is unavailable; the refresh is the only thing that reads it,
    // which is how a key pasted after start-up reaches the descriptors.
    const { backend } = backendWith(url => (url.endsWith('/models') ? Response.json(LIVE_BODY) : new Response('{}')))
    expect(backend.describe().every(descriptor => descriptor.availability === 'no-credential')).toBe(true)
    await backend.refresh()
    const described = backend.describe()
    expect(described.map(descriptor => descriptor.artefact).sort()).toEqual(['audio', 'image', 'video'])
    expect(described.every(descriptor => descriptor.availability === 'available')).toBe(true)
  })

  it('goes back to no-credential when the key has been cleared', async () => {
    const { backend } = backendWith(url => (url.endsWith('/models') ? Response.json(LIVE_BODY) : new Response('{}')), '')
    await backend.refresh()
    expect(backend.describe().every(descriptor => descriptor.availability === 'no-credential')).toBe(true)
  })

  it('refresh merges the live catalogue over what was known (new models appear, no code change)', async () => {
    const { backend } = backendWith(url =>
      url.endsWith('/models') ? Response.json(LIVE_BODY) : new Response('{}', { status: 500 }))
    await backend.refresh()
    const models = backend.models()
    expect(models.some(model => model.id === 'acme/motion-1' && model.artefact === 'video')).toBe(true)
    expect(models.find(model => model.id === 'google/lyria-3-pro-preview')?.name).toBe('Google: Lyria 3 Pro')
    expect(models.some(model => model.id === 'openai/gpt-audio')).toBe(true)
  })

  it('generates audio through chat completions with the key in the header', async () => {
    const { backend, calls } = backendWith(url =>
      url.endsWith('/chat/completions')
        ? Response.json({ choices: [{ message: { audio: { data: 'AUDIO64', format: 'wav' } } }], usage: { total_tokens: 9 } })
        : new Response('{}', { status: 500 }))
    const phases: GenerationProgress['phase'][] = []
    const result = await backend.generate(
      request('openai/gpt-audio'),
      progress => phases.push(progress.phase),
      new AbortController().signal,
    )
    expect(result.artefact).toBe('audio')
    expect(result.outputs).toEqual([{ mediaType: 'audio/wav', data: 'AUDIO64' }])
    expect(result.usage).toEqual({ total_tokens: 9 })
    expect(phases).toEqual(['queued', 'sending', 'receiving', 'done'])
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
  })

  it('refuses without a stored key', async () => {
    const backend = createImagesBackend({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.test/api/v1',
      timeoutMs: 5000,
      resolveApiKey: () => Promise.resolve(undefined),
      fetchImpl: stubFetch(() => new Response('{}')).fetchImpl,
      cached: CACHED_AUDIO,
    })
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('MISSING_CREDENTIAL')
  })

  it('translates HTTP refusals with status and retry-after', async () => {
    const { backend } = backendWith(() =>
      new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }))
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('RATE_LIMIT')
    expect(isGenerationError(failure) && failure.status).toBe(429)
    expect(isGenerationError(failure) && failure.retryAfterMs).toBe(7000)
  })

  it('reports NO_MODEL for an id outside the catalogue', async () => {
    const { backend } = backendWith(() => new Response('{}'))
    const failure = await backend
      .generate(request('unknown/model'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('NO_MODEL')
  })

  it('treats a media-free response as a provider error', async () => {
    const { backend } = backendWith(() => Response.json({ choices: [{ message: { content: 'no audio here' } }] }))
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
  })
})

// Free, keyless models listing against the real API; runs only when a key is
// configured so keyless CI stays offline.
describe.runIf(typeof process.env.OPENROUTER_API_KEY === 'string' && process.env.OPENROUTER_API_KEY !== '')(
  'live catalogue smoke',
  () => {
    it('lists media models from the live catalogue', async () => {
      const backend = createImagesBackend({
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        timeoutMs: 30_000,
        resolveApiKey: () => Promise.resolve(process.env.OPENROUTER_API_KEY),
      })
      await backend.refresh()
      const models = backend.models()
      expect(models.some(model => model.artefact === 'image')).toBe(true)
      expect(models.some(model => model.artefact === 'audio')).toBe(true)
    })
  },
)

/**
 * The image half runs through the vendored pi-ai provider, which reaches the
 * network through the global fetch rather than the adapter's injected one.
 */
describe('generating an image', () => {
  const IMAGE_MODEL: GenModelInfo = {
    id: 'acme/painter-1',
    name: 'Acme Painter',
    artefact: 'image',
    inputModalities: ['text', 'image', 'audio'],
    outputMediaTypes: ['image/*'],
  }

  function imageBackend(reply: () => Response) {
    vi.stubGlobal('fetch', () => Promise.resolve(reply()))
    return createImagesBackend({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.test/api/v1',
      timeoutMs: 5000,
      resolveApiKey: () => Promise.resolve('sk-test'),
      fetchImpl: stubFetch(() => new Response('{}')).fetchImpl,
      cached: [IMAGE_MODEL],
    })
  }

  function imageRequest(model: string, overrides: Partial<GenerationRequest> = {}): GenerationRequest {
    return request(model, {
      taskIntent: 'generate-image',
      requiredCapabilities: [{ operation: 'generate', artefact: 'image', inputModalities: ['text'] }],
      ...overrides,
    })
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('sends the prompt with its image attachments and returns the decoded bytes', async () => {
    const backend = imageBackend(() => Response.json({
      id: 'gen-1',
      choices: [{ message: { content: '', images: [{ image_url: { url: 'data:image/png;base64,PNG64' } }] } }],
    }))
    const phases: GenerationProgress['phase'][] = []
    const result = await backend.generate(
      imageRequest('acme/painter-1', {
        attachments: [{ mediaType: 'image/png', data: 'REF' }, { mediaType: 'audio/wav', data: 'AUD' }],
      }),
      progress => phases.push(progress.phase),
      new AbortController().signal,
    )
    expect(result.artefact).toBe('image')
    expect(result.outputs).toEqual([{ mediaType: 'image/png', data: 'PNG64' }])
    expect(result.usage).toBeUndefined()
    expect(phases).toEqual(['queued', 'sending', 'receiving', 'done'])
  })

  it('drives a model the vendored library ships without inventing one', async () => {
    const backend = imageBackend(() => Response.json({
      choices: [{ message: { images: [{ image_url: { url: 'data:image/webp;base64,WEBP' } }] } }],
    }))
    const shipped = backend.models().find(model => model.artefact === 'image' && model.id !== IMAGE_MODEL.id)
    expect(shipped).toBeDefined()
    const result = await backend.generate(imageRequest(shipped!.id), () => {}, new AbortController().signal)
    expect(result.outputs).toEqual([{ mediaType: 'image/webp', data: 'WEBP' }])
  })

  it('reports a provider refusal under the code its message names', async () => {
    const backend = imageBackend(() => new Response(JSON.stringify({ error: { message: '401 Unauthorized: invalid API key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }))
    const failure = await backend
      .generate(imageRequest('acme/painter-1'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('AUTH')
  })

  it('reports an abort as an abort rather than a provider failure', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', () => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    })
    const backend = createImagesBackend({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.test/api/v1',
      timeoutMs: 5000,
      resolveApiKey: () => Promise.resolve('sk-test'),
      cached: [IMAGE_MODEL],
    })
    const failure = await backend
      .generate(imageRequest('acme/painter-1'), () => {}, controller.signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('ABORTED')
  })

  it('treats an image-free response as a provider error', async () => {
    const backend = imageBackend(() => Response.json({ choices: [{ message: { content: 'no picture' } }] }))
    const failure = await backend
      .generate(imageRequest('acme/painter-1'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
  })
})

describe('what the adapter reports when the surroundings fail', () => {
  it('reports a credential store that could not be read as a missing credential', async () => {
    const backend = createImagesBackend({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.test/api/v1',
      timeoutMs: 5000,
      resolveApiKey: () => Promise.reject(new Error('the keychain is locked')),
      fetchImpl: stubFetch(() => new Response('{}')).fetchImpl,
      cached: CACHED_AUDIO,
    })
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('MISSING_CREDENTIAL')
  })

  it('refuses a catalogue request the service turned down', async () => {
    const { backend } = backendWith(() => new Response('nope', { status: 503 }))
    const failure = await backend.refresh().catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
    expect(isGenerationError(failure) && failure.status).toBe(503)
  })

  it('names a bodiless refusal without a trailing colon, and ignores an unreadable retry-after', async () => {
    const { backend } = backendWith(() => new Response('', { status: 500, headers: { 'retry-after': 'soon' } }))
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.message).toBe('OpenRouter refused the audio generation (500)')
    expect(isGenerationError(failure) && failure.retryAfterMs).toBeUndefined()
  })

  it('reports a send that never reached the service as a provider error', async () => {
    const { backend } = backendWith(() => { throw new Error('connection refused') })
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
  })

  it('reports a send the caller aborted as an abort', async () => {
    const controller = new AbortController()
    const { backend } = backendWith(() => {
      controller.abort()
      throw new Error('aborted')
    })
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, controller.signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('ABORTED')
  })

  it('reports a service that answered nothing in time as a timeout', async () => {
    const { backend } = backendWith(() => { throw new DOMException('timed out', 'TimeoutError') })
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('TIMEOUT')
  })

  it('carries no usage when the response states none', async () => {
    const { backend } = backendWith(() =>
      Response.json({ choices: [{ message: { audio: { data: 'A', format: 'wav' } } }] }))
    const result = await backend.generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
    expect(result.usage).toBeUndefined()
  })
})

describe('the vendored library catalogue', () => {
  it('names a model the library left unnamed by its id', () => {
    expect(fromImagesModel({
      id: 'acme/unnamed',
      name: '',
      api: 'openrouter-images',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.test/api/v1',
      input: ['text'],
      output: ['image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })).toMatchObject({ id: 'acme/unnamed', name: 'acme/unnamed', artefact: 'image' })
  })
})

describe('what the backend declares to the registry', () => {
  it('carries the credential the service directory named', () => {
    const backend = createImagesBackend({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.test/api/v1',
      timeoutMs: 5000,
      credential: { displayName: 'OpenRouter API key', env: 'OPENROUTER_API_KEY' },
      resolveApiKey: () => Promise.resolve('sk-test'),
      fetchImpl: stubFetch(() => new Response('{}')).fetchImpl,
    })
    expect(backend.credential).toEqual({ displayName: 'OpenRouter API key', env: 'OPENROUTER_API_KEY' })
  })

  it('names a refusal whose body could not be read by its status alone', async () => {
    const { backend } = backendWith(() => new Response(
      new ReadableStream({ start(controller) { controller.error(new Error('the connection dropped')) } }),
      { status: 502 },
    ))
    const failure = await backend
      .generate(request('openai/gpt-audio'), () => {}, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.message).toBe('OpenRouter refused the audio generation (502)')
  })
})

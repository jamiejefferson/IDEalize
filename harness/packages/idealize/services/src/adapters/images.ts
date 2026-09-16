/**
 * The images adapter: a media service that speaks the OpenAI images and
 * chat-completions shapes. Images run through the vendored pi-ai openrouter
 * images provider; audio (and video, when the catalogue offers it) runs
 * through the chat-completions endpoint with `modalities`. `refresh()` merges
 * the live keyless `/models` list over what is already known. Provider
 * failures are translated into GenerationError codes; raw provider errors
 * never escape.
 *
 * The service's identity, endpoint and credential arrive as data from the
 * service directory. The wire shapes do not: this adapter is written to
 * OpenRouter's, which is the only service the app has evidence for, and a
 * service that answers differently needs its own adapter rather than options
 * on this one.
 * @module @idealize/services/adapters/images
 */

import type { ImagesContext, ImagesModel, ImagesProvider } from '@earendil-works/pi-ai'
import { openrouterImagesProvider } from '@earendil-works/pi-ai/providers/openrouter-images'
import {
  GENERATION_SCHEMA_VERSION,
  GenerationError,
} from '@idealize/generate'
import type {
  BackendCredential,
  CapabilityDescriptor,
  GenArtefact,
  GenerationBackend,
  GenerationOutput,
  GenerationProgressSink,
  GenerationRequest,
  GenModelInfo,
} from '@idealize/generate'
import {
  chatMediaPayload,
  classifyFailureMessage,
  classifyStatus,
  outputsFromChatResponse,
} from './images-api.ts'
import { defaultMediaTypes, fromImagesModel, liveModelsFrom, mergeCatalog } from './images-catalog.ts'

/** Construction options for {@link createImagesBackend}. */
export interface ImagesBackendOptions {
  /** Registry id — the `provider` half of stored model choices. */
  id: string
  /** The service's own name for itself, used in every message the person can read. */
  name: string
  /** API origin including its version segment, no trailing slash. */
  baseUrl: string
  /** Per-request timeout in milliseconds. */
  timeoutMs: number
  /** The key the person pastes under Brains: its display name and credential environment name. */
  credential?: BackendCredential
  /** Resolve the API key per operation (the credentials seam's re-resolve rule). */
  resolveApiKey(): Promise<string | undefined>
  /** The catalogue this service last gave, read from disk; empty on a first run. */
  cached?: readonly GenModelInfo[]
  /** Record a freshly fetched catalogue; the adapter never decides where it goes. */
  onCatalog?(models: readonly GenModelInfo[]): void
  /** Fetch used for the catalogue and the chat endpoint; injectable for keyless tests. */
  fetchImpl?: typeof fetch
}

/** The backend plus its adapter-side control: the catalogue refresh. */
export interface ImagesBackend extends GenerationBackend {
  refresh(): Promise<void>
}

/** Group a model list into one descriptor per artefact present. */
function describeModels(models: readonly GenModelInfo[], available: boolean): CapabilityDescriptor[] {
  const byArtefact = new Map<GenArtefact, GenModelInfo[]>()
  for (const model of models) {
    const group = byArtefact.get(model.artefact) ?? []
    group.push(model)
    byArtefact.set(model.artefact, group)
  }
  return [...byArtefact.entries()].map(([artefact, group]) => ({
    operation: 'generate',
    artefact,
    inputModalities: [...new Set(group.flatMap(model => model.inputModalities))],
    outputMediaTypes: defaultMediaTypes(artefact),
    availability: available ? 'available' : 'no-credential',
    schemaVersion: GENERATION_SCHEMA_VERSION,
  }))
}

/**
 * Create one images-shaped media backend.
 * @param options - the service's identity, endpoint, timeout, credential resolution, cached catalogue, and test fetch.
 * @returns the backend to register with `ctx.generation`.
 */
export function createImagesBackend(options: ImagesBackendOptions): ImagesBackend {
  const fetchImpl = options.fetchImpl ?? fetch
  const imagesProvider: ImagesProvider = openrouterImagesProvider()

  // The vendored provider's own image catalogue is not a snapshot this app
  // keeps: it travels with the library, and describes the shapes that library
  // can drive. Everything else comes from the cache the last live fetch wrote.
  const providerImages = imagesProvider.getModels().map(fromImagesModel)
  const cachedById = new Map((options.cached ?? []).map(model => [model.id, model]))
  let imageModels: readonly GenModelInfo[] = mergeCatalog(
    providerImages, [...cachedById.values()].filter(model => model.artefact === 'image'),
  )
  let mediaModels: readonly GenModelInfo[] = [...cachedById.values()].filter(model => model.artefact !== 'image')
  let credentialConfigured = false

  const allModels = (): GenModelInfo[] => [...imageModels, ...mediaModels]

  const resolveKey = async (): Promise<string> => {
    let key: string | undefined
    try {
      key = await options.resolveApiKey()
    } catch (error) {
      throw new GenerationError(`the ${options.name} API key could not be resolved`, 'MISSING_CREDENTIAL', { cause: error })
    }
    if (key === undefined || key === '') {
      throw new GenerationError(
        `no ${options.name} API key is stored; paste one under Brains`,
        'MISSING_CREDENTIAL',
      )
    }
    return key
  }

  const generateImage = async (
    info: GenModelInfo,
    request: GenerationRequest,
    onProgress: GenerationProgressSink,
    signal: AbortSignal,
    key: string,
  ): Promise<GenerationOutput[]> => {
    const known = imagesProvider.getModels().find(model => model.id === info.id)
    const model: ImagesModel<string> = known ?? {
      id: info.id,
      name: info.name,
      api: 'openrouter-images',
      provider: options.id,
      baseUrl: options.baseUrl,
      input: info.inputModalities.filter((m): m is 'text' | 'image' => m === 'text' || m === 'image'),
      output: ['image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    const context: ImagesContext = {
      input: [
        { type: 'text', text: request.prompt },
        ...(request.attachments ?? [])
          .filter(attachment => attachment.mediaType.startsWith('image/'))
          .map(attachment => ({ type: 'image' as const, data: attachment.data, mimeType: attachment.mediaType })),
      ],
    }
    onProgress({ phase: 'sending' })
    const result = await imagesProvider.generateImages(model, context, {
      apiKey: key,
      signal,
      timeoutMs: options.timeoutMs,
    })
    if (result.stopReason === 'aborted') {
      throw new GenerationError('the image generation was aborted', 'ABORTED')
    }
    if (result.stopReason === 'error') {
      /* v8 ignore next -- the vendored provider formats every failure it reports, so an errored result always names one. */
      const message = result.errorMessage ?? 'image generation failed'
      throw new GenerationError(`${options.name} image generation failed: ${message}`, classifyFailureMessage(message))
    }
    onProgress({ phase: 'receiving' })
    return result.output
      .filter((content): content is { type: 'image'; data: string; mimeType: string } => content.type === 'image')
      .map(content => ({ mediaType: content.mimeType, data: content.data }))
  }

  const generateMedia = async (
    info: GenModelInfo,
    request: GenerationRequest,
    onProgress: GenerationProgressSink,
    signal: AbortSignal,
    key: string,
  ): Promise<{ outputs: GenerationOutput[]; usage?: Readonly<Record<string, unknown>> }> => {
    onProgress({ phase: 'sending' })
    let response: Response
    try {
      response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(chatMediaPayload(request, info.artefact)),
        signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      })
    } catch (error) {
      if (signal.aborted) throw new GenerationError(`the ${info.artefact} generation was aborted`, 'ABORTED', { cause: error })
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new GenerationError(`${options.name} did not answer within ${String(options.timeoutMs)}ms`, 'TIMEOUT', { cause: error })
      }
      throw new GenerationError(`the ${options.name} request failed to send`, 'PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      const retryAfter = Number(response.headers.get('retry-after'))
      throw new GenerationError(
        `${options.name} refused the ${info.artefact} generation (${String(response.status)})${detail === '' ? '' : `: ${detail}`}`,
        classifyStatus(response.status),
        {
          status: response.status,
          ...Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {},
        },
      )
    }
    onProgress({ phase: 'receiving' })
    const body: unknown = await response.json()
    const outputs = outputsFromChatResponse(body)
    if (outputs.length === 0) {
      throw new GenerationError(`the ${options.name} response carried no ${info.artefact} output`, 'PROVIDER_ERROR')
    }
    const usage = (body as { usage?: unknown }).usage
    return {
      outputs,
      ...typeof usage === 'object' && usage !== null ? { usage: usage as Readonly<Record<string, unknown>> } : {},
    }
  }

  return {
    id: options.id,
    ...options.credential === undefined ? {} : { credential: options.credential },
    describe: () => describeModels(allModels(), credentialConfigured),
    models: allModels,
    refresh: async () => {
      // The credential is read here, as the queue adapter reads it: a key
      // pasted after the app started reaches the descriptors only through a
      // refresh, and without this line the backend reported `no-credential`
      // for the life of the process however many keys were stored — so its
      // models never became selectable (JJ, 1 Sep 2026: "open router key
      // doesn't seem to have registered for that").
      credentialConfigured = await options.resolveApiKey().then(key => key !== undefined && key !== '', () => false)
      const response = await fetchImpl(`${options.baseUrl}/models`, {
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) {
        throw new GenerationError(
          `${options.name} refused the model catalogue request (${String(response.status)})`,
          classifyStatus(response.status),
          { status: response.status },
        )
      }
      const live = liveModelsFrom(await response.json())
      imageModels = mergeCatalog(providerImages, live.filter(model => model.artefact === 'image'))
      mediaModels = mergeCatalog(mediaModels, live.filter(model => model.artefact !== 'image'))
      options.onCatalog?.(allModels())
    },
    generate: async (request, onProgress, signal) => {
      const info = allModels().find(model => model.id === request.model.model)
      if (info === undefined) {
        throw new GenerationError(`${options.name} offers no model "${request.model.model}"`, 'NO_MODEL')
      }
      onProgress({ phase: 'queued' })
      const key = await resolveKey()
      let outputs: GenerationOutput[]
      let usage: Readonly<Record<string, unknown>> | undefined
      if (info.artefact === 'image') {
        outputs = await generateImage(info, request, onProgress, signal, key)
        if (outputs.length === 0) {
          throw new GenerationError(`the ${options.name} response carried no image output`, 'PROVIDER_ERROR')
        }
      } else {
        const media = await generateMedia(info, request, onProgress, signal, key)
        outputs = media.outputs
        usage = media.usage
      }
      onProgress({ phase: 'done' })
      return {
        schemaVersion: GENERATION_SCHEMA_VERSION,
        backend: options.id,
        model: info.id,
        artefact: info.artefact,
        outputs,
        ...usage === undefined ? {} : { usage },
        timestamp: Date.now(),
      }
    },
  }
}

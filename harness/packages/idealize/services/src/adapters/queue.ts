/**
 * The queue adapter: a media service whose generations run through a job
 * queue. `POST <queueUrl>/<endpoint>` enqueues the request, `status_url` is
 * polled until `COMPLETED`, `response_url` yields the result, and each result
 * file is downloaded into a base64 output. `refresh()` lists one live page per
 * category the service declares and re-reads whether a key is stored.
 * `inputs()` reads one endpoint's input schema from the service's OpenAPI
 * document, cached in memory and through the caller's disk callbacks, and the
 * same schema coerces each body to the wire types the endpoint names before
 * it is enqueued. Provider failures are translated into GenerationError codes;
 * raw provider errors never escape.
 *
 * Everything service-specific — the name in its messages, its endpoints, its
 * categories, the scheme its key is sent under — arrives as data from the
 * service directory, so a second queue-shaped service is a directory row
 * rather than a package.
 * @module @idealize/services/adapters/queue
 */

import { GENERATION_SCHEMA_VERSION, GenerationError } from '@idealize/generate'
import type {
  BackendCredential,
  CapabilityDescriptor,
  GenArtefact,
  GenerationBackend,
  GenerationOutput,
  GenerationProgressSink,
  GenInputField,
  GenModelInfo,
} from '@idealize/generate'
import { coerceBody, enumRetryValues, inputFieldsFrom, parseInputSchema } from './input-schema.ts'
import type { InputSchema } from './input-schema.ts'
import {
  classifyStatus, endpointFor, queuePayload, refusalReason, refusedFields, requiredFieldDefaults, resultFilesFrom,
} from './queue-api.ts'
import { defaultMediaTypes, liveModelsFrom, mergeCatalog } from './queue-catalog.ts'
import type { QueueCategory } from './queue-catalog.ts'

/** How a service wants its key presented on the wire. */
export interface ServiceAuth {
  /** Header the key is sent in. */
  header: string
  /** Text placed before the key, `''` when the key is sent bare. */
  prefix: string
}

/** Construction options for {@link createQueueBackend}. */
export interface QueueBackendOptions {
  /** Registry id — the `provider` half of stored model choices. */
  id: string
  /** The service's own name for itself, used in every message the person can read. */
  name: string
  /** Catalogue API origin including its version segment, no trailing slash. */
  baseUrl: string
  /** Queue API origin, no trailing slash. */
  queueUrl: string
  /** The catalogue categories to list, and what each implies. */
  categories: readonly QueueCategory[]
  /** How the key is presented on the wire. */
  auth: ServiceAuth
  /** Whole-generation timeout in milliseconds, enqueue to last download. */
  timeoutMs: number
  /** Milliseconds between status polls. */
  pollIntervalMs: number
  /** The key the person pastes under Brains: its display name and credential environment name. */
  credential: BackendCredential
  /** Resolve the API key per operation (the credentials seam's re-resolve rule). */
  resolveApiKey(): Promise<string | undefined>
  /** The catalogue this service last gave, read from disk; empty on a first run. */
  cached?: readonly GenModelInfo[]
  /** Record a freshly fetched catalogue; the adapter never decides where it goes. */
  onCatalog?(models: readonly GenModelInfo[]): void
  /**
   * Where the service publishes one endpoint's OpenAPI document, `{id}`
   * standing for the endpoint id. Absent when it publishes none: `inputs()`
   * then resolves empty and bodies go out as the seam built them.
   */
  inputSchemaUrl?: string
  /** The input schema this service last gave for an endpoint, read from disk; undefined on a first use. */
  cachedInputs?(modelId: string): InputSchema | undefined
  /** Record a freshly fetched input schema; the adapter never decides where it goes. */
  onInputSchema?(modelId: string, schema: InputSchema): void
  /** Fetch used for every request; injectable for keyless tests. */
  fetchImpl?: typeof fetch
}

/** The backend plus its adapter-side refresh and input-schema read. */
export interface QueueBackend extends GenerationBackend {
  refresh(): Promise<void>
  inputs(modelId: string): Promise<readonly GenInputField[]>
}

/**
 * Group a model list into one descriptor per artefact the service serves.
 *
 * The artefacts come from the service's declared categories, not from the
 * models it happens to have listed: a service with no catalogue yet still
 * makes what it makes, and the Add list and the space launcher read these
 * descriptors to say so.
 */
function describeModels(
  models: readonly GenModelInfo[], categories: readonly QueueCategory[], available: boolean,
): CapabilityDescriptor[] {
  const byArtefact = new Map<GenArtefact, GenModelInfo[]>()
  for (const category of categories) byArtefact.set(category.artefact, [])
  for (const model of models) {
    const group = byArtefact.get(model.artefact) ?? []
    group.push(model)
    byArtefact.set(model.artefact, group)
  }
  return [...byArtefact.entries()].map(([artefact, group]) => ({
    operation: 'generate',
    artefact,
    inputModalities: [...new Set(group.length === 0
      ? categories.filter(category => category.artefact === artefact).flatMap(category => category.inputModalities)
      : group.flatMap(model => model.inputModalities))],
    outputMediaTypes: defaultMediaTypes(artefact),
    availability: available ? 'available' : 'no-credential',
    schemaVersion: GENERATION_SCHEMA_VERSION,
  }))
}

/** The media type of one downloaded file: the result's stated type, else the response header, else the URL's extension. */
function mediaTypeOf(stated: string | undefined, header: string | null, url: string): string {
  if (stated !== undefined) return stated
  const fromHeader = header?.split(';')[0]?.trim()
  if (fromHeader !== undefined && fromHeader !== '' && fromHeader !== 'application/octet-stream') return fromHeader
  const extension = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase()
  const byExtension: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
  }
  return (extension === undefined ? undefined : byExtension[extension]) ?? 'application/octet-stream'
}

/**
 * Create one queue-shaped media backend.
 * @param options - the service's identity, endpoints, categories, auth, timeouts, credential resolution, cached catalogue, and test fetch.
 * @returns the backend to register with `ctx.generation`.
 */
export function createQueueBackend(options: QueueBackendOptions): QueueBackend {
  const fetchImpl = options.fetchImpl ?? fetch
  let models: readonly GenModelInfo[] = options.cached ?? []
  let credentialConfigured = false
  const schemas = new Map<string, InputSchema>()

  /**
   * One endpoint's input schema: memory, then the caller's disk cache, then
   * the service's document. Undefined when the service publishes no schema
   * URL or the document carries no input schema. Rejects when the fetch fails.
   */
  const schemaFor = async (modelId: string): Promise<InputSchema | undefined> => {
    const template = options.inputSchemaUrl
    if (template === undefined) return undefined
    const held = schemas.get(modelId) ?? options.cachedInputs?.(modelId)
    if (held !== undefined) {
      schemas.set(modelId, held)
      return held
    }
    const url = template.replace('{id}', modelId)
    let response: Response
    try {
      response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(options.timeoutMs) })
    } catch (error) {
      throw new GenerationError(`the ${options.name} input schema request for ${modelId} failed to send`, 'PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      throw new GenerationError(
        `${options.name} refused the input schema request for ${modelId} (${String(response.status)})`,
        classifyStatus(response.status),
        { status: response.status },
      )
    }
    const schema = parseInputSchema(await response.json().catch(() => null))
    if (schema === undefined) return undefined
    schemas.set(modelId, schema)
    options.onInputSchema?.(modelId, schema)
    return schema
  }

  const resolveKey = async (): Promise<string> => {
    let key: string | undefined
    try {
      key = await options.resolveApiKey()
    } catch (error) {
      throw new GenerationError(`the ${options.name} API key could not be resolved`, 'MISSING_CREDENTIAL', { cause: error })
    }
    if (key === undefined || key === '') {
      throw new GenerationError(`no ${options.name} API key is stored; paste one under Brains`, 'MISSING_CREDENTIAL')
    }
    return key
  }

  /** One request to the service, translating transport failures; the caller reads the response. */
  const send = async (url: string, init: RequestInit, signal: AbortSignal, what: string): Promise<Response> => {
    try {
      return await fetchImpl(url, { ...init, signal })
    } catch (error) {
      if (signal.aborted) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new GenerationError(`${options.name} did not finish within ${String(options.timeoutMs)}ms`, 'TIMEOUT', { cause: error })
        }
        throw new GenerationError('the generation was aborted', 'ABORTED', { cause: error })
      }
      throw new GenerationError(`the ${options.name} ${what} request failed to send`, 'PROVIDER_ERROR', { cause: error })
    }
  }

  /** The body of a refusal, `''` when it cannot be read. */
  const refusalText = (response: Response): Promise<string> => response.text().catch(() => '')

  /** Throw the GenerationError for a refused response; `text` is its body when the caller has already read it. */
  const refuse = async (response: Response, what: string, text?: string): Promise<never> => {
    const reason = refusalReason(text ?? await refusalText(response))
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new GenerationError(
      `${options.name} refused the ${what} (${String(response.status)})${reason === '' ? '' : `: ${reason}`}`,
      classifyStatus(response.status),
      {
        status: response.status,
        ...Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {},
      },
    )
  }

  const wait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

  const generateOne = async (
    info: GenModelInfo,
    endpoint: string,
    body: Record<string, unknown>,
    onProgress: GenerationProgressSink,
    signal: AbortSignal,
    key: string,
  ): Promise<GenerationOutput[]> => {
    const headers = { [options.auth.header]: `${options.auth.prefix}${key}`, 'content-type': 'application/json', accept: 'application/json' }
    onProgress({ phase: 'sending' })
    const what = `${info.artefact} generation`
    const post = (payload: Record<string, unknown>): Promise<Response> =>
      send(`${options.queueUrl}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(payload) }, signal, what)
    let enqueue = await post(body)
    if (enqueue.status === 422) {
      // A 422 naming only required fields the seam has a default for (fal's
      // music endpoints want `lyrics` beside `prompt`), or values outside a
      // literal enum the body can be coerced to (`duration: 5` where the
      // endpoint wants `"5"`, when no schema was known beforehand), is sent
      // once more with those fields filled; any other 422 is the refusal it
      // reads as.
      const text = await refusalText(enqueue)
      const defaults = requiredFieldDefaults(text, body)
      const literals = enumRetryValues(refusedFields(text), body)
      if (defaults === undefined && literals === undefined) await refuse(enqueue, what, text)
      enqueue = await post({ ...body, ...defaults, ...literals })
    }
    if (!enqueue.ok) await refuse(enqueue, what)
    const ticket = await enqueue.json().catch(() => null) as { status_url?: unknown; response_url?: unknown; cancel_url?: unknown } | null
    const statusUrl = ticket?.status_url
    const responseUrl = ticket?.response_url
    if (typeof statusUrl !== 'string' || typeof responseUrl !== 'string') {
      throw new GenerationError(`the ${options.name} queue answered without a status URL`, 'PROVIDER_ERROR')
    }
    onProgress({ phase: 'queued' })
    for (;;) {
      const status = await send(statusUrl, { headers }, signal, 'status')
      if (!status.ok) await refuse(status, 'status read')
      const state = (await status.json().catch(() => null) as { status?: unknown; queue_position?: unknown } | null)
      if (state?.status === 'COMPLETED') break
      if (state?.status !== 'IN_QUEUE' && state?.status !== 'IN_PROGRESS') {
        throw new GenerationError(`the ${options.name} queue reported an unknown state "${String(state?.status)}"`, 'PROVIDER_ERROR')
      }
      const position = typeof state.queue_position === 'number' ? ` (position ${String(state.queue_position)})` : ''
      onProgress({ phase: state.status === 'IN_QUEUE' ? 'queued' : 'sending', message: `${state.status === 'IN_QUEUE' ? 'queued' : 'running'}${position}` })
      try {
        await wait(options.pollIntervalMs, signal)
      } catch (error) {
        if (typeof ticket?.cancel_url === 'string') void fetchImpl(ticket.cancel_url, { method: 'PUT', headers }).catch(() => undefined)
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new GenerationError(`${options.name} did not finish within ${String(options.timeoutMs)}ms`, 'TIMEOUT', { cause: error })
        }
        throw new GenerationError('the generation was aborted', 'ABORTED', { cause: error })
      }
    }
    onProgress({ phase: 'receiving' })
    const result = await send(responseUrl, { headers }, signal, 'result')
    if (!result.ok) await refuse(result, what)
    const files = resultFilesFrom(await result.json().catch(() => null))
    const outputs: GenerationOutput[] = []
    for (const file of files) {
      const download = await send(file.url, {}, signal, 'download')
      if (!download.ok) await refuse(download, 'result download')
      const mediaType = mediaTypeOf(file.contentType, download.headers.get('content-type'), file.url)
      if (!mediaType.startsWith(`${info.artefact}/`)) continue
      outputs.push({ mediaType, data: Buffer.from(await download.arrayBuffer()).toString('base64') })
    }
    return outputs
  }

  return {
    id: options.id,
    credential: options.credential,
    describe: () => describeModels(models, options.categories, credentialConfigured),
    models: () => models,
    refresh: async () => {
      credentialConfigured = await options.resolveApiKey().then(key => key !== undefined && key !== '', () => false)
      const live: GenModelInfo[] = []
      for (const entry of options.categories) {
        const url = `${options.baseUrl}/models?limit=100&category=${encodeURIComponent(entry.category)}`
        const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(options.timeoutMs) })
        if (!response.ok) {
          throw new GenerationError(
            `${options.name} refused the ${entry.category} catalogue request (${String(response.status)})`,
            classifyStatus(response.status),
            { status: response.status },
          )
        }
        live.push(...liveModelsFrom(await response.json(), options.categories))
      }
      // The live list replaces what was cached: it is the service's own
      // answer, and keeping a row it no longer lists would offer a model the
      // person cannot run.
      models = mergeCatalog(models, live)
      options.onCatalog?.(models)
    },
    inputs: async (modelId) => {
      const schema = await schemaFor(modelId)
      return schema === undefined ? [] : inputFieldsFrom(schema)
    },
    generate: async (request, onProgress, signal) => {
      const info = models.find(model => model.id === request.model.model)
      if (info === undefined) {
        throw new GenerationError(`${options.name} offers no model "${request.model.model}"`, 'NO_MODEL')
      }
      onProgress({ phase: 'queued' })
      const key = await resolveKey()
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)])
      // A reference image sends a text-to-video request to its image-to-video
      // sibling; the schema read follows the endpoint actually enqueued on.
      const endpoint = endpointFor(info.id, request)
      // A schema that cannot be read must not stop the generation: the body
      // goes out as built and the 422 fallback coerces what fal refuses.
      const schema = await schemaFor(endpoint).catch(() => undefined)
      const body = queuePayload(request)
      const outputs = await generateOne(info, endpoint, schema === undefined ? body : coerceBody(body, schema), onProgress, bounded, key)
      if (outputs.length === 0) {
        throw new GenerationError(`the ${options.name} result carried no ${info.artefact} file`, 'PROVIDER_ERROR')
      }
      onProgress({ phase: 'done' })
      return {
        schemaVersion: GENERATION_SCHEMA_VERSION,
        backend: options.id,
        model: info.id,
        artefact: info.artefact,
        outputs,
        timestamp: Date.now(),
      }
    },
  }
}

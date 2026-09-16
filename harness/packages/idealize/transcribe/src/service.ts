/**
 * Service Definition for the transcription capability seam (`ctx.transcription`):
 * a registry of speech providers, an explicit request-to-spec resolve step, and
 * dispatch to the resolved provider.
 * @module @idealize/transcribe/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { TranscriptionError } from './error.ts'
import type {
  TranscriptionDescriptor,
  TranscriptionProvider,
  TranscriptionReadiness,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptionSpec,
} from './types.ts'

/** Version carried by the descriptors and results this seam exchanges. */
export const TRANSCRIPTION_SCHEMA_VERSION = 1

declare module '@deepseek-ai/cordis' {
  interface Context {
    transcription: TranscriptionRuntime
  }
}

/** The capture bounds every request is held to; the plugin's Config supplies them. */
export interface CaptureBounds {
  /** Captures shorter than this are refused as a slip rather than speech, in milliseconds. */
  minCaptureMs: number
  /** Captures longer than this are refused, in milliseconds. */
  maxCaptureMs: number
}

/**
 * The transcription service. Registered as `ctx.transcription` (one instance
 * per context). Providers register with `register()`; consumers resolve a
 * capture and run it.
 */
export class TranscriptionRuntime extends Service {
  private readonly providersById = new Map<string, TranscriptionProvider>()
  private readonly bounds: CaptureBounds

  /**
   * @param ctx - the Cordis context this service is registered on.
   * @param bounds - the capture bounds every request is held to.
   */
  constructor(ctx: Context, bounds: CaptureBounds) {
    super(ctx, 'transcription')
    this.bounds = bounds
  }

  /**
   * Register a speech provider. Throws on a duplicate id, which is a
   * composition bug rather than a task failure.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters it.
   */
  register(provider: TranscriptionProvider): () => void {
    if (this.providersById.has(provider.id)) {
      throw new Error(`transcription: a provider with id "${provider.id}" is already registered`)
    }
    const store = this.providersById
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'transcription.register()')
    return () => { void dispose() }
  }

  /**
   * Every registered provider's descriptor, in registration order.
   * @returns the descriptors.
   */
  list(): TranscriptionDescriptor[] {
    return [...this.providersById.values()].map(provider => provider.describe())
  }

  /**
   * Readiness of the provider a request would resolve to.
   * @param id - a pinned provider id; absent picks the only registered one.
   * @returns that provider's readiness.
   */
  async readiness(id?: string): Promise<TranscriptionReadiness> {
    return await this.provider(id).readiness()
  }

  /**
   * Bring the provider a request would resolve to up to `ready`.
   * @param id - a pinned provider id; absent picks the only registered one.
   * @returns readiness once the attempt settles.
   */
  async prepare(id?: string): Promise<TranscriptionReadiness> {
    return await this.provider(id).prepare()
  }

  /**
   * Choose the provider for a request and hold the capture to its terms. The
   * defaulting a caller does not state lives here, in the open, rather than
   * inside `transcribe()`.
   * @param request - the capture and any pinned provider.
   * @returns the resolved capture.
   */
  resolve(request: TranscriptionRequest): TranscriptionSpec {
    const provider = this.provider(request.provider)
    const descriptor = provider.describe()
    if (request.sampleRate !== descriptor.sampleRate) {
      throw new TranscriptionError(
        'sample-rate',
        `transcription: ${descriptor.id} requires ${descriptor.sampleRate} Hz, the capture is ${request.sampleRate} Hz`,
      )
    }
    const ms = (request.samples.length / request.sampleRate) * 1000
    if (ms < this.bounds.minCaptureMs) {
      throw new TranscriptionError('too-short', `transcription: ${Math.round(ms)} ms is below the ${this.bounds.minCaptureMs} ms floor`)
    }
    if (ms > this.bounds.maxCaptureMs) {
      throw new TranscriptionError('too-long', `transcription: ${Math.round(ms)} ms is above the ${this.bounds.maxCaptureMs} ms ceiling`)
    }
    return { provider, samples: request.samples, sampleRate: request.sampleRate }
  }

  /**
   * Resolve a capture and run it.
   * @param request - the capture and any pinned provider.
   * @param signal - aborts the run; an aborted run rejects and produces nothing.
   * @returns the transcript.
   */
  async transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult> {
    const spec = this.resolve(request)
    const readiness = await spec.provider.readiness()
    if (readiness.state !== 'ready') {
      const detail = readiness.state === 'preparing' ? `preparing (${readiness.percent}%)` : readiness.detail
      throw new TranscriptionError('not-ready', `transcription: ${spec.provider.id} is not ready: ${detail}`)
    }
    try {
      return await spec.provider.transcribe(spec, signal)
    } catch (cause) {
      if (cause instanceof TranscriptionError) throw cause
      throw new TranscriptionError('failed', `transcription: ${spec.provider.id} failed`, { cause })
    }
  }

  /** The provider a pinned id names, or the only registered one. */
  private provider(id: string | undefined): TranscriptionProvider {
    if (id !== undefined) {
      const pinned = this.providersById.get(id)
      if (pinned === undefined) {
        throw new TranscriptionError('no-provider', `transcription: no provider with id "${id}"`)
      }
      return pinned
    }
    const providers = [...this.providersById.values()]
    const only = providers[0]
    if (only === undefined) throw new TranscriptionError('no-provider', 'transcription: no provider is registered')
    if (providers.length > 1) {
      const names = providers.map(provider => provider.id).join(', ')
      throw new TranscriptionError('ambiguous-provider', `transcription: name one of ${names}`)
    }
    return only
  }
}

export default TranscriptionRuntime

/**
 * The transcription seam's vocabulary: what a caller hands in, what a provider
 * receives once the seam has resolved it, what comes back, and how a provider
 * describes where it processes audio.
 * @module @idealize/transcribe/types
 */

/**
 * Where a provider processes the samples it is handed. `on-device` is a claim
 * the provider makes about itself and the consent card repeats: the samples
 * reach no network. A `remote` provider owes a disclosure before first use.
 */
export type ProcessingLocation = 'on-device' | 'remote'

/** What a provider publishes about itself, for the seam and the consent card. */
export interface TranscriptionDescriptor {
  /** Registry key. */
  id: string
  /** The provider's name as a person reads it. */
  label: string
  /** Where the audio is processed. */
  location: ProcessingLocation
  /** The model the provider runs, named the way its publisher names it. */
  model: string
  /** Samples per second the provider requires; a capture at any other rate is refused. */
  sampleRate: number
}

/**
 * Whether a provider can transcribe now. `preparing` covers a first run
 * fetching model files; `percent` is what the provider can observe, and is 0
 * until the first file reports progress.
 */
export type TranscriptionReadiness =
  | { state: 'ready' }
  | { state: 'preparing'; percent: number }
  | { state: 'unavailable'; detail: string }

/** A capture handed to the seam. */
export interface TranscriptionRequest {
  /** Mono samples in −1…1. */
  samples: Float32Array
  /** Samples per second the capture was taken at. */
  sampleRate: number
  /** Provider id, when the caller pins one. Absent picks the only registered provider. */
  provider?: string
}

/** A capture after the seam has chosen a provider and checked the capture against it. */
export interface TranscriptionSpec {
  /** The provider that will run this capture. */
  provider: TranscriptionProvider
  /** Mono samples in −1…1, at the provider's required rate. */
  samples: Float32Array
  /** Samples per second, equal to the provider's `sampleRate`. */
  sampleRate: number
}

/** What a provider returns for one capture. */
export interface TranscriptionResult {
  /** The transcript, trimmed. Empty when the capture carried no speech. */
  text: string
  /**
   * Whether the transcript may dispatch without a person reading it first.
   * A provider that publishes no per-token likelihood decides this from what
   * it can observe — an empty transcript, or one that is only a non-speech
   * marker, is not confident — and never invents a score.
   */
  confident: boolean
  /** Wall-clock milliseconds the provider spent on this capture. */
  ms: number
}

/** A speech provider. Registered into `ctx.transcription`. */
export interface TranscriptionProvider {
  /** Registry key; also the id a caller pins. */
  readonly id: string
  /**
   * Describe this provider.
   * @returns the descriptor the seam publishes and the consent card reads.
   */
  describe(): TranscriptionDescriptor
  /**
   * Report whether this provider can transcribe now.
   * @returns the current readiness.
   */
  readiness(): Promise<TranscriptionReadiness>
  /**
   * Bring the provider to `ready`, fetching whatever it needs. Calling it
   * while a preparation is in flight joins that one rather than starting a
   * second.
   * @returns readiness once the attempt settles.
   */
  prepare(): Promise<TranscriptionReadiness>
  /**
   * Transcribe one capture.
   * @param spec - the resolved capture.
   * @param signal - aborts the run; an aborted run rejects and produces nothing.
   * @returns the transcript.
   */
  transcribe(spec: TranscriptionSpec, signal?: AbortSignal): Promise<TranscriptionResult>
}

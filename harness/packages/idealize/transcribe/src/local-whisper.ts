/**
 * The on-device speech provider: a whisper model run through
 * `@huggingface/transformers` on this machine. Captured samples reach the
 * model in process and no network, which is the claim the consent card makes
 * on this provider's behalf (JJ, 9 Sep 2026, choosing on-device over a
 * hosted API).
 *
 * The library and its ONNX runtime are imported on the first `prepare()`, so
 * a composition that never records speech never loads them. Model files are
 * fetched once into the configured cache directory and reused from there.
 * @module @idealize/transcribe/local-whisper
 */

import type { DataType, ProgressInfo } from '@huggingface/transformers'
import { TranscriptionError } from './error.ts'
import type {
  TranscriptionDescriptor,
  TranscriptionProvider,
  TranscriptionReadiness,
  TranscriptionResult,
  TranscriptionSpec,
} from './types.ts'

/** Registry id of the on-device provider. */
export const LOCAL_WHISPER_ID = 'local-whisper'

/** Whisper takes 16 kHz mono; every capture is resampled to it before it arrives. */
export const WHISPER_SAMPLE_RATE = 16_000

/**
 * Markers whisper emits for audio it heard no speech in. A transcript that is
 * only one of these is an empty transcript, not a quiet one.
 */
const NON_SPEECH = /^[[(](?:blank_audio|inaudible|silence|music|no speech)[\])]$/i

/** What the provider needs to run. */
export interface LocalWhisperOptions {
  /** The model, named the way its publisher names it. */
  model: string
  /** Weight quantisation the model is loaded at, as the library names its quantisations. */
  dtype: DataType
  /** Directory the model files are fetched into and reused from. */
  cacheDir: string
}

/** The transcription call the library hands back, as far as this module uses it. */
type Recogniser = (samples: Float32Array) => Promise<{ text: string } | { text: string }[]>

/** The one text a recogniser result carries, whichever shape it came back in. */
function textOf(output: { text: string } | { text: string }[]): string {
  return Array.isArray(output) ? (output[0]?.text ?? '') : output.text
}

/**
 * Build the on-device provider.
 * @param options - the model, its quantisation and where its files live.
 * @returns the provider, ready to register.
 */
export function localWhisper(options: LocalWhisperOptions): TranscriptionProvider {
  let recogniser: Recogniser | undefined
  let preparing: Promise<TranscriptionReadiness> | undefined
  let percent = 0
  let failure: string | undefined

  const descriptor: TranscriptionDescriptor = {
    id: LOCAL_WHISPER_ID,
    label: 'On-device whisper',
    location: 'on-device',
    model: options.model,
    sampleRate: WHISPER_SAMPLE_RATE,
  }

  // Per-file byte counts from the library's progress callback, summed into one
  // percentage. Reporting the newest file alone would jump backwards each time
  // a file finishes and the next starts.
  const loaded = new Map<string, { at: number; of: number }>()
  const onProgress = (event: ProgressInfo): void => {
    const file = 'file' in event ? event.file : undefined
    const total = 'total' in event ? event.total : undefined
    if (file === undefined || total === undefined || total === 0) return
    loaded.set(file, { at: 'loaded' in event ? event.loaded : 0, of: total })
    let at = 0
    let of = 0
    // Every stored entry was admitted with a positive size, so the sum is too.
    for (const file of loaded.values()) { at += file.at; of += file.of }
    percent = Math.min(100, Math.round((at / of) * 100))
  }

  const start = async (): Promise<TranscriptionReadiness> => {
    try {
      const { env, pipeline } = await import('@huggingface/transformers')
      env.cacheDir = options.cacheDir
      const asr = await pipeline('automatic-speech-recognition', options.model, {
        dtype: options.dtype,
        progress_callback: onProgress,
      })
      recogniser = asr
      percent = 100
      failure = undefined
      return { state: 'ready' }
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause)
      return { state: 'unavailable', detail: failure }
    } finally {
      preparing = undefined
    }
  }

  return {
    id: LOCAL_WHISPER_ID,

    describe: () => descriptor,

    readiness: (): Promise<TranscriptionReadiness> => {
      if (recogniser !== undefined) return Promise.resolve({ state: 'ready' })
      if (preparing !== undefined) return Promise.resolve({ state: 'preparing', percent })
      if (failure !== undefined) return Promise.resolve({ state: 'unavailable', detail: failure })
      // Nothing has asked for the model yet: the first capture calls prepare().
      return Promise.resolve({ state: 'preparing', percent: 0 })
    },

    prepare: async (): Promise<TranscriptionReadiness> => {
      if (recogniser !== undefined) return { state: 'ready' }
      preparing ??= start()
      return await preparing
    },

    transcribe: async (spec: TranscriptionSpec, signal?: AbortSignal): Promise<TranscriptionResult> => {
      if (recogniser === undefined) {
        throw new TranscriptionError('not-ready', 'transcription: the on-device model is not loaded')
      }
      signal?.throwIfAborted()
      const began = Date.now()
      const output = await recogniser(spec.samples)
      // The library takes no signal, so a run that was cancelled mid-flight
      // finishes and its text is dropped here rather than reaching a caller
      // that has moved on.
      signal?.throwIfAborted()
      const text = textOf(output).trim()
      return {
        text: NON_SPEECH.test(text) ? '' : text,
        confident: text !== '' && !NON_SPEECH.test(text),
        ms: Date.now() - began,
      }
    },
  }
}

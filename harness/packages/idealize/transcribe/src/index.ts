/**
 * @idealize/transcribe — the transcription capability seam and its on-device
 * provider. Composes the `TranscriptionRuntime` service (`ctx.transcription`),
 * registers `local-whisper` against it from the validated configuration, and
 * mounts the routes the Askbar's hold gesture speaks through.
 *
 * HTTP (loopback only, mutating requests carry `x-idealize-auth: 1`):
 * `GET /idealize/transcribe/state` answers the registered providers and the
 * readiness of the one a capture would reach; `POST /idealize/transcribe/prepare`
 * fetches the model files and answers readiness once the attempt settles;
 * `POST /idealize/transcribe` takes a body of little-endian 32-bit float mono
 * samples with `?rate=<hz>` and answers the transcript.
 *
 * Samples arrive already decoded and resampled: the recorder is a browser, so
 * container and codec work happens there, and nothing in this package parses
 * an audio format.
 *
 * This plugin declares no required injection. A `required` list would run
 * `apply` on a fiber whose services do not reach the root, so `ctx.transcription`
 * would never be published; the web server is awaited inside instead.
 * @module @idealize/transcribe
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { DataType } from '@huggingface/transformers'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { localWhisper } from './local-whisper.ts'
import { installTranscribeRoutes } from './routes.ts'
import { TranscriptionRuntime } from './service.ts'

export { TranscriptionError } from './error.ts'
export type { TranscriptionRefusal } from './error.ts'
export { localWhisper, LOCAL_WHISPER_ID, WHISPER_SAMPLE_RATE } from './local-whisper.ts'
export type { LocalWhisperOptions } from './local-whisper.ts'
export { installTranscribeRoutes, PREPARE_PATH, rateOf, samplesOf, STATE_PATH, TRANSCRIBE_PATH } from './routes.ts'
export type { TranscribeQueries } from './routes.ts'
export { TRANSCRIPTION_SCHEMA_VERSION, TranscriptionRuntime } from './service.ts'
export type { CaptureBounds } from './service.ts'
export type * from './types.ts'

export const name = 'idealize-transcribe'

/**
 * The quantisations the library loads a model at, so a misspelt `dtype` fails
 * at config load rather than at the first capture.
 */
const DTYPES = ['auto', 'fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'bnb4', 'q4f16', 'q2', 'q2f16', 'q1', 'q1f16'] as const satisfies readonly DataType[]

/** Validated configuration: which model runs on this machine, where it lives, and the capture bounds. */
export interface Config {
  /** The whisper model, named the way its publisher names it. */
  model: string
  /** Weight quantisation the model is loaded at, as the library names its quantisations. */
  dtype: DataType
  /** Directory under the harness home the model files are fetched into. */
  cacheDir: string
  /** Captures shorter than this are refused as a slip rather than speech, in milliseconds. */
  minCaptureMs: number
  /** Captures longer than this are refused, in milliseconds. */
  maxCaptureMs: number
}

export const Config: z<Config> = z.object({
  /** The whisper model, named the way its publisher names it. */
  model: z.string().default('onnx-community/whisper-base.en').description('Whisper model run on this machine.'),
  /** Weight quantisation the model is loaded at. */
  dtype: z.union(DTYPES).default('q8').description('Weight quantisation the model is loaded at.'),
  /** Directory under the harness home the model files are fetched into. */
  cacheDir: z.string().default('speech-models').description('Model cache directory, under the harness home.'),
  /** Captures shorter than this are a slip rather than speech, in milliseconds. */
  minCaptureMs: z.natural().default(400).description('Shortest capture treated as speech (ms).'),
  /** Captures longer than this are refused, in milliseconds. */
  maxCaptureMs: z.natural().default(120_000).description('Longest capture accepted (ms).'),
})

/**
 * Compose the transcription seam, its on-device provider and its routes.
 * @param ctx - the Cordis context.
 * @param config - the validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(TranscriptionRuntime, { minCaptureMs: config.minCaptureMs, maxCaptureMs: config.maxCaptureMs })

  ctx.inject(['transcription'], (scope) => {
    scope.effect(() => scope.transcription.register(localWhisper({
      model: config.model,
      dtype: config.dtype,
      cacheDir: join(resolveDshHome(), config.cacheDir),
    })), 'idealize-transcribe: local-whisper')
    installTranscribeRoutes(scope, scope.transcription)
  })
}

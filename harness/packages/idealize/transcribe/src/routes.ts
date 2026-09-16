/**
 * The transcription routes, mounted while a web server is composed beside the
 * runtime. Kept apart from the plugin so a test can compose the runtime, a
 * stub provider and these routes without the on-device model.
 * @module @idealize/transcribe/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { TranscriptionError } from './error.ts'
import type { TranscriptionRefusal } from './error.ts'
import { WHISPER_SAMPLE_RATE } from './local-whisper.ts'
import type {
  TranscriptionDescriptor,
  TranscriptionReadiness,
  TranscriptionRequest,
  TranscriptionResult,
} from './types.ts'

/** State path. */
export const STATE_PATH = '/idealize/transcribe/state'
/** Prepare path. */
export const PREPARE_PATH = '/idealize/transcribe/prepare'
/** Transcribe path. */
export const TRANSCRIBE_PATH = '/idealize/transcribe'

/* jscpd:ignore-start */
/** Loopback fence plus the mutating-request header, matching the other IDEalize routes. */
function refuse(req: IncomingMessage, res: ServerResponse, mutating = false): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
/* jscpd:ignore-end */

/** The whole request body, as bytes. */
async function readBytes(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * The body's bytes as mono float samples. A body whose length is not a whole
 * number of 32-bit floats is a truncated upload, not a short capture.
 * @param body - the raw request body.
 * @returns the samples, or undefined when the body is not whole floats.
 */
export function samplesOf(body: Buffer): Float32Array | undefined {
  if (body.length === 0 || body.length % 4 !== 0) return undefined
  // Copy rather than view: the Buffer's byteOffset need not be 4-byte aligned.
  const copy = new ArrayBuffer(body.length)
  new Uint8Array(copy).set(body)
  return new Float32Array(copy)
}

/**
 * The sample rate a request declares. A request that names none was recorded
 * at whisper's rate, which is what the recorder resamples to.
 * @param url - the request's URL, absent on a request that carried none.
 * @returns the declared rate, or whisper's.
 */
export function rateOf(url: string | undefined): number {
  if (url === undefined) return WHISPER_SAMPLE_RATE
  const declared = new URL(url, 'http://127.0.0.1').searchParams.get('rate')
  return declared === null ? WHISPER_SAMPLE_RATE : Number(declared)
}

/** The HTTP status each refusal answers with; exhaustive over the tag union. */
const REFUSAL_STATUS: Record<TranscriptionRefusal, number> = {
  'no-provider': 501,
  'ambiguous-provider': 500,
  'not-ready': 503,
  'too-short': 422,
  'too-long': 413,
  'sample-rate': 422,
  failed: 500,
}

/** The runtime slice the routes read, so the service can hand itself in before it is published. */
export interface TranscribeQueries {
  /** Every registered provider's descriptor. */
  list(): TranscriptionDescriptor[]
  /** Readiness of the provider a capture would reach. */
  readiness(id?: string): Promise<TranscriptionReadiness>
  /** Bring that provider up to ready. */
  prepare(id?: string): Promise<TranscriptionReadiness>
  /** Resolve a capture and run it. */
  transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult>
}

/**
 * Mount the three transcription routes while a web server is composed.
 * @param ctx - the context to mount on.
 * @param runtime - the runtime the routes read; handed in rather than read off
 *   the context, because the service mounts these from its own constructor.
 */
export function installTranscribeRoutes(ctx: Context, runtime: TranscribeQueries): void {
  ctx.inject(['webServer'], (webCtx) => {
    type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
    const register = (path: string, handler: Handler): void => {
      webCtx.effect(
        () => webCtx.webServer.register({ kind: 'exact', path, handler }),
        `idealize-transcribe: ${path}`,
      )
    }

    register(STATE_PATH, async (req, res) => {
      if (refuse(req, res)) return
      const providers = runtime.list()
      const readiness = providers.length === 0
        ? { state: 'unavailable' as const, detail: 'no speech provider is composed' }
        : await runtime.readiness()
      sendJson(res, 200, { providers, readiness })
    })

    register(PREPARE_PATH, async (req, res) => {
      if (refuse(req, res, true)) return
      sendJson(res, 200, { readiness: await runtime.prepare() })
    })

    register(TRANSCRIBE_PATH, async (req, res) => {
      if (refuse(req, res, true)) return
      const rate = rateOf(req.url)
      const samples = samplesOf(await readBytes(req))
      if (samples === undefined) {
        sendJson(res, 400, { refusal: 'failed', message: 'body is not a whole number of 32-bit float samples' })
        return
      }
      try {
        sendJson(res, 200, await runtime.transcribe({ samples, sampleRate: rate }))
      } catch (error) {
        // Anything the seam did not tag is a failure of the run, reported the
        // same way rather than left to the server's own error path.
        const refusal = error instanceof TranscriptionError ? error.refusal : 'failed'
        sendJson(res, REFUSAL_STATUS[refusal], { refusal, message: error instanceof Error ? error.message : String(error) })
      }
    })
  })
}

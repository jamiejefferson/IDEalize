/**
 * The Askbar's voice capture: the microphone half of the hold gesture, and the
 * call to the transcription seam.
 *
 * Decoding and resampling happen here because this is a browser: the recorder
 * produces a container the host would need a codec for, and `AudioContext`
 * already holds one. What crosses to the host is mono float samples at
 * whisper's rate, and nothing else.
 *
 * The samples live in this page's memory for the length of one capture. They
 * are never written to disk, so a cancelled or failed capture leaves nothing
 * behind once the page drops it.
 * @module @idealize/askbar/src/client/capture
 */

/** The rate the seam's provider requires; the capture is resampled to it before it is sent. */
export const CAPTURE_SAMPLE_RATE = 16_000

/** A capture in progress. */
export interface Capture {
  /**
   * Stop recording and hand back what was captured.
   * @returns the mono samples, resampled to {@link CAPTURE_SAMPLE_RATE}.
   */
  stop(): Promise<Float32Array>
  /** Stop recording and discard it. Releases the microphone either way. */
  cancel(): void
}

/** Why a capture could not start. */
export type CaptureRefusal = 'no-microphone' | 'denied' | 'unsupported'

/** A capture that could not start. */
export class CaptureError extends Error {
  /** What stopped it. */
  readonly refusal: CaptureRefusal

  /**
   * @param refusal - what stopped it.
   * @param message - what a person reads.
   */
  constructor(refusal: CaptureRefusal, message: string) {
    super(message)
    this.name = 'CaptureError'
    this.refusal = refusal
  }
}

/** What the seam answered for one capture. */
export type TranscriptOutcome =
  | { kind: 'text'; text: string; confident: boolean }
  | { kind: 'refused'; refusal: string; message: string }

/** How ready the speech provider is, as the state route reports it. */
export type SpeechReadiness =
  | { state: 'ready' }
  | { state: 'preparing'; percent: number }
  | { state: 'unavailable'; detail: string }

/** What the state route publishes. */
export interface SpeechState {
  /** The registered providers; empty when no speech provider is composed. */
  providers: { id: string; label: string; location: 'on-device' | 'remote'; model: string; sampleRate: number }[]
  /** Readiness of the provider a capture would reach. */
  readiness: SpeechReadiness
}

/** One channel of a decoded buffer, resampled to the seam's rate. */
async function monoAt(decoded: AudioBuffer, rate: number): Promise<Float32Array> {
  if (decoded.sampleRate === rate && decoded.numberOfChannels === 1) return decoded.getChannelData(0)
  const frames = Math.max(1, Math.ceil((decoded.duration * rate)))
  const offline = new OfflineAudioContext(1, frames, rate)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

/**
 * Open the microphone and start recording.
 * @returns the capture in progress.
 * @throws CaptureError when the browser has no recorder, no device, or the
 *   person declined the microphone.
 */
export async function startCapture(): Promise<Capture> {
  if (typeof MediaRecorder === 'undefined' || navigator.mediaDevices as unknown === undefined) {
    throw new CaptureError('unsupported', 'this window cannot record audio')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : ''
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CaptureError('no-microphone', 'no microphone is available')
    }
    throw new CaptureError('denied', 'the microphone was not allowed')
  }

  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  recorder.start()

  // One place to release the device, so the recording indicator always clears.
  const release = (): void => { for (const track of stream.getTracks()) track.stop() }

  return {
    stop: async (): Promise<Float32Array> => {
      // A recorder that already stopped on its own (the device went away)
      // fires no further `stop`, so waiting for one would wait forever.
      if (recorder.state !== 'inactive') {
        const ended = new Promise<void>((resolve) => { recorder.addEventListener('stop', () => { resolve() }, { once: true }) })
        recorder.stop()
        await ended
      }
      release()
      const audio = new AudioContext()
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType })
        const decoded = await audio.decodeAudioData(await blob.arrayBuffer())
        return await monoAt(decoded, CAPTURE_SAMPLE_RATE)
      } finally {
        void audio.close()
      }
    },
    cancel: (): void => {
      if (recorder.state !== 'inactive') recorder.stop()
      chunks.length = 0
      release()
    },
  }
}

/**
 * Read what the speech provider is and whether it can run.
 * @returns the state, or undefined when the route cannot be reached.
 */
export async function speechState(): Promise<SpeechState | undefined> {
  try {
    const response = await fetch('/idealize/transcribe/state')
    if (!response.ok) return undefined
    return await response.json() as SpeechState
  } catch {
    // The bar polls this beside the roster; an unreachable host is already reported there.
    return undefined
  }
}

/**
 * Fetch the model files if they are not here yet.
 * @returns readiness once the attempt settles, or undefined when the route cannot be reached.
 */
export async function prepareSpeech(): Promise<SpeechReadiness | undefined> {
  try {
    const response = await fetch('/idealize/transcribe/prepare', { method: 'POST', headers: { 'x-idealize-auth': '1' } })
    if (!response.ok) return undefined
    return (await response.json() as { readiness: SpeechReadiness }).readiness
  } catch {
    // Same as above: the roster poll owns the unreachable-host message.
    return undefined
  }
}

/**
 * Send one capture to the seam.
 * @param samples - the mono samples at {@link CAPTURE_SAMPLE_RATE}.
 * @returns the transcript, or what the seam refused.
 */
export async function transcribeCapture(samples: Float32Array): Promise<TranscriptOutcome> {
  let response: Response
  try {
    response = await fetch(`/idealize/transcribe?rate=${String(CAPTURE_SAMPLE_RATE)}`, {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/octet-stream' },
      body: samples.slice().buffer,
    })
  } catch {
    return { kind: 'refused', refusal: 'failed', message: 'the host could not be reached' }
  }
  const body = await response.json() as { text?: string; confident?: boolean; refusal?: string; message?: string }
  if (!response.ok) {
    return { kind: 'refused', refusal: body.refusal ?? 'failed', message: body.message ?? 'the capture was refused' }
  }
  return { kind: 'text', text: body.text ?? '', confident: body.confident ?? false }
}

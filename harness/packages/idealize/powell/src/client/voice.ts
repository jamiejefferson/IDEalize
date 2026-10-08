/**
 * The owl's ears and mouth.
 *
 * Ears: the microphone is read as 16 kHz PCM straight from an AudioContext
 * (no recorder container to decode afterwards). While the person holds
 * Powell, every pause after a couple of seconds of speech cuts a segment and
 * sends it for transcription at once, so on release only the last few
 * seconds are still in flight (latency plan: segmented speech-to-text).
 *
 * Mouth: a queue of sentences. A sentence that matches a cached clip plays
 * from memory with no network at all; any other sentence streams from the
 * host's speech route, and the next sentence's audio starts loading while
 * the current one plays, so there is no gap between them.
 * @module @idealize/powell/client/voice
 */

import type { PowellVoiceManifest } from '../types.ts'

/** The rate speech-to-text receives. */
export const SAMPLE_RATE = 16_000

/** A segment is cut at a pause once it holds at least this much audio. */
const MIN_SEGMENT_S = 2.2
/** A pause this long ends a segment. */
const PAUSE_S = 0.45
/** In hands-free (toggle) listening, this much silence after speech ends the capture. */
const HANDS_FREE_END_S = 1.3
/** Nothing above this level counts as speech when the floor is quiet. */
const MIN_SPEECH_RMS = 0.012

/** Why the microphone could not open. */
export class MicError extends Error {
  constructor(readonly refusal: 'denied' | 'no-microphone' | 'unsupported', message: string) {
    super(message)
    this.name = 'MicError'
  }
}

/** Little-endian 16-bit WAV around mono float samples. */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

/** What the host's speech-to-text answered for one segment. */
export type Heard = { ok: true; text: string } | { ok: false; code: string; error: string }

/**
 * Send one segment to the host.
 * @param samples - mono 16 kHz samples.
 * @returns the transcript or the failure.
 */
export async function hear(samples: Float32Array): Promise<Heard> {
  try {
    const response = await fetch('/idealize/powell/hear', {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'audio/wav' },
      body: encodeWav(samples),
    })
    const body = await response.json() as { ok?: boolean; text?: string; code?: string; error?: string }
    if (response.ok && body.ok === true) return { ok: true, text: body.text ?? '' }
    return { ok: false, code: body.code ?? 'failed', error: body.error ?? `speech-to-text answered ${String(response.status)}` }
  } catch (error) {
    return { ok: false, code: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The worklet that hands the owl blocks of microphone samples, as a module
 * URL made once. 512 samples is 32 ms at 16 kHz, so "Speak now" shows within
 * one block of the microphone opening (2048 samples took 128 ms).
 */
let tapUrl: string | undefined
function tapModule(): string {
  tapUrl ??= URL.createObjectURL(new Blob([`
    class PowellTap extends AudioWorkletProcessor {
      constructor() { super(); this.buffer = new Float32Array(512); this.filled = 0 }
      process(inputs) {
        const channel = inputs[0] && inputs[0][0]
        if (channel) {
          for (let i = 0; i < channel.length; i++) {
            this.buffer[this.filled++] = channel[i]
            if (this.filled === this.buffer.length) {
              this.port.postMessage(this.buffer)
              this.buffer = new Float32Array(512)
              this.filled = 0
            }
          }
        }
        return true
      }
    }
    registerProcessor('powell-tap', PowellTap)
  `], { type: 'text/javascript' }))
  return tapUrl
}

/** One listening session. */
export interface Listening {
  /** Stop and return the whole transcript (segments joined in order). */
  finish(): Promise<Heard>
  /** Stop and throw everything away. */
  cancel(): void
}

/** Options for {@link listen}. */
export interface ListenOptions {
  /** Microphone level, 0–1, about thirty times a second. */
  onLevel?: (level: number) => void
  /** Hands-free: called once when the person has stopped talking. */
  onEnd?: () => void
  /** The first block of microphone audio arrived: from here on, speech is captured. */
  onReady?: () => void
}

/**
 * The audio graph's fixed half (the context and the tap worklet), made once
 * and kept: building it took part of every press before the first sample
 * (JJ, 2 Oct 2026: "slow to record input audio"). Only the microphone stream
 * opens per press, so the system's mic indicator shows only while listening.
 */
let shared: Promise<AudioContext> | undefined

/**
 * Build the audio context and load the tap now, ahead of the first press.
 * @returns the ready context.
 */
export function warmEars(): Promise<AudioContext> {
  shared ??= (async () => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    await context.audioWorklet.addModule(tapModule())
    return context
  })().catch((error: unknown) => {
    shared = undefined
    throw error
  })
  return shared
}

/**
 * Open the microphone and start listening.
 * @param options - level and end callbacks.
 * @returns the listening session.
 * @throws MicError when the microphone cannot open.
 */
export async function listen(options: ListenOptions = {}): Promise<Listening> {
  if (!('mediaDevices' in navigator) || typeof AudioContext === 'undefined') throw new MicError('unsupported', 'this window cannot record audio')
  const warming = warmEars()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : ''
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('no-microphone', 'no microphone is available')
    throw new MicError('denied', 'the microphone was not allowed')
  }
  let context: AudioContext
  try {
    context = await warming
    if (context.state !== 'running') await context.resume()
  } catch {
    for (const track of stream.getTracks()) track.stop()
    throw new MicError('unsupported', 'this window cannot record audio')
  }
  const source = context.createMediaStreamSource(stream)
  const tap = new AudioWorkletNode(context, 'powell-tap', { numberOfInputs: 1, numberOfOutputs: 0 })
  const rate = context.sampleRate
  let segment: Float32Array[] = []
  let segmentLength = 0
  let silence = 0
  let spokeInSegment = false
  let spokeAtAll = false
  let floor = 0.004
  let closed = false
  let ended = false
  let ready = false
  const pending: Promise<Heard>[] = []

  const cut = (): void => {
    if (segmentLength === 0) return
    const audio = new Float32Array(segmentLength)
    let offset = 0
    for (const part of segment) {
      audio.set(part, offset)
      offset += part.length
    }
    const hadSpeech = spokeInSegment
    segment = []
    segmentLength = 0
    spokeInSegment = false
    pending.push(hadSpeech ? hear(audio) : Promise.resolve({ ok: true, text: '' }))
  }

  tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (closed) return
    const copy = event.data
    if (!ready) {
      ready = true
      options.onReady?.()
    }
    let sum = 0
    for (const sample of copy) sum += sample * sample
    const rms = Math.sqrt(sum / copy.length)
    // The floor follows quiet stretches only, so speech never raises it.
    if (rms < floor * 2) floor = floor * 0.95 + rms * 0.05
    const speaking = rms > Math.max(MIN_SPEECH_RMS, floor * 3)
    options.onLevel?.(Math.min(1, rms * 12))
    segment.push(copy)
    segmentLength += copy.length
    const seconds = copy.length / rate
    if (speaking) {
      silence = 0
      spokeInSegment = true
      spokeAtAll = true
    } else {
      silence += seconds
    }
    if (silence >= PAUSE_S && segmentLength / rate >= MIN_SEGMENT_S) cut()
    if (options.onEnd !== undefined && spokeAtAll && silence >= HANDS_FREE_END_S && !ended) {
      ended = true
      options.onEnd()
    }
  }
  source.connect(tap)

  const close = (): void => {
    if (closed) return
    closed = true
    tap.port.onmessage = null
    tap.disconnect()
    source.disconnect()
    for (const track of stream.getTracks()) track.stop()
  }

  return {
    finish: async (): Promise<Heard> => {
      cut()
      close()
      const parts = await Promise.all(pending)
      const failed = parts.find((part): part is Extract<Heard, { ok: false }> => !part.ok)
      const text = parts.filter((part): part is Extract<Heard, { ok: true }> => part.ok).map(part => part.text.trim()).filter(part => part !== '').join(' ')
      if (text === '' && failed !== undefined) return failed
      return { ok: true, text }
    },
    cancel: (): void => {
      segment = []
      segmentLength = 0
      close()
    },
  }
}

/** One queued line. */
interface Line {
  id: string
  text: string
  clip?: string | undefined
  audio?: HTMLAudioElement
}

/** Plays Powell's lines in order, interruptibly. */
export class Mouth {
  private readonly clips = new Map<string, string>()
  private queue: Line[] = []
  private current: Line | undefined
  private muted = false
  private readonly listeners = new Set<(speaking: boolean) => void>()

  /**
   * Load every acknowledgement clip into memory so it plays instantly.
   * @returns resolves once the manifest's clips are fetched (missing ones are skipped).
   */
  async preload(): Promise<void> {
    try {
      const response = await fetch('/idealize/powell/voice')
      if (!response.ok) return
      const manifest = await response.json() as PowellVoiceManifest
      await Promise.all(manifest.clips.map(async (clip) => {
        if (this.clips.has(clip.id)) return
        try {
          const audio = await fetch(clip.url)
          // Only audio counts: anything else would play as silence and swallow the line.
          if (!audio.ok || !(audio.headers.get('content-type') ?? '').startsWith('audio/')) return
          this.clips.set(clip.id, URL.createObjectURL(await audio.blob()))
        } catch {
          // A missing clip falls back to live speech.
        }
      }))
    } catch {
      // The host is down: lines fall back to live speech when it returns.
    }
  }

  /** Whether a clip is ready in memory. */
  has(clip: string): boolean {
    return this.clips.has(clip)
  }

  /** Follow speaking on/off (the owl's beak). */
  onSpeaking(listener: (speaking: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) this.hush()
  }

  /**
   * Queue a line.
   * @param id - the line's id.
   * @param text - the words.
   * @param clip - the cached clip that says them, when one does.
   */
  say(id: string, text: string, clip?: string): void {
    if (this.muted) return
    const line: Line = { id, text, clip }
    // Start loading now: synthesis of this line overlaps the playback of the one before.
    line.audio = this.element(line)
    this.queue.push(line)
    if (this.current === undefined) this.next()
  }

  /** Stop talking and drop the queue. */
  hush(): void {
    for (const line of [this.current, ...this.queue]) {
      if (line?.audio === undefined) continue
      line.audio.pause()
      line.audio.removeAttribute('src')
      line.audio.load()
    }
    this.queue = []
    if (this.current !== undefined) {
      this.current = undefined
      this.emit(false)
    }
  }

  private element(line: Line): HTMLAudioElement {
    const cached = line.clip === undefined ? undefined : this.clips.get(line.clip)
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = cached ?? `/idealize/powell/speak?text=${encodeURIComponent(line.text)}`
    return audio
  }

  private next(): void {
    const line = this.queue.shift()
    this.current = line
    if (line?.audio === undefined) {
      this.emit(false)
      return
    }
    this.emit(true)
    const audio = line.audio
    const done = (): void => {
      if (this.current !== line) return
      this.next()
    }
    audio.addEventListener('ended', done, { once: true })
    audio.addEventListener('error', done, { once: true })
    void audio.play().catch(done)
  }

  private emit(speaking: boolean): void {
    for (const listener of this.listeners) listener(speaking)
  }
}

/**
 * A short rising two-note cue: the microphone is open, speak now. Synthesised,
 * so it needs no file and plays the instant audio starts flowing.
 */
export function readyCue(): void {
  void warmEars().then((context) => {
    const now = context.currentTime
    const gain = context.createGain()
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    for (const [index, frequency] of [880, 1320].entries()) {
      const tone = context.createOscillator()
      tone.type = 'sine'
      tone.frequency.value = frequency
      tone.connect(gain)
      tone.start(now + index * 0.06)
      tone.stop(now + 0.16)
    }
  }).catch(() => undefined)
}

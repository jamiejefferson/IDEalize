/**
 * Powell's speech providers. Both sit behind small interfaces (spec §6, §13)
 * so the vendor can change without touching the orchestration. The first
 * implementations call fal with the key from the app's credential store, on
 * the host, so no key ever reaches the owl window.
 *
 * Measured on 2 Oct 2026 (one sentence, from London): ElevenLabs v4 Turbo
 * streamed its first audio after about 1.0 s and Turbo v2.5 after about
 * 0.8 s; Scribe v2 transcribed a five-second clip in about 2.1 s.
 * @module @idealize/powell/speech
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ACK_LIBRARY } from './speech-text.ts'
import type { PowellVoiceManifest } from './types.ts'

/** Turns one finished recording into text. */
export interface SpeechToTextProvider {
  /**
   * @param wav - a 16 kHz mono PCM WAV recording.
   * @param keyterms - words to bias recognition toward (project names).
   * @param signal - cancels the request.
   * @returns the transcript, trimmed; empty for silence.
   */
  transcribe(wav: Buffer, keyterms: readonly string[], signal?: AbortSignal): Promise<string>
}

/** Turns one sentence into streamed audio. */
export interface TextToSpeechProvider {
  /** What a cache keyed on this voice must change with. */
  readonly identity: { voice: string; model: string }
  /**
   * @param text - the sentence.
   * @param signal - cancels the request (an interruption).
   * @returns the MP3 body as it arrives.
   */
  stream(text: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>
}

/** Resolves the fal key per call (credentials must not be cached across operations). */
export type KeySource = () => Promise<string | undefined>

/** The fal request failed or no key is set. */
export class SpeechError extends Error {
  constructor(message: string, readonly code: 'no-key' | 'failed' | 'aborted') {
    super(message)
    this.name = 'SpeechError'
  }
}

/**
 * Build a WAV file around mono 16-bit PCM.
 * @param pcm - little-endian 16-bit samples.
 * @param rate - the sample rate.
 * @returns the WAV bytes.
 */
export function wavOf(pcm: Buffer, rate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** ElevenLabs Scribe through fal. */
export class FalScribe implements SpeechToTextProvider {
  constructor(private readonly key: KeySource, private readonly model = 'fal-ai/elevenlabs/speech-to-text/scribe-v2') {}

  async transcribe(wav: Buffer, keyterms: readonly string[], signal?: AbortSignal): Promise<string> {
    const key = await this.key()
    if (key === undefined) throw new SpeechError('no fal key is set (Settings → Brains → fal)', 'no-key')
    const terms = keyterms.map(term => term.slice(0, 50)).filter(term => term.trim() !== '').slice(0, 100)
    const response = await fetch(`https://fal.run/${this.model}`, {
      method: 'POST',
      headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: `data:audio/wav;base64,${wav.toString('base64')}`,
        diarize: false,
        tag_audio_events: false,
        ...terms.length === 0 ? {} : { keyterms: terms },
      }),
      ...signal === undefined ? {} : { signal },
    }).catch((cause: unknown) => {
      throw new SpeechError(cause instanceof Error ? cause.message : String(cause), signal?.aborted === true ? 'aborted' : 'failed')
    })
    if (!response.ok) throw new SpeechError(`transcription answered ${String(response.status)}: ${(await response.text()).slice(0, 200)}`, 'failed')
    const body = await response.json() as { text?: unknown }
    return typeof body.text === 'string' ? body.text.trim() : ''
  }
}

/** ElevenLabs text-to-speech through fal's streaming endpoint, with a fallback model. */
export class FalElevenTts implements TextToSpeechProvider {
  readonly identity: { voice: string; model: string }

  /**
   * @param key - the fal key source.
   * @param voice - the ElevenLabs voice name.
   * @param models - fal endpoints in preference order (addendum §2: v4 Turbo, then Turbo v2.5).
   */
  constructor(private readonly key: KeySource, readonly voice: string, private readonly models: readonly string[]) {
    this.identity = { voice, model: models[0] ?? '' }
  }

  async stream(text: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const key = await this.key()
    if (key === undefined) throw new SpeechError('no fal key is set (Settings → Brains → fal)', 'no-key')
    let lastError = 'no speech model is configured'
    for (const model of this.models) {
      let response: Response
      try {
        response = await fetch(`https://fal.run/${model}/stream`, {
          method: 'POST',
          headers: { authorization: `Key ${key}`, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text, voice: this.voice, output_format: 'mp3_44100_64' }),
          ...signal === undefined ? {} : { signal },
        })
      } catch (cause) {
        if (signal?.aborted === true) throw new SpeechError('interrupted', 'aborted')
        lastError = cause instanceof Error ? cause.message : String(cause)
        continue
      }
      if (response.ok && response.body !== null) return response.body
      lastError = `${model} answered ${String(response.status)}: ${(await response.text().catch(() => '')).slice(0, 200)}`
    }
    throw new SpeechError(lastError, 'failed')
  }
}

/**
 * Read a whole stream into one buffer.
 * @param stream - the body.
 * @returns the bytes.
 */
export async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * The pre-generated acknowledgement clips (addendum §1, §6), one folder per
 * voice so changing the voice regenerates them and never mixes two voices.
 */
export class VoiceCache {
  private generating: Promise<void> | undefined

  /**
   * @param root - the cache root (`<DSH home>/idealize/powell/voice`).
   * @param tts - the provider whose voice the clips use.
   */
  constructor(private readonly root: string, private readonly tts: TextToSpeechProvider) {}

  /** The folder for the current voice. */
  folder(): string {
    const { voice, model } = this.tts.identity
    const slug = createHash('sha256').update(`${voice}\n${model}`).digest('hex').slice(0, 12)
    return join(this.root, slug)
  }

  /**
   * The manifest the owl preloads.
   * @param urlOf - maps a clip id to its route.
   * @returns the manifest (clips listed whether or not generated yet; a missing one falls back to live speech).
   */
  manifest(urlOf: (id: string) => string): PowellVoiceManifest {
    return {
      voice: this.tts.identity.voice,
      model: this.tts.identity.model,
      clips: ACK_LIBRARY.map(clip => ({ id: clip.id, text: clip.text, url: urlOf(clip.id) })),
    }
  }

  /**
   * One clip's audio, generating it on first ask.
   * @param id - the clip id.
   * @returns the MP3 bytes, or undefined for an unknown id or a failed generation.
   */
  async clip(id: string): Promise<Buffer | undefined> {
    const entry = ACK_LIBRARY.find(clip => clip.id === id)
    if (entry === undefined) return undefined
    const file = join(this.folder(), `${id}.mp3`)
    try {
      return await readFile(file)
    } catch {
      // Not generated yet: make it now.
    }
    try {
      const bytes = await drain(await this.tts.stream(entry.text))
      await mkdir(this.folder(), { recursive: true })
      await writeFile(`${file}.tmp`, bytes)
      await rename(`${file}.tmp`, file)
      return bytes
    } catch {
      return undefined
    }
  }

  /**
   * Generate every missing clip, in the background, once per voice.
   * @returns resolves when the library is complete (or as complete as fal allowed).
   */
  warm(): Promise<void> {
    this.generating ??= (async () => {
      await mkdir(this.folder(), { recursive: true })
      for (const clip of ACK_LIBRARY) await this.clip(clip.id)
      await writeFile(join(this.folder(), 'manifest.json'), JSON.stringify({
        voice: this.tts.identity.voice,
        model: this.tts.identity.model,
        clips: ACK_LIBRARY,
      }, null, 2))
    })().finally(() => { this.generating = undefined })
    return this.generating
  }
}

// @vitest-environment jsdom
// The capture module on its own: what it refuses and why, the resample path a
// device that does not record at 16 kHz takes, and what each route call
// answers when the host is unreachable or refuses.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_SAMPLE_RATE,
  CaptureError,
  prepareSpeech,
  speechState,
  startCapture,
  transcribeCapture,
} from '../src/client/capture.ts'
import { rememberSpeechNotice, speechNoticeSeen, SPEECH_NOTICE_KEY } from '../src/client/speech-notice.ts'
import { sendToAgent } from '../src/client/send.ts'

/** Tracks whether the capture released the device. */
let stopped = 0

/** A recorder that hands back one blob, and a decoder answering the given buffer. */
function installRecorder(decoded: Partial<AudioBuffer> & { sampleRate: number; numberOfChannels: number }): void {
  stopped = 0
  class FakeRecorder {
    state = 'inactive'
    mimeType = 'audio/webm'
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()
    start(): void { this.state = 'recording' }
    stop(): void {
      this.state = 'inactive'
      for (const listener of this.listeners.get('dataavailable') ?? []) listener({ data: new Blob(['x']) })
      // A zero-length chunk is dropped rather than concatenated.
      for (const listener of this.listeners.get('dataavailable') ?? []) listener({ data: { size: 0 } })
      for (const listener of this.listeners.get('stop') ?? []) listener({})
    }
    addEventListener(name: string, listener: (event: unknown) => void): void {
      this.listeners.set(name, [...this.listeners.get(name) ?? [], listener])
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', class {
    decodeAudioData(): Promise<AudioBuffer> { return Promise.resolve(decoded as AudioBuffer) }
    close(): Promise<void> { return Promise.resolve() }
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => { stopped += 1 } }] }) },
  })
  if (Blob.prototype.arrayBuffer as unknown === undefined) {
    Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(8)) }
  }
}

/** A buffer already at the seam's rate, which needs no resampling. */
const AT_RATE = {
  duration: 1,
  sampleRate: CAPTURE_SAMPLE_RATE,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array(CAPTURE_SAMPLE_RATE),
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.removeItem(SPEECH_NOTICE_KEY)
})

describe('starting a capture', () => {
  it('refuses when the window has no recorder', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    const error = await startCapture().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CaptureError)
    expect((error as CaptureError).refusal).toBe('unsupported')
  })

  it('names a missing device apart from a refused one', async () => {
    installRecorder(AT_RATE)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'OverconstrainedError' })) },
    })
    await expect(startCapture()).rejects.toMatchObject({ refusal: 'no-microphone' })

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      // A device layer that rejects with something other than an Error is the
      // case this branch reads, so the rule against it does not apply here.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      value: { getUserMedia: () => Promise.reject('not an error') },
    })
    await expect(startCapture()).rejects.toMatchObject({ refusal: 'denied' })
  })

  it('hands back the samples unchanged when the device already records at the seam’s rate', async () => {
    installRecorder(AT_RATE)
    const capture = await startCapture()
    const samples = await capture.stop()
    expect(samples).toHaveLength(CAPTURE_SAMPLE_RATE)
    expect(stopped).toBe(1)
  })

  it('resamples a device that records at another rate', async () => {
    installRecorder({ duration: 2, sampleRate: 48_000, numberOfChannels: 2, getChannelData: () => new Float32Array(96_000) })
    const rendered = new Float32Array(32_000)
    let requested: [number, number, number] | undefined
    vi.stubGlobal('OfflineAudioContext', class {
      constructor(channels: number, frames: number, rate: number) { requested = [channels, frames, rate] }
      createBufferSource() { return { buffer: null, connect: () => undefined, start: () => undefined } }
      get destination() { return {} }
      startRendering(): Promise<AudioBuffer> { return Promise.resolve({ getChannelData: () => rendered } as unknown as AudioBuffer) }
    })
    const capture = await startCapture()
    expect(await capture.stop()).toBe(rendered)
    expect(requested).toEqual([1, 32_000, CAPTURE_SAMPLE_RATE])
  })

  it('does not wait for a stop from a recorder that already ended', async () => {
    installRecorder(AT_RATE)
    class EndedRecorder {
      state = 'inactive'
      mimeType = 'audio/webm'
      start(): void { /* the device went away before anything was recorded */ }
      stop(): void { throw new Error('the recorder already ended') }
      addEventListener(): void { /* no further events arrive */ }
    }
    vi.stubGlobal('MediaRecorder', EndedRecorder)
    const capture = await startCapture()
    expect(await capture.stop()).toHaveLength(CAPTURE_SAMPLE_RATE)
    expect(stopped).toBe(1)
  })

  it('releases the device on a cancel, and a second stop is quiet', async () => {
    installRecorder(AT_RATE)
    const capture = await startCapture()
    capture.cancel()
    expect(stopped).toBe(1)
    capture.cancel()
    expect(stopped).toBe(2)
  })
})

describe('the route calls', () => {
  it('answer undefined when the state route cannot be reached or refuses', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    await expect(speechState()).resolves.toBeUndefined()
    await expect(prepareSpeech()).resolves.toBeUndefined()

    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 500 })))
    await expect(speechState()).resolves.toBeUndefined()
    await expect(prepareSpeech()).resolves.toBeUndefined()
  })

  it('read the readiness each route publishes', async () => {
    vi.stubGlobal('fetch', (input: string) => Promise.resolve(new Response(
      JSON.stringify(input.includes('prepare') ? { readiness: { state: 'ready' } } : { providers: [], readiness: { state: 'ready' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    await expect(speechState()).resolves.toEqual({ providers: [], readiness: { state: 'ready' } })
    await expect(prepareSpeech()).resolves.toEqual({ state: 'ready' })
  })

  it('report an unreachable host as a refused capture', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    await expect(transcribeCapture(new Float32Array(8))).resolves
      .toEqual({ kind: 'refused', refusal: 'failed', message: 'the host could not be reached' })
  })

  it('fill in a refusal the seam did not describe', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })))
    await expect(transcribeCapture(new Float32Array(8))).resolves
      .toEqual({ kind: 'refused', refusal: 'failed', message: 'the capture was refused' })
  })

  it('fill in a transcript the seam answered without fields', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(transcribeCapture(new Float32Array(8))).resolves.toEqual({ kind: 'text', text: '', confident: false })
  })

  it('report an unreachable host as a send that did not land', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    await expect(sendToAgent('s-nova', 'hello')).resolves.toBe(false)
  })
})

describe('the speech notice', () => {
  it('is unread until it is remembered', () => {
    expect(speechNoticeSeen()).toBe(false)
    rememberSpeechNotice()
    expect(speechNoticeSeen()).toBe(true)
  })

  it('reads as unread when storage cannot be reached, and remembering it stays quiet', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('no storage') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('no storage') })
    expect(speechNoticeSeen()).toBe(false)
    expect(() => { rememberSpeechNotice() }).not.toThrow()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})

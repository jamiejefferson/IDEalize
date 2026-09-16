// The on-device provider with the library stubbed: what readiness says before,
// during and after a preparation, how the progress callback sums files into one
// percentage, that a second prepare joins the first rather than starting another,
// what happens to a run that is aborted, and how a non-speech marker is read.
import { afterEach, describe, expect, it, vi } from 'vitest'

const pipeline = vi.fn()
const env = { cacheDir: '' }
vi.mock('@huggingface/transformers', () => ({ env, pipeline }))

const { localWhisper, LOCAL_WHISPER_ID, WHISPER_SAMPLE_RATE } = await import('../src/local-whisper.ts')
const { TranscriptionError } = await import('../src/error.ts')

/** A provider over the stubbed library. */
function provider() {
  return localWhisper({ model: 'onnx-community/whisper-base.en', dtype: 'q8', cacheDir: '/tmp/models' })
}

/** A capture long enough to be speech, which this provider never checks itself. */
const SAMPLES = new Float32Array(16_000)

/** The spec shape the runtime hands a provider. */
function specFor(target: ReturnType<typeof provider>) {
  return { provider: target, samples: SAMPLES, sampleRate: WHISPER_SAMPLE_RATE }
}

afterEach(() => {
  pipeline.mockReset()
  env.cacheDir = ''
})

describe('the on-device provider', () => {
  it('describes itself as on-device, at whisper’s rate, under its model name', () => {
    expect(provider().describe()).toEqual({
      id: LOCAL_WHISPER_ID,
      label: 'On-device whisper',
      location: 'on-device',
      model: 'onnx-community/whisper-base.en',
      sampleRate: 16_000,
    })
  })

  it('reads as preparing at nothing until the model is asked for', async () => {
    await expect(provider().readiness()).resolves.toEqual({ state: 'preparing', percent: 0 })
  })

  it('points the library at the configured cache directory and becomes ready', async () => {
    pipeline.mockResolvedValue(() => Promise.resolve({ text: '' }))
    const target = provider()
    await expect(target.prepare()).resolves.toEqual({ state: 'ready' })
    expect(env.cacheDir).toBe('/tmp/models')
    expect(pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'onnx-community/whisper-base.en', expect.objectContaining({ dtype: 'q8' }))
    await expect(target.readiness()).resolves.toEqual({ state: 'ready' })
  })

  it('sums every file the progress callback reports into one percentage', async () => {
    let report: ((event: { file?: string; loaded?: number; total?: number }) => void) | undefined
    let settle: (() => void) | undefined
    const held = new Promise<void>((resolve) => { settle = resolve })
    pipeline.mockImplementation(async (_task: string, _model: string, options: { progress_callback: typeof report }) => {
      report = options.progress_callback
      await held
      return () => Promise.resolve({ text: '' })
    })
    const target = provider()
    const preparing = target.prepare()
    await vi.waitFor(() => { expect(report).toBeDefined() })
    report!({ file: 'encoder.onnx', loaded: 25, total: 100 })
    report!({ file: 'decoder.onnx', loaded: 25, total: 100 })
    // A file announced before any byte arrived counts as nothing downloaded.
    report!({ file: 'tokenizer.json', total: 0 })
    await expect(target.readiness()).resolves.toEqual({ state: 'preparing', percent: 25 })
    report!({ file: 'encoder.onnx', loaded: 100, total: 100 })
    await expect(target.readiness()).resolves.toEqual({ state: 'preparing', percent: 63 })
    settle!()
    await preparing
    await expect(target.readiness()).resolves.toEqual({ state: 'ready' })
  })

  it('ignores a progress event that names no file or no size', async () => {
    let report: ((event: { file?: string; loaded?: number; total?: number }) => void) | undefined
    let settle: (() => void) | undefined
    const held = new Promise<void>((resolve) => { settle = resolve })
    pipeline.mockImplementation(async (_task: string, _model: string, options: { progress_callback: typeof report }) => {
      report = options.progress_callback
      await held
      return () => Promise.resolve({ text: '' })
    })
    const target = provider()
    const preparing = target.prepare()
    await vi.waitFor(() => { expect(report).toBeDefined() })
    report!({ loaded: 10, total: 100 })
    report!({ file: 'encoder.onnx', loaded: 10 })
    report!({ file: 'encoder.onnx', loaded: 10, total: 0 })
    await expect(target.readiness()).resolves.toEqual({ state: 'preparing', percent: 0 })
    // Announced with a size but no bytes yet: nothing of it has arrived.
    report!({ file: 'decoder.onnx', total: 200 })
    await expect(target.readiness()).resolves.toEqual({ state: 'preparing', percent: 0 })
    settle!()
    await preparing
  })

  it('joins an in-flight preparation rather than starting a second', async () => {
    let settle: ((value: unknown) => void) | undefined
    pipeline.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
    const target = provider()
    const first = target.prepare()
    const second = target.prepare()
    await vi.waitFor(() => { expect(settle).toBeDefined() })
    settle!(() => Promise.resolve({ text: '' }))
    await Promise.all([first, second])
    expect(pipeline).toHaveBeenCalledTimes(1)
  })

  it('reports what a failed preparation failed on, and stays unavailable', async () => {
    pipeline.mockRejectedValue(new Error('network unreachable'))
    const target = provider()
    await expect(target.prepare()).resolves.toEqual({ state: 'unavailable', detail: 'network unreachable' })
    await expect(target.readiness()).resolves.toEqual({ state: 'unavailable', detail: 'network unreachable' })
  })

  it('reports a rejection that is not an Error by its text', async () => {
    pipeline.mockRejectedValue('out of disk')
    await expect(provider().prepare()).resolves.toEqual({ state: 'unavailable', detail: 'out of disk' })
  })

  it('answers ready without loading again once it is loaded', async () => {
    pipeline.mockResolvedValue(() => Promise.resolve({ text: '' }))
    const target = provider()
    await target.prepare()
    await expect(target.prepare()).resolves.toEqual({ state: 'ready' })
    expect(pipeline).toHaveBeenCalledTimes(1)
  })

  it('refuses to transcribe before the model is loaded', async () => {
    const target = provider()
    const error = await target.transcribe(specFor(target)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TranscriptionError)
    expect((error as InstanceType<typeof TranscriptionError>).refusal).toBe('not-ready')
  })

  it('trims the transcript and calls it confident', async () => {
    pipeline.mockResolvedValue(() => Promise.resolve({ text: '  move the plan icon  ' }))
    const target = provider()
    await target.prepare()
    await expect(target.transcribe(specFor(target))).resolves.toMatchObject({ text: 'move the plan icon', confident: true })
  })

  it('reads a chunked result’s first text', async () => {
    pipeline.mockResolvedValue(() => Promise.resolve([{ text: ' first chunk ' }, { text: ' second ' }]))
    const target = provider()
    await target.prepare()
    await expect(target.transcribe(specFor(target))).resolves.toMatchObject({ text: 'first chunk' })
  })

  it('reads an empty chunked result as no speech', async () => {
    pipeline.mockResolvedValue(() => Promise.resolve([]))
    const target = provider()
    await target.prepare()
    await expect(target.transcribe(specFor(target))).resolves.toMatchObject({ text: '', confident: false })
  })

  it('reads a non-speech marker as no speech, and never as confident', async () => {
    pipeline.mockResolvedValue(() => Promise.resolve({ text: '[BLANK_AUDIO]' }))
    const target = provider()
    await target.prepare()
    await expect(target.transcribe(specFor(target))).resolves.toMatchObject({ text: '', confident: false })
  })

  it('rejects a run whose signal was already aborted, without calling the model', async () => {
    const recogniser = vi.fn(() => Promise.resolve({ text: 'never read' }))
    pipeline.mockResolvedValue(recogniser)
    const target = provider()
    await target.prepare()
    await expect(target.transcribe(specFor(target), AbortSignal.abort())).rejects.toThrow()
    expect(recogniser).not.toHaveBeenCalled()
  })

  it('drops the text of a run cancelled while the model was working', async () => {
    const controller = new AbortController()
    pipeline.mockResolvedValue(() => {
      controller.abort()
      return Promise.resolve({ text: 'arrived after the cancel' })
    })
    const target = provider()
    await target.prepare()
    await expect(target.transcribe(specFor(target), controller.signal)).rejects.toThrow()
  })
})

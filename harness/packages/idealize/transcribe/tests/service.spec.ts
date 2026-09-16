// The seam's own behaviour over a stub provider: registration and its
// disposer, the resolve step's provider choice and capture bounds, and what
// dispatch does with a provider that is not ready or that throws.
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranscriptionError } from '../src/error.ts'
import { TranscriptionRuntime } from '../src/service.ts'
import type { TranscriptionProvider, TranscriptionReadiness, TranscriptionResult } from '../src/types.ts'

const BOUNDS = { minCaptureMs: 400, maxCaptureMs: 5_000 }

/** A provider that answers whatever the test wants, and records what it was asked. */
function stub(id: string, options: {
  readiness?: TranscriptionReadiness
  sampleRate?: number
  result?: TranscriptionResult
  fail?: Error
} = {}): TranscriptionProvider & { calls: number } {
  const provider = {
    id,
    calls: 0,
    describe: () => ({ id, label: id, location: 'on-device' as const, model: 'test', sampleRate: options.sampleRate ?? 16_000 }),
    readiness: () => Promise.resolve(options.readiness ?? { state: 'ready' as const }),
    prepare: () => Promise.resolve(options.readiness ?? { state: 'ready' as const }),
    transcribe: () => {
      provider.calls += 1
      if (options.fail !== undefined) return Promise.reject(options.fail)
      return Promise.resolve(options.result ?? { text: 'hello', confident: true, ms: 1 })
    },
  }
  return provider
}

/** One second of samples at 16 kHz, which sits inside the bounds. */
const ONE_SECOND = new Float32Array(16_000)

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/** A context carrying the runtime. */
async function boot(bounds = BOUNDS): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(TranscriptionRuntime, bounds)
  return ctx
}

describe('the transcription registry', () => {
  it('lists what is registered and refuses a duplicate id', async () => {
    const ctx = await boot()
    ctx.transcription.register(stub('one'))
    expect(ctx.transcription.list().map(row => row.id)).toEqual(['one'])
    expect(() => ctx.transcription.register(stub('one'))).toThrow(/already registered/)
  })

  it('gives back a disposer that removes the provider it registered', async () => {
    const ctx = await boot()
    const dispose = ctx.transcription.register(stub('one'))
    expect(ctx.transcription.list()).toHaveLength(1)
    dispose()
    await vi.waitFor(() => { expect(ctx.transcription.list()).toHaveLength(0) })
  })

  it('names every provider when a capture could reach more than one', async () => {
    const ctx = await boot()
    ctx.transcription.register(stub('one'))
    ctx.transcription.register(stub('two'))
    expect(() => ctx.transcription.resolve({ samples: ONE_SECOND, sampleRate: 16_000 }))
      .toThrow(/name one of one, two/)
  })

  it('resolves the pinned provider and refuses an id nothing registered', async () => {
    const ctx = await boot()
    const one = stub('one')
    ctx.transcription.register(one)
    ctx.transcription.register(stub('two'))
    expect(ctx.transcription.resolve({ samples: ONE_SECOND, sampleRate: 16_000, provider: 'one' }).provider).toBe(one)
    expect(() => ctx.transcription.resolve({ samples: ONE_SECOND, sampleRate: 16_000, provider: 'three' }))
      .toThrow(/no provider with id "three"/)
  })

  it('refuses every capture while nothing is registered', async () => {
    const ctx = await boot()
    expect(() => ctx.transcription.resolve({ samples: ONE_SECOND, sampleRate: 16_000 }))
      .toThrow(/no provider is registered/)
  })
})

describe('the resolve step', () => {
  it('holds a capture to the provider sample rate', async () => {
    const ctx = await boot()
    ctx.transcription.register(stub('one'))
    expect(() => ctx.transcription.resolve({ samples: ONE_SECOND, sampleRate: 44_100 }))
      .toThrow(/requires 16000 Hz, the capture is 44100 Hz/)
  })

  it('refuses a capture below the floor and above the ceiling', async () => {
    const ctx = await boot()
    ctx.transcription.register(stub('one'))
    const short = ctx.transcription.resolve.bind(ctx.transcription)
    expect(() => short({ samples: new Float32Array(1_600), sampleRate: 16_000 })).toThrow(/below the 400 ms floor/)
    expect(() => short({ samples: new Float32Array(16_000 * 6), sampleRate: 16_000 })).toThrow(/above the 5000 ms ceiling/)
  })

  it('carries the capture through unchanged when it fits', async () => {
    const ctx = await boot()
    ctx.transcription.register(stub('one'))
    const spec = ctx.transcription.resolve({ samples: ONE_SECOND, sampleRate: 16_000 })
    expect(spec.samples).toBe(ONE_SECOND)
    expect(spec.sampleRate).toBe(16_000)
  })
})

describe('dispatch', () => {
  it('runs the resolved provider and answers its transcript', async () => {
    const ctx = await boot()
    const one = stub('one', { result: { text: 'move the plan icon', confident: true, ms: 12 } })
    ctx.transcription.register(one)
    await expect(ctx.transcription.transcribe({ samples: ONE_SECOND, sampleRate: 16_000 }))
      .resolves.toEqual({ text: 'move the plan icon', confident: true, ms: 12 })
    expect(one.calls).toBe(1)
  })

  it('reports readiness rather than running a provider that is still preparing', async () => {
    const ctx = await boot()
    const one = stub('one', { readiness: { state: 'preparing', percent: 40 } })
    ctx.transcription.register(one)
    await expect(ctx.transcription.transcribe({ samples: ONE_SECOND, sampleRate: 16_000 }))
      .rejects.toThrow(/is not ready: preparing \(40%\)/)
    expect(one.calls).toBe(0)
  })

  it('reports the detail of a provider that cannot run at all', async () => {
    const ctx = await boot()
    ctx.transcription.register(stub('one', { readiness: { state: 'unavailable', detail: 'no disk space' } }))
    await expect(ctx.transcription.transcribe({ samples: ONE_SECOND, sampleRate: 16_000 }))
      .rejects.toThrow(/is not ready: no disk space/)
  })

  it('wraps a provider failure as a refusal that keeps the cause', async () => {
    const ctx = await boot()
    const cause = new Error('onnx session closed')
    ctx.transcription.register(stub('one', { fail: cause }))
    const error = await ctx.transcription.transcribe({ samples: ONE_SECOND, sampleRate: 16_000 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TranscriptionError)
    expect((error as TranscriptionError).refusal).toBe('failed')
    expect((error as TranscriptionError).cause).toBe(cause)
  })

  it('passes a refusal the provider itself raised through unchanged', async () => {
    const ctx = await boot()
    const refusal = new TranscriptionError('not-ready', 'the on-device model is not loaded')
    ctx.transcription.register(stub('one', { fail: refusal }))
    await expect(ctx.transcription.transcribe({ samples: ONE_SECOND, sampleRate: 16_000 })).rejects.toBe(refusal)
  })

  it('answers readiness and prepare for the provider a capture would reach', async () => {
    const ctx = await boot()
    ctx.transcription.register(stub('one', { readiness: { state: 'preparing', percent: 7 } }))
    await expect(ctx.transcription.readiness()).resolves.toEqual({ state: 'preparing', percent: 7 })
    await expect(ctx.transcription.prepare('one')).resolves.toEqual({ state: 'preparing', percent: 7 })
  })
})

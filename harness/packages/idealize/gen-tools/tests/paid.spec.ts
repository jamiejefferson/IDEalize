// A generation charges the person's own account: one call is capped (security
// pass, 4 Nov 2026), and the first use of each paid model waits for their yes,
// which is then kept (one core model, 24 Nov 2026).
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import type { GenCatalogEntry } from '@idealize/generate'
import {
  approvalKey, assertWithinCaps, confirmPaidGeneration, MAX_COUNT, MAX_SECONDS, mayCharge, paidQuestion,
  type ApprovedModels,
} from '../src/paid.ts'
import { approvedModels, approvedOf, approvedRows, GEN_TOOLS_NS, GenToolsSettings } from '../src/approved.ts'

const priced = (price?: NonNullable<GenCatalogEntry['model']['price']>): GenCatalogEntry =>
  ({ backend: 'queue', model: { id: 'flux', name: 'Flux Pro', artefact: 'image', outputMediaTypes: ['image/png'], ...price === undefined ? {} : { price } } }) as unknown as GenCatalogEntry

const PAID = priced({ unitPrice: 0.04, unit: 'image', currency: 'USD', perOutput: { amount: 0.04, output: 'image' } })

function sessionWith(...events: { type: string; data?: unknown }[]): Session {
  return { events, header: { id: 's' } } as unknown as Session
}

const call = (session: Session) => ({ agent: { session }, toolName: 'generate_image', callId: 'c1' })

/** An approved-models store over a plain map. */
function store(initial: Record<string, string> = {}): ApprovedModels & { kept: Record<string, string> } {
  const kept = { ...initial }
  return { kept, has: key => Object.hasOwn(kept, key), add: (key, name) => { kept[key] = name; return Promise.resolve() } }
}

describe('the caps on one generation', () => {
  it('states its numbers', () => {
    expect(MAX_COUNT).toBe(8)
    expect(MAX_SECONDS).toEqual({ video: 60, audio: 300 })
  })

  it('lets the composer\'s own options through', () => {
    expect(() => { assertWithinCaps('generate_image', 'image', { count: 4 }) }).not.toThrow()
    expect(() => { assertWithinCaps('generate_video', 'video', { duration_s: 10, options: { resolution: '1080p' } }) }).not.toThrow()
    expect(() => { assertWithinCaps('generate_audio', 'audio', { options: { duration: 'auto', music_length_ms: 180_000 } }) }).not.toThrow()
    // Frames, on the video models that use the word.
    expect(() => { assertWithinCaps('generate_video', 'video', { options: { length: 81 } }) }).not.toThrow()
  })

  it.each([
    ['generate_image', 'image', { count: 1000 }],
    ['generate_image', 'image', { options: { num_images: 9 } }],
    ['generate_image', 'image', { options: { n: '50' } }],
    ['generate_video', 'video', { duration_s: 3600 }],
    ['generate_video', 'video', { options: { duration: '120' } }],
    ['generate_video', 'video', { options: { duration_seconds: 61 } }],
    ['generate_audio', 'audio', { duration_s: 301 }],
    ['generate_audio', 'audio', { options: { seconds_total: 900 } }],
    ['generate_audio', 'audio', { options: { length: 900 } }],
    ['generate_audio', 'audio', { options: { music_length_ms: 600_000 } }],
  ] as const)('refuses %s %s %j', (tool, artefact, args) => {
    expect(() => { assertWithinCaps(tool, artefact, args) }).toThrow(/at most/)
  })
})

describe('asking before the first use of each paid model', () => {
  it('knows what may charge and says so plainly', () => {
    expect(mayCharge(PAID)).toBe(true)
    expect(mayCharge(priced())).toBe(true)
    expect(mayCharge(priced({ unitPrice: 0, unit: 'image', currency: 'USD' }))).toBe(false)
    expect(approvalKey(PAID)).toBe('queue/flux')
    expect(paidQuestion(PAID)).toContain('Studio wants to use Flux Pro. It costs about 0.04 USD per image')
    expect(paidQuestion(priced({ unitPrice: 0.5, unit: 'second', currency: 'USD' }))).toContain('It costs 0.5 USD per second')
    expect(paidQuestion(priced())).toContain('publishes no price')
  })

  it('asks once per model, keeps the yes, and asks afresh for another model', async () => {
    const request = vi.fn(() => Promise.resolve('allowed-once'))
    const approved = store()
    await confirmPaidGeneration({ request }, approved, call(sessionWith()), PAID)
    await confirmPaidGeneration({ request }, approved, call(sessionWith()), PAID)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]).toMatchObject([{ toolName: 'generate_image', reason: expect.stringContaining('Flux Pro') as string }])
    expect(approved.kept).toEqual({ 'queue/flux': 'Flux Pro' })
    const other: GenCatalogEntry = { backend: 'queue', model: { ...PAID.model, id: 'veo', name: 'Veo' } }
    await confirmPaidGeneration({ request }, approved, call(sessionWith()), other)
    expect(request).toHaveBeenCalledTimes(2)
    expect(approved.kept).toEqual({ 'queue/flux': 'Flux Pro', 'queue/veo': 'Veo' })
  })

  it('asks even when the person typed the request, because the price is what they approve', async () => {
    const request = vi.fn(() => Promise.resolve('allowed-once'))
    const typed = sessionWith({ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'user' } } })
    await confirmPaidGeneration({ request }, store(), call(typed), PAID)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('raises one question for a burst on one model', async () => {
    let answer: (value: string) => void = () => undefined
    const request = vi.fn(() => new Promise<string>((resolve) => { answer = resolve }))
    const approved = store()
    const burst = [1, 2, 3].map(() => confirmPaidGeneration({ request }, approved, call(sessionWith()), PAID))
    answer('allowed-once')
    await Promise.all(burst)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['rejected', 'cancelled', 'unavailable'])('generates nothing on %s, and asks again next time', async (outcome) => {
    const request = vi.fn(() => Promise.resolve(outcome))
    const approved = store()
    await expect(confirmPaidGeneration({ request }, approved, call(sessionWith()), PAID)).rejects.toThrow(/did not allow Flux Pro/)
    await expect(confirmPaidGeneration({ request }, approved, call(sessionWith()), PAID)).rejects.toThrow(/did not allow/)
    expect(request).toHaveBeenCalledTimes(2)
    expect(approved.kept).toEqual({})
  })

  it('skips a free model and a model already approved', async () => {
    const request = vi.fn(() => Promise.resolve('rejected'))
    await confirmPaidGeneration({ request }, store(), call(sessionWith()), priced({ unitPrice: 0, unit: 'image', currency: 'USD' }))
    await confirmPaidGeneration({ request }, store({ 'queue/flux': 'Flux Pro' }), call(sessionWith()), PAID)
    expect(request).not.toHaveBeenCalled()
  })

  it('runs without asking on Full access, whose policy has no prompt, and with nobody to ask or nowhere to keep the answer', async () => {
    const request = vi.fn(() => Promise.resolve('rejected'))
    await confirmPaidGeneration({ request, overrideOf: () => 'never' }, store(), call(sessionWith()), PAID)
    await confirmPaidGeneration({ request, config: { policy: 'never' } }, store(), call(sessionWith()), PAID)
    await confirmPaidGeneration(undefined, store(), call(sessionWith()), PAID)
    await confirmPaidGeneration({ request }, undefined, call(sessionWith()), PAID)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('the approved models kept in settings', () => {
  it('reads and writes the section through the settings service', async () => {
    let section: unknown
    const settings = {
      get: vi.fn(() => section),
      update: vi.fn((_ns: unknown, patch: unknown) => { section = patch; return Promise.resolve() }),
    }
    expect(approvedModels(undefined)).toBeUndefined()
    const approved = approvedModels(settings)
    expect(approvedOf(settings)).toEqual({})
    expect(approved?.has('queue/flux')).toBe(false)
    await approved?.add('queue/flux', 'Flux Pro')
    expect(settings.update).toHaveBeenCalledWith(GEN_TOOLS_NS, { approved: { 'queue/flux': 'Flux Pro' } })
    expect(approved?.has('queue/flux')).toBe(true)
    expect(approved?.has('toString')).toBe(false)
  })

  it('defaults to nothing approved, and lists rows by name', () => {
    expect(GenToolsSettings({})).toEqual({ approved: {} })
    expect(approvedRows({ 'fal/fal-ai/veo3': 'Veo 3', 'openrouter/google/imagen': 'Imagen', odd: 'Odd' })).toEqual([
      { key: 'openrouter/google/imagen', backend: 'openrouter', model: 'google/imagen', name: 'Imagen' },
      { key: 'odd', backend: 'odd', model: '', name: 'Odd' },
      { key: 'fal/fal-ai/veo3', backend: 'fal', model: 'fal-ai/veo3', name: 'Veo 3' },
    ])
  })
})

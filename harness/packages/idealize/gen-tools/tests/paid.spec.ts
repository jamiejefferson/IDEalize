// A generation charges the person's own account: one call is capped, and the
// first one nobody typed a request for waits for their yes (security pass, 4 Nov 2026).
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import type { GenCatalogEntry } from '@idealize/generate'
import {
  ASK_WHEN_PERSON_TYPED, assertWithinCaps, confirmPaidGeneration, forgetPaidConfirmation,
  MAX_COUNT, MAX_SECONDS, mayCharge, paidQuestion, personTypedThisTurn,
} from '../src/paid.ts'

const priced = (price?: NonNullable<GenCatalogEntry['model']['price']>): GenCatalogEntry =>
  ({ backend: 'queue', model: { id: 'flux', name: 'Flux Pro', artefact: 'image', outputMediaTypes: ['image/png'], ...price === undefined ? {} : { price } } }) as unknown as GenCatalogEntry

const PAID = priced({ unitPrice: 0.04, unit: 'image', currency: 'USD', perOutput: { amount: 0.04, output: 'image' } })

function sessionWith(...events: { type: string; data?: unknown }[]): Session {
  return { events, header: { id: 's' } } as unknown as Session
}

const call = (session: Session) => ({ agent: { session }, toolName: 'generate_image', callId: 'c1' })

afterEach(() => {
  forgetPaidConfirmation()
})

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

describe('asking before the first paid generation', () => {
  it('knows what may charge and says so plainly', () => {
    expect(mayCharge(PAID)).toBe(true)
    expect(mayCharge(priced())).toBe(true)
    expect(mayCharge(priced({ unitPrice: 0, unit: 'image', currency: 'USD' }))).toBe(false)
    expect(paidQuestion(PAID)).toContain('about 0.04 USD per image')
    expect(paidQuestion(priced())).toContain('publishes no price')
  })

  it('asks once per launch, and a yes holds for every chat', async () => {
    const request = vi.fn(() => Promise.resolve('allowed-once'))
    await confirmPaidGeneration({ request }, call(sessionWith()), PAID)
    await confirmPaidGeneration({ request }, call(sessionWith()), PAID)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]).toMatchObject([{ toolName: 'generate_image', reason: expect.stringContaining('Flux Pro') as string }])
  })

  it('raises one question for a burst', async () => {
    let answer: (value: string) => void = () => undefined
    const request = vi.fn(() => new Promise<string>((resolve) => { answer = resolve }))
    const burst = [1, 2, 3].map(() => confirmPaidGeneration({ request }, call(sessionWith()), PAID))
    answer('allowed-once')
    await Promise.all(burst)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['rejected', 'cancelled', 'unavailable'])('generates nothing on %s, and asks again next time', async (outcome) => {
    const request = vi.fn(() => Promise.resolve(outcome))
    await expect(confirmPaidGeneration({ request }, call(sessionWith()), PAID)).rejects.toThrow(/did not allow/)
    await expect(confirmPaidGeneration({ request }, call(sessionWith()), PAID)).rejects.toThrow(/did not allow/)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('skips a free model, and a turn the person typed in', async () => {
    const request = vi.fn(() => Promise.resolve('rejected'))
    await confirmPaidGeneration({ request }, call(sessionWith()), priced({ unitPrice: 0, unit: 'image', currency: 'USD' }))
    const typed = sessionWith({ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'user' } } })
    await confirmPaidGeneration({ request }, call(typed), PAID)
    expect(ASK_WHEN_PERSON_TYPED).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('asks when another chat started it, when a note woke it, and in a later turn than the person\'s', async () => {
    const brief = sessionWith({ type: 'user/message', data: { source: { kind: 'chat-brief' } } }, { type: 'turn/start' })
    const wake = sessionWith(
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'turn/end' },
      { type: 'user/message', data: { source: { kind: 'plugin' } } },
      { type: 'turn/start' },
    )
    expect(personTypedThisTurn(brief)).toBe(false)
    expect(personTypedThisTurn(wake)).toBe(false)
    const request = vi.fn(() => Promise.resolve('rejected'))
    await expect(confirmPaidGeneration({ request }, call(brief), PAID)).rejects.toThrow(/did not allow/)
    await expect(confirmPaidGeneration({ request }, call(wake), PAID)).rejects.toThrow(/did not allow/)
  })

  it('runs without asking on Full access, whose policy has no prompt, and with no approval service', async () => {
    const request = vi.fn(() => Promise.resolve('rejected'))
    await confirmPaidGeneration({ request, overrideOf: () => 'never' }, call(sessionWith()), PAID)
    await confirmPaidGeneration({ request, config: { policy: 'never' } }, call(sessionWith()), PAID)
    await confirmPaidGeneration(undefined, call(sessionWith()), PAID)
    expect(request).not.toHaveBeenCalled()
  })
})

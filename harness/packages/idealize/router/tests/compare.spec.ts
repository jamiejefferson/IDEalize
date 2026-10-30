import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { GenCatalogEntry } from '@idealize/generate'
import { describe, expect, it } from 'vitest'
import { askBefore, compareCost, foldCompare, foldMediaKept, keptNote, lastReply } from '../src/compare.ts'
import { decideMedia, hasStarsFor, mediaAlternativesFor, mediaCost, mediaTagFor, readableTags } from '../src/media.ts'
import { setStars } from '../src/ratings.ts'
import type { RatingsFile } from '../src/ratings.ts'

const at = '2026-10-28T12:00:00.000Z'
let seq = 0
const event = (type: string, data: unknown, extra: Record<string, unknown> = {}): SessionEvent =>
  ({ type, seq: seq++, time: 0, data, ...extra }) as unknown as SessionEvent
const ask = (text: string) => event('user/message', { id: `u${String(seq)}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }, { surfaceOp: 'append' })
const reply = (turn: number, text: string, model = 'claude-sonnet-5') => event('assistant/message', {
  turn, step: 1,
  message: { id: `a${String(seq)}`, role: 'assistant', source: { kind: 'model', provider: 'anthropic', model }, content: [{ type: 'text', text }] },
  usage: { inputTokens: 1000, outputTokens: 500 },
}, { surfaceOp: 'append' })

function chat(): SessionEvent[] {
  seq = 0
  return [
    ask('Write a haiku about rain'),
    event('turn/start', { turn: 1 }),
    reply(1, 'Rain on the tin roof'),
    event('turn/end', { turn: 1 }),
  ]
}

describe('the reply a dislike is about', () => {
  it('is the closing reply of the last finished turn', () => {
    expect(lastReply(chat())).toMatchObject({ seq: 2, turn: 1, provider: 'anthropic', model: 'claude-sonnet-5', text: 'Rain on the tin roof' })
  })

  it('is nothing while a turn runs', () => {
    const events = [...chat(), ask('Another'), event('turn/start', { turn: 2 })]
    expect(lastReply(events)).toBeUndefined()
  })

  it('reads the history up to the person\'s ask', () => {
    const events = chat()
    const session = {
      events,
      surface: { nodes: [0, 2] },
      deriveEventMessage: (item: SessionEvent) => item.type === 'user/message' ? item.data : item.type === 'assistant/message' ? item.data.message : null,
    }
    const asked = askBefore(session, 2)
    expect(asked?.ask).toBe('Write a haiku about rain')
    expect(asked?.messages).toHaveLength(1)
  })
})

describe('what both runs cost', () => {
  it('prices each alternative on the reply\'s own tokens', () => {
    const cost = compareCost([{ input: 2, output: 10 }, 'free'], { inputTokens: 1000, outputTokens: 500 })
    expect(cost).toEqual({ amount: (1000 * 2 + 500 * 10) / 1_000_000 })
  })

  it('says unknown when a price is missing', () => {
    expect(compareCost([undefined], { inputTokens: 1, outputTokens: 1 })).toEqual({ unknown: true })
  })
})

describe('a comparison in the log', () => {
  it('folds its steps', () => {
    seq = 10
    const events = [
      event('idealize/router-compare', { id: 'c1', phase: 'started', at, alternatives: [{ provider: 'p', model: 'a', label: 'A' }, { provider: 'p', model: 'b', label: 'B' }] }),
      event('idealize/router-compare', { id: 'c1', phase: 'answer', at, index: 1, text: 'from B' }),
      event('idealize/router-compare', { id: 'c1', phase: 'picked', at, index: 1 }),
    ]
    const state = foldCompare(events, 'c1')
    expect(state?.answers[1]?.text).toBe('from B')
    expect(state?.answers[0]).toBeUndefined()
    expect(state?.picked).toBe(1)
  })

  it('names the kept model in the note the model reads', () => {
    expect(keptNote('GPT-5.5', 'An answer')).toMatch(/kept this answer, from GPT-5\.5\..*\n\nAn answer$/s)
  })

  it('holds a kept media model for its preset only', () => {
    seq = 20
    const kept = event('idealize/router-media', { outcome: 'kept', at, presetId: 'images', from: { provider: 'fal', model: 'x', label: 'X' }, to: { provider: 'fal', model: 'y', label: 'Y' } })
    expect(foldMediaKept([kept], 'images')?.to.model).toBe('y')
    expect(foldMediaKept([kept], 'sound')).toBeUndefined()
  })
})

const media = (id: string, amount?: number, extra: Partial<GenCatalogEntry['model']> = {}): GenCatalogEntry => ({
  backend: 'fal',
  model: { id, name: id.toUpperCase(), artefact: 'image', outputMediaTypes: ['image/png'], ...amount === undefined ? {} : { price: { unitPrice: amount, unit: 'image', currency: 'USD', perOutput: { amount, output: 'image' } } }, ...extra } as GenCatalogEntry['model'],
})
const fresh = (): RatingsFile => ({ version: 1, models: {} })
const image = (model: string) => ({ kind: 'image' as const, provider: 'fal', model })

describe('the router in the generating spaces', () => {
  const stored = media('fal-ai/plain', 0.03)
  const flux = media('fal-ai/flux-pro', 0.05)
  const cheap = media('fal-ai/cheap', 0.01)

  it('moves nothing without stars for the kind', () => {
    expect(hasStarsFor(fresh(), 'image')).toBe(false)
  })

  it('moves a generation to the model rated highest for the work', () => {
    const file = fresh()
    setStars(file, image(flux.model.id), 'illustration', 5, at)
    const decision = decideMedia({ kind: 'image', stored, candidates: [stored, flux, cheap], tag: 'illustration', ratings: file, aggressiveness: 'balanced' })
    expect(decision.use.model.id).toBe('fal-ai/flux-pro')
    expect(decision.rationale).toBe('You rated FAL-AI/FLUX-PRO 5 stars for illustration.')
  })

  it('stays when the stored choice is rated as high', () => {
    const file = fresh()
    setStars(file, image(flux.model.id), 'illustration', 5, at)
    setStars(file, image(stored.model.id), 'illustration', 5, at)
    expect(decideMedia({ kind: 'image', stored, candidates: [stored, flux], tag: 'illustration', ratings: file, aggressiveness: 'balanced' }).switched).toBe(false)
  })

  it('asks five stars on the cautious setting', () => {
    const file = fresh()
    setStars(file, image(flux.model.id), 'illustration', 4, at)
    expect(decideMedia({ kind: 'image', stored, candidates: [stored, flux], tag: 'illustration', ratings: file, aggressiveness: 'conservative' }).switched).toBe(false)
    expect(decideMedia({ kind: 'image', stored, candidates: [stored, flux], tag: 'illustration', ratings: file, aggressiveness: 'balanced' }).switched).toBe(true)
  })

  it('reads a prompt only as work a prompt can ask for', () => {
    expect(readableTags('image', false)).not.toContain('editing')
    expect(readableTags('image', true)).toContain('editing')
    expect(readableTags('audio', false)).not.toContain('cloning')
  })

  it('offers unrated models first, never the one that made the output or a barred one', () => {
    const file = fresh()
    setStars(file, image(flux.model.id), 'illustration', 4, at)
    setStars(file, image('fal-ai/barred'), 'illustration', 1, at)
    const offered = mediaAlternativesFor({
      kind: 'image', current: { backend: 'fal', model: stored.model.id },
      candidates: [stored, flux, cheap, media('fal-ai/barred', 0.001), media('fal-ai/needs-picture', 0.001, { requiredInputs: ['text', 'image'] })],
      tag: 'illustration', ratings: file,
    })
    expect(offered.map(one => one.model.id)).toEqual(['fal-ai/cheap', 'fal-ai/flux-pro'])
  })

  it('prices media runs per output', () => {
    expect(mediaCost([flux, cheap], 2)).toEqual({ amount: (0.05 + 0.01) * 2 })
    expect(mediaCost([media('fal-ai/no-price')], 1)).toEqual({ unknown: true })
  })

  it('opens a model\'s line on the tag it is rated highest for', () => {
    const file = fresh()
    setStars(file, image(flux.model.id), 'anime', 3, at)
    setStars(file, image(flux.model.id), 'photoreal', 5, at)
    expect(mediaTagFor('image', flux.model.id, file)).toBe('photoreal')
  })
})

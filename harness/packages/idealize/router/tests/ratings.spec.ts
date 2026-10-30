import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alternativesFor } from '../src/alternatives.ts'
import { decide, PRESETS } from '../src/decide.ts'
import type { Candidate, Situation } from '../src/decide.ts'
import {
  addMark, RATING_TAGS, RATINGS_FILE, ratingKey, ratingsOf, readRatings, setStars, standing, TASK_TAG, updateRatings,
} from '../src/ratings.ts'
import type { RatingsFile } from '../src/ratings.ts'
import { TASK_TYPES } from '../src/tasks.ts'
import type { TaskReading } from '../src/tasks.ts'

const sonnet: Candidate = { provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5', price: { input: 3, output: 15 }, images: true }
const opus: Candidate = { provider: 'anthropic', model: 'claude-opus-5', label: 'Claude Opus 5', price: { input: 15, output: 75 }, images: true }
const gpt: Candidate = { provider: 'openrouter', model: 'openai/gpt-5.5', label: 'GPT-5.5', price: { input: 2, output: 10 }, images: true }
const gptMini: Candidate = { provider: 'openrouter', model: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', price: { input: 0.25, output: 2 }, images: true }
const gemini: Candidate = { provider: 'openrouter', model: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash', price: { input: 0.3, output: 2.5 }, images: true }
const free: Candidate = { provider: 'freetokens', model: 'auto', label: 'Free tokens', price: 'free', images: false }
const mystery: Candidate = { provider: 'openrouter', model: 'acme/brand-new-1', label: 'Brand New 1', price: { input: 1, output: 1 } }

const writing: TaskReading = { task: 'writing', difficulty: 'moderate', confidence: 0.92, source: 'jev' }
const even = { cost: 1, speed: 1, intelligence: 1 }
const at = '2026-10-28T12:00:00.000Z'
const chat = (candidate: Candidate) => ({ kind: 'chat' as const, provider: candidate.provider, model: candidate.model })

const fresh = (): RatingsFile => ({ version: 1, models: {} })
const standingIn = (file: RatingsFile) => (candidate: Candidate) => standing(file, chat(candidate), 'writing')

describe('the tag lists', () => {
  it('rates every router reading under a chat tag', () => {
    for (const task of TASK_TYPES) expect(RATING_TAGS.chat).toContain(TASK_TAG[task])
  })

  it('gives each kind of model its own list', () => {
    expect(RATING_TAGS.image).toContain('illustration')
    expect(RATING_TAGS.audio).toContain('music')
    expect(RATING_TAGS.video).toContain('sound')
    expect(RATING_TAGS.audio).not.toContain('illustration')
  })
})

describe('the ratings file', () => {
  it('files a chat model under its facts key, whatever route it came through', () => {
    expect(ratingKey({ kind: 'chat', model: 'anthropic/claude-sonnet-5.5' })).toBe(ratingKey({ kind: 'chat', model: 'claude-sonnet-5-5' }))
    expect(ratingKey({ kind: 'image', model: 'fal-ai/flux-2-pro' })).toBe('image:fal-ai/flux-2-pro')
  })

  it('sets and clears stars, and keeps quiet marks under them', () => {
    const file = fresh()
    addMark(file, chat(sonnet), 'writing', -1, at)
    setStars(file, chat(sonnet), 'writing', 5, at, 'Claude Sonnet 5')
    expect(ratingsOf(file, chat(sonnet)).writing).toEqual({ stars: 5, marks: -1, at })
    expect(standing(file, chat(sonnet), 'writing').bonus).toBeGreaterThan(0)
    setStars(file, chat(sonnet), 'writing', undefined, at)
    expect(standing(file, chat(sonnet), 'writing').starred).toBe(false)
    expect(standing(file, chat(sonnet), 'writing').bonus).toBeLessThan(0)
  })

  it('drops a model once nothing about it is left', () => {
    const file = fresh()
    setStars(file, chat(sonnet), 'writing', 3, at)
    setStars(file, chat(sonnet), 'writing', undefined, at)
    expect(file.models).toEqual({})
  })

  it('caps quiet marks at three either way', () => {
    const file = fresh()
    for (let i = 0; i < 6; i++) addMark(file, chat(gpt), 'writing', 1, at)
    expect(ratingsOf(file, chat(gpt)).writing?.marks).toBe(3)
  })

  describe('on disk', () => {
    let home: string
    beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'ratings-')) })
    afterEach(async () => { await rm(home, { recursive: true, force: true }) })

    it('reads no file as no ratings and round-trips a write', async () => {
      expect((await readRatings(home)).models).toEqual({})
      await updateRatings(home, (file) => { setStars(file, { kind: 'image', provider: 'fal', model: 'fal-ai/flux-2-pro' }, 'illustration', 5, at) })
      const read = await readRatings(home)
      expect(standing(read, { kind: 'image', model: 'fal-ai/flux-2-pro' }, 'illustration').stars).toBe(5)
    })

    it('sets a damaged file aside and starts again', async () => {
      await writeFile(join(home, RATINGS_FILE), '{ not json', 'utf8')
      expect((await readRatings(home)).models).toEqual({})
      expect(await readFile(join(home, `${RATINGS_FILE}.damaged`), 'utf8')).toBe('{ not json')
    })

    it('drops a tag that is not on the kind\'s list', async () => {
      await writeFile(join(home, RATINGS_FILE), JSON.stringify({
        version: 1, models: { 'chat:claude-sonnet-5': { kind: 'chat', tags: { writing: { stars: 4, at }, illustration: { stars: 5, at } } } },
      }), 'utf8')
      expect(Object.keys((await readRatings(home)).models['chat:claude-sonnet-5']?.tags ?? {})).toEqual(['writing'])
    })

    it('queues quick writes behind each other', async () => {
      await Promise.all([1, 2, 3, 4, 5].map(stars =>
        updateRatings(home, (file) => { setStars(file, chat(sonnet), 'writing', stars as 1, at) })))
      expect(standing(await readRatings(home), chat(sonnet), 'writing').stars).toBe(5)
    })
  })
})

describe('routing with ratings', () => {
  const situation = (file: RatingsFile, over: Partial<Situation> = {}): Situation => ({
    current: sonnet, candidates: [sonnet, opus, gpt, gemini, free], reading: writing, weights: even,
    gates: PRESETS.balanced, preferFree: false, hasImages: false, standingOf: standingIn(file), ...over,
  })

  it('moves a chat to a model rated five stars for the work, which it would not do unrated', () => {
    expect(decide(situation(fresh())).switched).toBe(false)
    const file = fresh()
    setStars(file, chat(gpt), 'writing', 5, at)
    const decision = decide(situation(file))
    expect(decision.switched).toBe(true)
    expect(decision.use.model).toBe('openai/gpt-5.5')
    expect(decision.rationale).toMatch(/^You rated GPT-5\.5 5 stars for writing/)
  })

  it('never picks a model rated one star for the work', () => {
    const file = fresh()
    setStars(file, chat(opus), 'writing', 1, at)
    const decision = decide(situation(file, { current: gptMini, weights: { cost: 0, speed: 0, intelligence: 1 } }))
    expect(decision.scored.map(model => model.model)).not.toContain('claude-opus-5')
  })

  it('lets a starred model the score table does not know be switched to', () => {
    const file = fresh()
    setStars(file, chat(mystery), 'writing', 5, at)
    const decision = decide(situation(file, { candidates: [sonnet, mystery] }))
    expect(decision.scored.find(model => model.model === mystery.model)?.known).toBe(true)
  })
})

describe('the alternatives a dislike offers', () => {
  const input = (file: RatingsFile, over = {}) => ({
    current: sonnet, candidates: [sonnet, opus, gpt, gptMini, gemini, free, mystery], reading: writing, weights: even,
    hasImages: false, standingOf: standingIn(file), ...over,
  })

  it('offers two models, never the disliked one or the free-token engine', () => {
    const picked = alternativesFor(input(fresh()))
    expect(picked).toHaveLength(2)
    expect(picked.map(model => model.model)).not.toContain('claude-sonnet-5')
    expect(picked.map(model => model.provider)).not.toContain('freetokens')
  })

  it('puts models not yet rated for the work first', () => {
    const file = fresh()
    const best = alternativesFor(input(fresh()))[0]
    if (best === undefined) throw new Error('no alternative')
    setStars(file, chat(best), 'writing', 4, at)
    expect(alternativesFor(input(file)).map(model => model.model)).not.toContain(best.model)
  })

  it('falls back on rated models when too few unrated ones fit', () => {
    const file = fresh()
    setStars(file, chat(opus), 'writing', 4, at)
    const picked = alternativesFor(input(file, { candidates: [sonnet, opus, gpt] }))
    expect(picked.map(model => model.model)).toEqual(['openai/gpt-5.5', 'claude-opus-5'])
  })

  it('takes two families before a second of one', () => {
    const picked = alternativesFor(input(fresh(), { candidates: [sonnet, gpt, gptMini, gemini] }))
    expect(new Set(picked.map(model => model.family)).size).toBe(2)
  })

  it('leaves out an unscored model nobody has rated', () => {
    expect(alternativesFor(input(fresh())).map(model => model.model)).not.toContain('acme/brand-new-1')
  })
})

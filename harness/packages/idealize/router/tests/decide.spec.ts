import { describe, expect, it } from 'vitest'
import { decide, PRESETS, rowFor, score, thriftOf } from '../src/decide.ts'
import type { Candidate, Situation } from '../src/decide.ts'
import type { TaskReading } from '../src/tasks.ts'

const sonnet: Candidate = { provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5', price: { input: 3, output: 15 }, contextWindow: 200_000, images: true }
const opus: Candidate = { provider: 'anthropic', model: 'claude-opus-5', label: 'Claude Opus 5', price: { input: 15, output: 75 }, contextWindow: 200_000, images: true }
const mini: Candidate = { provider: 'openrouter', model: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', price: { input: 0.25, output: 2 }, contextWindow: 128_000, images: true }
const free: Candidate = { provider: 'freetokens', model: 'auto', label: 'Free tokens', price: 'free', images: false }
const mystery: Candidate = { provider: 'openrouter', model: 'acme/brand-new-1', label: 'Brand New 1', price: 'free' }

const hardCode: TaskReading = { task: 'code', difficulty: 'hard', confidence: 0.92, source: 'jev' }
const quick: TaskReading = { task: 'quick', difficulty: 'simple', confidence: 0.92, source: 'jev' }
const even = { cost: 1, speed: 1, intelligence: 1 }

const situation = (over: Partial<Situation>): Situation => ({
  current: sonnet, candidates: [sonnet, opus, mini, free], reading: hardCode, weights: even,
  gates: PRESETS.balanced, preferFree: false, hasImages: false, ...over,
})

describe('scoring', () => {
  it('matches a model to its family row, the small variant before the general one', () => {
    expect(rowFor({ provider: 'openrouter', model: 'openai/gpt-5.4-mini' }).row.family).toBe('GPT mini')
    expect(rowFor({ provider: 'openrouter', model: 'openai/gpt-5.5' }).row.family).toBe('GPT')
    expect(rowFor({ provider: 'anthropic', model: 'claude-opus-5' }).row.family).toBe('Claude Opus')
  })

  it('scores the free-tokens route as one candidate whatever model id it carries', () => {
    expect(rowFor({ provider: 'freetokens', model: 'llama-3.1-8b' })).toEqual(rowFor({ provider: 'freetokens', model: 'auto' }))
  })

  it('gives an unknown model neutral scores under every shipped general model', () => {
    const unknown = rowFor(mystery)
    expect(unknown.known).toBe(false)
    expect(score(mystery, hardCode, { cost: 0, speed: 0, intelligence: 1 }).fit)
      .toBeLessThan(score(free, hardCode, { cost: 0, speed: 0, intelligence: 1 }).fit)
  })

  it('reads a broken pattern in a user table as matching nothing', () => {
    expect(rowFor(sonnet, [{ pattern: '(', family: 'Broken', speed: 1, scores: rowFor(sonnet).row.scores }]).known).toBe(false)
  })

  it('prices free at 1 and falls with cost', () => {
    expect(thriftOf('free')).toBe(1)
    expect(thriftOf({ input: 0.25, output: 2 })).toBeGreaterThan(thriftOf({ input: 15, output: 75 }))
    expect(thriftOf({ input: 1000, output: 1000 })).toBe(0)
    expect(thriftOf(undefined)).toBe(0.5)
  })

  it('leans on capability for a hard task and on cost and speed for a simple one', () => {
    // Quality-led priorities: a hard task clears even the balanced gate towards the strongest model.
    const hard = decide(situation({ current: mini, reading: hardCode, weights: { cost: 0.1, speed: 0.3, intelligence: 1 } }))
    expect(hard.switched).toBe(true)
    expect(hard.use.model).toBe('claude-opus-5')
    // Even priorities: the same task is a near tie, and a near tie never moves a chat.
    expect(decide(situation({ current: mini, reading: hardCode })).switched).toBe(false)
    const simple = decide(situation({ current: opus, reading: quick, gates: PRESETS.aggressive }))
    expect(simple.switched).toBe(true)
    expect(['openai/gpt-5.4-mini', 'auto']).toContain(simple.use.model)
  })
})

describe('gates', () => {
  it('stays when nothing scores above the current model', () => {
    const decision = decide(situation({ candidates: [sonnet] }))
    expect(decision).toMatchObject({ switched: false, stayed: 'no-recommendation', currentModelConfidence: 1 })
    expect(decision.use).toBe(sonnet)
  })

  it('holds a switch inside the throttle, and names the model it held', () => {
    const decision = decide(situation({ current: opus, reading: quick, gates: PRESETS.aggressive, sinceLastSwitch: 10 }))
    expect(decision).toMatchObject({ switched: false, stayed: 'throttle-failed', gates: { throttle: false } })
    expect(decision.recommended).toBeDefined()
  })

  it('never switches inside 30 seconds, whatever the preset asks', () => {
    const decision = decide(situation({ current: opus, reading: quick, gates: { ...PRESETS.aggressive, seconds: 0 }, sinceLastSwitch: 29 }))
    expect(decision.stayed).toBe('throttle-failed')
  })

  it('docks confidence after a recent switch so a marginal reading cannot flip the chat back', () => {
    const reading = { ...quick, confidence: 0.8 }
    const gates = { confidence: 0.75, improvement: 0.01, seconds: 30 }
    expect(decide(situation({ current: opus, reading, gates, sinceLastSwitch: 60 })).stayed).toBe('confidence-gate-failed')
    expect(decide(situation({ current: opus, reading, gates, sinceLastSwitch: 600 })).switched).toBe(true)
  })

  it('holds an unsure reading at the confidence gate', () => {
    const decision = decide(situation({ current: opus, reading: { ...quick, confidence: 0.5 }, gates: PRESETS.balanced }))
    expect(decision.stayed).toBe('confidence-gate-failed')
  })

  it('holds a small gain at the improvement gate', () => {
    const decision = decide(situation({ current: sonnet, candidates: [sonnet, opus], reading: hardCode, gates: PRESETS.conservative }))
    expect(decision.switched).toBe(false)
    expect(['improvement-gate-failed', 'no-recommendation']).toContain(decision.stayed)
  })
})

describe('switches the user has to make', () => {
  it('offers a paid model and stays when only free models may be switched to', () => {
    const decision = decide(situation({
      current: free, candidates: [free, opus],
      reading: hardCode, weights: { cost: 0, speed: 0, intelligence: 1 },
      gates: PRESETS.aggressive, preferFree: true,
    }))
    expect(decision).toMatchObject({ switched: false, stayed: 'needs-payment' })
    expect(decision.recommended?.model).toBe('claude-opus-5')
    expect(decision.use).toBe(free)
  })

  it('takes the free model that clears the gate when the best one costs money', () => {
    const decision = decide(situation({
      current: opus, candidates: [opus, mini, free],
      reading: quick, weights: { cost: 3, speed: 1, intelligence: 1 },
      gates: PRESETS.aggressive, preferFree: true,
    }))
    expect(decision.switched).toBe(true)
    expect(decision.use).toMatchObject({ provider: 'freetokens', model: 'auto' })
  })

  it('offers and stays when the better model cannot hold the chat', () => {
    const decision = decide(situation({
      current: opus, candidates: [opus, mini],
      reading: quick,
      gates: PRESETS.aggressive, contextTokens: 150_000,
    }))
    expect(decision).toMatchObject({ switched: false, stayed: 'loses-context' })
  })

  it('never moves a chat that holds images to a model that takes none', () => {
    const withImages = situation({ current: opus, candidates: [opus, free], reading: quick, gates: PRESETS.aggressive, hasImages: true })
    const decision = decide(withImages)
    expect(decision.stayed).toBe('no-recommendation')
  })

  it('never switches to a model the table does not know', () => {
    const decision = decide(situation({
      current: opus, candidates: [opus, mystery],
      reading: quick, weights: { cost: 5, speed: 0, intelligence: 0 },
      gates: PRESETS.aggressive,
    }))
    expect(decision.switched).toBe(false)
  })
})

describe('rationale', () => {
  it('names the task and the side benefit from the figures', () => {
    const decision = decide(situation({ current: opus, reading: quick, gates: PRESETS.aggressive }))
    expect(decision.rationale).toMatch(/a quick answer/)
    expect(decision.rationale).toMatch(/cheaper|free|faster/)
    expect(decision.rationale.endsWith('.')).toBe(true)
  })
})

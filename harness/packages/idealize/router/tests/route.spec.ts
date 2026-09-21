import { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'

import { candidatesFrom } from '../src/candidates.ts'
import type { Candidate } from '../src/decide.ts'
import { currentModel, foldRouted } from '../src/projection.ts'
import type { RouterEventData } from '../src/projection-types.ts'
import { routeTurn } from '../src/route.ts'
import type { TurnInput } from '../src/route.ts'

const mini: Candidate = { provider: 'openrouter', model: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', price: { input: 0.25, output: 2 }, images: true }
const opus: Candidate = { provider: 'openrouter', model: 'anthropic/claude-opus-5', label: 'Claude Opus 5', price: { input: 15, output: 75 }, images: true }
const free: Candidate = { provider: 'freetokens', model: 'auto', label: 'Free tokens', price: 'free', images: false }
const now = new Date('2026-09-21T12:00:00Z')
const hard = `Refactor this TypeScript module and debug the failing unit tests. ${'It has many parts. '.repeat(60)}`

const input = (over: Partial<TurnInput>): TurnInput => ({
  resolved: mini, message: hard, hasImages: false, candidates: [mini, opus, free],
  weights: { cost: 0.1, speed: 0.3, intelligence: 1 }, aggressiveness: 'balanced', preferFree: false, now, ...over,
})
const noWindow = { contextWindow: () => Promise.resolve(undefined) }
const jevSays = (confidence: number) => () => Promise.resolve({ reading: { task: 'code', difficulty: 'hard', confidence, source: 'jev' } as const, ms: 200 })

describe('routing a turn', () => {
  it('switches on a confident Jev reading and records the switch', async () => {
    const result = await routeTurn(input({}), { ...noWindow, askJev: jevSays(0.93) })
    expect(result.use).toEqual({ provider: 'openrouter', model: 'anthropic/claude-opus-5' })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ outcome: 'switched', task: 'code', from: { label: 'GPT-5.4 mini' }, to: { label: 'Claude Opus 5' } })
  })

  it('keeps the chat on its model when Jev does not answer, and names the failure', async () => {
    const result = await routeTurn(input({}), { ...noWindow, askJev: () => Promise.resolve({ failure: 'timeout', ms: 1500 }) })
    expect(result.jevFailure).toBe('timeout')
    expect(result.decision).toMatchObject({ switched: false, stayed: 'jev-unavailable' })
    expect(result.use.model).toBe('openai/gpt-5.4-mini')
    expect(result.events).toEqual([])
  })

  it('routes on the keyword rules only when Jev is switched off in config', async () => {
    const result = await routeTurn(input({}), noWindow)
    expect(result.reading.source).toBe('rules')
    expect(result.use.model).toBe('anthropic/claude-opus-5')
  })

  it('offers a paid model and stays when only free switches are allowed', async () => {
    const paidOnly = input({ resolved: free, preferFree: true, candidates: [free, opus] })
    const result = await routeTurn(paidOnly, { ...noWindow, askJev: jevSays(0.93) })
    expect(result.use).toEqual({ provider: 'freetokens', model: 'auto' })
    expect(result.events[0]).toMatchObject({ outcome: 'offer', reason: 'needs-payment', to: { label: 'Claude Opus 5' } })
  })

  it('offers and stays when the better model would cut the chat', async () => {
    const smallWindow = { askJev: jevSays(0.93), contextWindow: () => Promise.resolve(128_000) }
    const result = await routeTurn(input({ contextTokens: 190_000 }), smallWindow)
    expect(result.use.model).toBe('openai/gpt-5.4-mini')
    expect(result.events[0]).toMatchObject({ outcome: 'offer', reason: 'loses-context' })
  })

  it('holds an earlier switch, and throttles the next one', async () => {
    const routed: RouterEventData = { outcome: 'switched', at: '2026-09-21T11:59:30Z', from: mini, to: free }
    const result = await routeTurn(input({ routed, lastSwitchAt: routed.at }), { ...noWindow, askJev: jevSays(0.93) })
    expect(result.from.label).toBe('Free tokens')
    expect(result.decision.stayed).toBe('throttle-failed')
    expect(result.use).toEqual({ provider: 'freetokens', model: 'auto' })
    expect(result.events).toEqual([])
  })

  it('drops an earlier switch once the user picks another model', async () => {
    const routed: RouterEventData = { outcome: 'switched', at: '2026-09-21T10:00:00Z', from: mini, to: free }
    const result = await routeTurn(input({ resolved: opus, routed, lastSwitchAt: routed.at, message: 'hi' }), noWindow)
    expect(result.events[0]).toMatchObject({ outcome: 'reset', to: { label: 'Claude Opus 5' } })
    expect(result.use.model).toBe('anthropic/claude-opus-5')
  })
})

describe('the chat log', () => {
  const event = (data: RouterEventData) => ({ type: 'idealize/router', data }) as never
  it('keeps the latest switch until a reset follows it', () => {
    const switched: RouterEventData = { outcome: 'switched', at: 'a', from: mini, to: opus }
    expect(foldRouted([event(switched)]).routed).toEqual(switched)
    expect(foldRouted([event(switched), event({ ...switched, outcome: 'offer', at: 'b' })])).toMatchObject({ routed: switched, lastSwitchAt: 'a' })
    expect(foldRouted([event(switched), event({ ...switched, outcome: 'reset', at: 'c' })])).toEqual({ lastSwitchAt: 'c' })
  })

  it('resolves the current model through a held switch', () => {
    const switched: RouterEventData = { outcome: 'switched', at: 'a', from: mini, to: opus }
    expect(currentModel(mini, switched)).toEqual({ current: opus, dropped: false })
    expect(currentModel(opus, switched).dropped).toBe(false)
    expect(currentModel(free, switched)).toEqual({ current: free, dropped: true })
  })
})

describe('candidates', () => {
  it('prices a subscription and the free engine as free, a keyed route by its list, and leaves an unlisted model unknown', () => {
    const list = candidatesFrom([
      { provider: 'freetokens', auth: 'free', models: [{ id: 'a' }, { id: 'b' }] },
      { provider: 'openai-codex', auth: 'oauth', models: [{ id: 'gpt-5.5', name: 'GPT-5.5', inputModalities: ['text', 'image'] }] },
      { provider: 'openrouter', auth: 'apiKey', models: [{ id: 'x/listed', inputModalities: ['text'] }, { id: 'x/unlisted' }, { id: 'x/gratis:free' }] },
    ], { openrouter: { 'x/listed': { input: 1, output: 2 }, 'x/gratis:free': { input: 0, output: 0 } } })
    expect(list.map(item => [item.label, item.price, item.images])).toEqual([
      ['Free tokens', 'free', false],
      ['GPT-5.5', 'free', true],
      ['x/listed', { input: 1, output: 2 }, false],
      ['x/unlisted', undefined, undefined],
      ['x/gratis:free', 'free', undefined],
    ])
  })
})

describe('the request waterfall', () => {
  it('a prepended root listener wraps the host model selection, so its model is the one the call runs on', async () => {
    const ctx = new Context()
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider: 'router', model: 'routed' }), { prepend: true })
    const selection = { current: { provider: 'host', model: 'picked' }, assembled: { provider: 'host', model: 'picked' } }
    installModelSelection(ctx, selection)
    const payload = { turn: 1, step: 0, signal: new AbortController().signal } as never
    const config = await ctx.waterfall('agent/request', payload, () => Promise.resolve({ provider: 'seed', model: 'seed' }))
    expect(config).toMatchObject({ provider: 'router', model: 'routed' })
  })
})

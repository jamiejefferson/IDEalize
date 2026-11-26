import { describe, expect, it } from 'vitest'

import { choiceSettings, choicesFor, modeOf, ROUTER_MODES } from '../src/choices.ts'
import type { ChoicesInput } from '../src/choices.ts'
import type { Candidate } from '../src/decide.ts'

const haiku: Candidate = { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', price: { input: 1, output: 5 } }
const sonnet: Candidate = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', price: { input: 3, output: 15 } }
const opus: Candidate = { provider: 'openrouter', model: 'anthropic/claude-opus-5', label: 'Claude Opus 5', price: { input: 15, output: 75 } }
const plan: Candidate = { provider: 'anthropic', model: 'claude-opus-5', label: 'Claude Opus 5', price: 'free' }
const unpriced: Candidate = { provider: 'openrouter', model: 'anthropic/claude-next', label: 'Claude Next', price: undefined }
const alsoUnpriced: Candidate = { provider: 'openrouter', model: 'anthropic/claude-after', label: 'Claude After', price: undefined }
const gpt: Candidate = { provider: 'openrouter', model: 'openai/gpt-5.5', label: 'GPT-5.5', price: { input: 2, output: 10 } }

const named = (candidate: Candidate) => ({ provider: candidate.provider, model: candidate.model, label: candidate.label })
const input = (over: Partial<ChoicesInput> = {}): ChoicesInput => ({
  mode: 'auto', lean: 35, excluded: [], sameCompany: true, own: named(sonnet), answering: named(sonnet),
  candidates: [opus, unpriced, gpt, sonnet, plan, haiku, alsoUnpriced], ...over,
})

describe('the router’s mode', () => {
  it('knows three modes and reads anything else as unset', () => {
    expect(ROUTER_MODES).toEqual(['auto', 'ask', 'fixed'])
    expect(modeOf('ask')).toBe('ask')
    expect(modeOf('sometimes')).toBeUndefined()
    expect(modeOf(undefined)).toBeUndefined()
  })
})

describe('what the chip may write', () => {
  it('takes a mode, a slider position held to 0 to 100, and the unticked models once each', () => {
    expect(choiceSettings({ mode: 'fixed', lean: 120.4, excluded: ['a/b', 'a/b', 'c/d'] }))
      .toEqual({ mode: 'fixed', lean: 100, excluded: ['a/b', 'c/d'] })
    expect(choiceSettings({ lean: 12.5 })).toEqual({ lean: 13 })
    expect(choiceSettings({ excluded: [] })).toEqual({ excluded: [] })
  })

  it('leaves out a field of the wrong shape', () => {
    expect(choiceSettings({ mode: 'always', lean: '40', excluded: ['a/b', 7] })).toEqual({})
    expect(choiceSettings({ excluded: 'a/b' })).toEqual({})
  })
})

describe('the chip’s list', () => {
  it('lists the company’s models cheapest first, with free ahead and an unknown price last', () => {
    const choices = choicesFor(input())
    expect(choices.company).toBe('anthropic')
    expect(choices.models.map(model => `${model.provider}/${model.model}`)).toEqual([
      'anthropic/claude-opus-5',
      'openrouter/anthropic/claude-haiku-4.5',
      'openrouter/anthropic/claude-sonnet-5',
      'openrouter/anthropic/claude-opus-5',
      'openrouter/anthropic/claude-after',
      'openrouter/anthropic/claude-next',
    ])
    expect(choices.models.map(model => model.price)).toEqual(['free', haiku.price, sonnet.price, opus.price, null, null])
  })

  it('marks the model answering, and lists an unticked model as not allowed', () => {
    const choices = choicesFor(input({ excluded: ['openrouter/anthropic/claude-opus-5'], answering: named(haiku) }))
    expect(choices.answering).toEqual(named(haiku))
    expect(choices.models.filter(model => model.answering).map(model => model.label)).toEqual(['Claude Haiku 4.5'])
    expect(choices.models.filter(model => !model.allowed).map(model => model.model)).toEqual(['anthropic/claude-opus-5'])
    expect(choices.excluded).toEqual(['openrouter/anthropic/claude-opus-5'])
  })

  it('reports the mode and the slider, with their defaults when nothing is stored', () => {
    expect(choicesFor(input({ mode: 'ask', lean: 80 }))).toMatchObject({ mode: 'ask', lean: 80 })
    expect(choicesFor(input({ mode: undefined, lean: undefined }))).toMatchObject({ mode: 'auto', lean: 35 })
  })

  it('lists the answering model even when it sits at another company or on no connected route', () => {
    const moved = choicesFor(input({ answering: named(gpt) }))
    expect(moved.models.find(model => model.answering)).toMatchObject({ model: 'openai/gpt-5.5', price: gpt.price })
    const local = { provider: 'ollama', model: 'llama-4', label: 'Llama 4' }
    const offList = choicesFor(input({ own: local, answering: local }))
    expect(offList.company).toBe('ollama')
    expect(offList.models).toEqual([{ ...local, price: null, allowed: true, answering: true }])
  })

  it('lists every connected model once the company limit is off', () => {
    expect(choicesFor(input({ sameCompany: false })).models).toHaveLength(7)
  })
})

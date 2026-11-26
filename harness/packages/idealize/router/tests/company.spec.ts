import { describe, expect, it } from 'vitest'

import { companyOf, isExcluded, withinLimits } from '../src/company.ts'

const sonnet = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' }
const opus = { provider: 'openrouter', model: 'anthropic/claude-opus-5' }
const direct = { provider: 'anthropic', model: 'claude-opus-5' }
const viaGateway = { provider: 'gateway-anthropic', model: 'claude-opus-5' }
const viaGatewayRouter = { provider: 'gateway-openrouter', model: 'anthropic/claude-opus-5' }
const gpt = { provider: 'openrouter', model: 'openai/gpt-5.5' }
const codex = { provider: 'openai-codex', model: 'gpt-5.5' }
const free = { provider: 'freetokens', model: 'auto' }
const all = [sonnet, opus, direct, viaGateway, viaGatewayRouter, gpt, codex, free]

describe('the company behind a model', () => {
  it('reads OpenRouter’s maker from the model id, with or without the latest marker', () => {
    expect(companyOf('openrouter', 'anthropic/claude-opus-5')).toBe('anthropic')
    expect(companyOf('openrouter', '~anthropic/claude-haiku-latest')).toBe('anthropic')
    expect(companyOf('openrouter', '')).toBe('openrouter')
  })

  it('reads a key gateway’s route as the company of the route it fronts', () => {
    expect(companyOf('gateway-anthropic', 'claude-opus-5')).toBe('anthropic')
    expect(companyOf('gateway-openrouter', 'openai/gpt-5.5')).toBe('openai')
  })

  it('counts a company’s second route as that company, and any other route as itself', () => {
    expect(companyOf('openai-codex', 'gpt-5.5')).toBe('openai')
    expect(companyOf('xai', 'grok-5')).toBe('x-ai')
    expect(companyOf('anthropic', 'claude-opus-5')).toBe('anthropic')
    expect(companyOf('freetokens', 'auto')).toBe('freetokens')
  })
})

describe('the models a person unticked', () => {
  it('leaves out a model by its route key, and its copy behind a key gateway with it', () => {
    const excluded = ['openrouter/anthropic/claude-opus-5']
    expect(isExcluded(opus, excluded)).toBe(true)
    expect(isExcluded(viaGatewayRouter, excluded)).toBe(true)
    expect(isExcluded(sonnet, excluded)).toBe(false)
    expect(isExcluded(direct, excluded)).toBe(false)
  })
})

describe('where a routed turn may go', () => {
  const open = { sameCompany: true, excluded: [] }

  it('keeps to the company of the chat’s own model, across its routes and a key gateway', () => {
    expect(withinLimits(all, sonnet, open)).toEqual([sonnet, opus, direct, viaGateway, viaGatewayRouter])
    expect(withinLimits(all, codex, open)).toEqual([gpt, codex])
  })

  it('leaves the free-tokens route out, unless the chat’s own model is that route', () => {
    expect(withinLimits(all, sonnet, open)).not.toContain(free)
    expect(withinLimits(all, free, open)).toEqual([free])
  })

  it('considers every company once the limit is off', () => {
    expect(withinLimits(all, sonnet, { sameCompany: false, excluded: [] })).toEqual(all)
  })

  it('drops an unticked model, yet keeps the chat’s own model and the one it is on now', () => {
    const limits = { sameCompany: true, excluded: ['openrouter/anthropic/claude-opus-5', 'openrouter/anthropic/claude-sonnet-5', 'openrouter/openai/gpt-5.5'] }
    expect(withinLimits(all, sonnet, limits)).toEqual([sonnet, direct, viaGateway])
    expect(withinLimits(all, sonnet, limits, [gpt])).toEqual([sonnet, direct, viaGateway, gpt])
  })
})

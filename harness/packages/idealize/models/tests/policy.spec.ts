import { describe, expect, it } from 'vitest'
import { choose, dominantWeight, subscriptionModel } from '../src/policy.ts'
import type { PolicyFacts } from '../src/policy.ts'

const CODEX = ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-codex']

function facts(overrides: Partial<PolicyFacts> = {}): PolicyFacts {
  return {
    freetokens: { routeModels: 191, engineUp: true, usableKeys: 2 },
    signedIn: ['openai-codex'],
    models: { 'openai-codex': CODEX },
    ...overrides,
  }
}

describe('dominantWeight', () => {
  it('resolves ties towards cost', () => {
    expect(dominantWeight({ cost: 34, speed: 34, intelligence: 34 })).toBe('cost')
  })

  it('resolves a speed/intelligence tie towards intelligence', () => {
    expect(dominantWeight({ cost: 0, speed: 50, intelligence: 50 })).toBe('intelligence')
  })

  it('names the heaviest weight', () => {
    expect(dominantWeight({ cost: 10, speed: 80, intelligence: 10 })).toBe('speed')
  })
})

// The route as pi-ai 0.85.1 ships it: the newest model sorts below the others
// by id, so nothing but the flagship list puts it first.
const CODEX_0_85 = [
  'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5',
  'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra',
]

describe('subscriptionModel', () => {
  it('prefers the flagship by default', () => {
    expect(subscriptionModel(CODEX, 'intelligence')).toBe('gpt-5.5')
  })

  it('prefers gpt-6-astra over the older flagship where the route carries it', () => {
    expect(subscriptionModel(CODEX_0_85, 'intelligence')).toBe('gpt-6-astra')
  })

  it('takes a mini when speed leads and the flagship has no mini of its own', () => {
    expect(subscriptionModel(CODEX_0_85, 'speed')).toBe('gpt-5.4-mini')
  })

  it('prefers the mini variant when speed leads', () => {
    expect(subscriptionModel(CODEX, 'speed')).toBe('gpt-5.5-mini')
  })

  it('falls back to the first non-mini id without a gpt-5.5', () => {
    expect(subscriptionModel(['other-mini', 'other-big'], 'intelligence')).toBe('other-big')
  })

  it('answers undefined for an empty list', () => {
    expect(subscriptionModel([], 'cost')).toBeUndefined()
  })
})

describe('choose', () => {
  it('routes to free tokens when cost leads and the engine has keys', () => {
    const decision = choose({ cost: 60, speed: 10, intelligence: 30 }, facts())
    expect(decision.choice).toEqual({ provider: 'freetokens', model: 'auto' })
    expect(decision.reason).toContain('cost leads')
    expect(decision.reason).toContain('2 usable keys')
  })

  it('routes to the subscription when intelligence leads', () => {
    const decision = choose({ cost: 20, speed: 10, intelligence: 70 }, facts())
    expect(decision.choice).toEqual({ provider: 'openai-codex', model: 'gpt-5.5' })
    expect(decision.reason).toContain('intelligence leads')
  })

  it('routes speed to free tokens first, mini subscription as fallback', () => {
    const speedy = { cost: 10, speed: 80, intelligence: 10 }
    expect(choose(speedy, facts()).choice).toEqual({ provider: 'freetokens', model: 'auto' })
    const noKeys = facts({ freetokens: { routeModels: 191, engineUp: true, usableKeys: 0 } })
    expect(choose(speedy, noKeys).choice).toEqual({ provider: 'openai-codex', model: 'gpt-5.5-mini' })
  })

  it('falls back to the subscription when the engine has no usable key, and says why', () => {
    const decision = choose(
      { cost: 60, speed: 10, intelligence: 30 },
      facts({ freetokens: { routeModels: 191, engineUp: true, usableKeys: 0 } }),
    )
    expect(decision.choice).toEqual({ provider: 'openai-codex', model: 'gpt-5.5' })
    expect(decision.reason).toContain('no usable provider key')
  })

  it('treats an adopted engine (unknown keys) as usable while it answers', () => {
    const decision = choose(
      { cost: 60, speed: 10, intelligence: 30 },
      facts({ freetokens: { routeModels: 191, engineUp: true, usableKeys: undefined } }),
    )
    expect(decision.choice).toEqual({ provider: 'freetokens', model: 'auto' })
    expect(decision.reason).not.toContain('usable key')
  })

  it('falls back to free tokens when intelligence leads but nothing is signed in', () => {
    const decision = choose({ cost: 10, speed: 10, intelligence: 80 }, facts({ signedIn: [] }))
    expect(decision.choice).toEqual({ provider: 'freetokens', model: 'auto' })
    expect(decision.reason).toContain('no subscription is signed in')
  })

  it('declines to choose when the engine is down and nothing is signed in', () => {
    const decision = choose(
      { cost: 60, speed: 10, intelligence: 30 },
      facts({ freetokens: { routeModels: 191, engineUp: false, usableKeys: undefined }, signedIn: [] }),
    )
    expect(decision.choice).toBeUndefined()
    expect(decision.reason).toContain('not running')
  })

  it('declines to choose when no route is registered and nothing is signed in', () => {
    const decision = choose(
      { cost: 34, speed: 33, intelligence: 33 },
      facts({ freetokens: { routeModels: 0, engineUp: false, usableKeys: undefined }, signedIn: [], models: {} }),
    )
    expect(decision.choice).toBeUndefined()
    expect(decision.reason).toContain('no free-tokens route is registered')
  })

  it('says one usable key in the singular', () => {
    const decision = choose(
      { cost: 60, speed: 20, intelligence: 20 },
      facts({ freetokens: { routeModels: 191, engineUp: true, usableKeys: 1 } }),
    )
    expect(decision.reason).toContain('(1 usable key)')
  })

  it('declines to choose when intelligence leads, nothing is signed in, and the engine is down', () => {
    const decision = choose(
      { cost: 10, speed: 10, intelligence: 80 },
      facts({ freetokens: { routeModels: 191, engineUp: false, usableKeys: 0 }, signedIn: [] }),
    )
    expect(decision.choice).toBeUndefined()
    expect(decision.reason).toContain('no subscription is signed in')
  })

  it('treats a signed-in provider whose models it cannot see as no subscription', () => {
    const decision = choose({ cost: 10, speed: 10, intelligence: 80 }, facts({ models: {} }))
    expect(decision.choice).toEqual({ provider: 'freetokens', model: 'auto' })
  })
})

describe('subscriptionModel', () => {
  it('takes the first id when every model on the route is a mini', () => {
    expect(subscriptionModel(['o1-mini', 'o2-mini'], 'intelligence')).toBe('o1-mini')
  })

  it('keeps the flagship when speed leads but the route offers no mini', () => {
    expect(subscriptionModel(['gpt-5.5'], 'speed')).toBe('gpt-5.5')
  })
})

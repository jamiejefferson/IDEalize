import { describe, expect, it } from 'vitest'
import { costBreakdown, meteredCost, modelRows, subscriptionCost } from '../src/pricing.ts'
import type { SubscriptionPlanTable, TokenPriceTable } from '../src/pricing.ts'
import type { PricedTable } from '../src/prices.ts'
import { categoryOf } from '../src/usage.ts'
import type { PeriodModels } from '../src/usage.ts'

const FACTS = { freeProvider: 'freetokens', subscriptionProviders: ['openai-codex'] }
const classify = (provider: string) => categoryOf(provider, FACTS)

// 2026-08-21T12:00Z: August is month index 7, so eight months have run this year.
const NOW = Date.UTC(2026, 7, 21, 12)

const PRICES: TokenPriceTable = {
  anthropic: { claude: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
}

describe('meteredCost', () => {
  it('prices metered routes per token kind and tallies unpriced tokens', () => {
    const models: PeriodModels = {
      anthropic: {
        claude: { inputTokens: 1_000_000, outputTokens: 200_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
        haiku: { inputTokens: 40, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    }
    const { cost, unpricedTokens } = meteredCost(models, classify, PRICES)
    expect(cost).toBeCloseTo(3 + 3 + 0.15, 10)
    expect(unpricedTokens).toBe(42)
  })

  it('never prices subscription or free usage — the plan and the engine cover those', () => {
    const models: PeriodModels = {
      'openai-codex': { 'gpt-5.5': { inputTokens: 9, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      freetokens: { auto: { inputTokens: 9, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    }
    expect(meteredCost(models, classify, PRICES)).toEqual({ cost: 0, unpricedTokens: 0 })
  })
})

describe('subscriptionCost', () => {
  it('counts every configured plan monthly and from January year-to-date', () => {
    const plans: SubscriptionPlanTable = { 'openai-codex': { monthly: 20 } }
    expect(subscriptionCost(['openai-codex'], plans, NOW)).toEqual({ month: 20, year: 160, unpriced: [] })
  })

  it('starts the year-to-date count at `since` and skips plans not yet begun', () => {
    const plans: SubscriptionPlanTable = {
      'openai-codex': { monthly: 20, since: '2026-06' },
      'kimi-coding': { monthly: 10, since: '2026-12' },
      anthropic: { monthly: 90, since: '2025-03' },
    }
    const { month, year, unpriced } = subscriptionCost([], plans, NOW)
    expect(month).toBe(110)
    expect(year).toBe(20 * 3 + 90 * 8)
    expect(unpriced).toEqual([])
  })

  it('names signed-in providers whose plan has no configured cost', () => {
    expect(subscriptionCost(['openai-codex'], {}, NOW).unpriced).toEqual(['openai-codex'])
  })
})

describe('costBreakdown', () => {
  const models: { month: PeriodModels; year: PeriodModels } = {
    month: { anthropic: { claude: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    year: {
      anthropic: {
        claude: { inputTokens: 2_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        haiku: { inputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    },
  }

  it('assembles per-category costs, unpriced remainders, and the currency', () => {
    const cost = costBreakdown(models, classify, {
      currency: 'GBP',
      tokenPrices: PRICES,
      subscriptionPlans: { 'openai-codex': { monthly: 20 } },
      signedIn: ['openai-codex', 'kimi-coding'],
      now: NOW,
    })
    expect(cost).toEqual({
      currency: 'GBP',
      month: { subscriptions: 20, metered: 3, free: 0, total: 23 },
      year: { subscriptions: 160, metered: 6, free: 0, total: 166 },
      unpricedTokens: { month: 0, year: 7 },
      unpricedSubscriptions: ['kimi-coding'],
      configured: true,
    })
  })

  it('reports unconfigured when no price or plan cost is set, including empty per-provider tables', () => {
    const cost = costBreakdown(models, classify, {
      currency: 'USD',
      tokenPrices: { anthropic: {} },
      subscriptionPlans: {},
      signedIn: [],
      now: NOW,
    })
    expect(cost.configured).toBe(false)
    expect(cost.month.total).toBe(0)
    expect(cost.unpricedTokens.year).toBe(7 + 2_000_000)
  })
})

describe('modelRows', () => {
  it('lists every route with usage by token total, pricing only the metered rows that have a price', () => {
    const prices: PricedTable = {
      anthropic: { claude: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, source: 'user' } },
      openrouter: { 'a/b': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1, source: 'market' } },
    }
    const models: PeriodModels = {
      anthropic: {
        claude: { inputTokens: 1_000_000, outputTokens: 200_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
        haiku: { inputTokens: 40, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      openrouter: { 'a/b': { inputTokens: 500_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      'openai-codex': { 'gpt-5.5': { inputTokens: 9_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      freetokens: { auto: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    }
    const rows = modelRows(models, classify, prices)
    expect(rows.map(row => `${row.provider} ${row.model}`)).toEqual([
      'openai-codex gpt-5.5', 'anthropic claude', 'openrouter a/b', 'anthropic haiku', 'freetokens auto',
    ])
    const claude = rows.find(row => row.model === 'claude')
    expect(claude?.cost).toBeCloseTo(3 + 3 + 0.15, 10)
    expect(claude?.price?.source).toBe('user')
    expect(rows.find(row => row.model === 'a/b')).toMatchObject({ category: 'metered', cost: 0.5, price: { source: 'market' } })
    // Unpriced metered, subscription and free rows carry no cost field at all — never a zero.
    expect(rows.find(row => row.model === 'haiku')).toEqual({
      provider: 'anthropic', model: 'haiku', category: 'metered', total: 42,
      tokens: { inputTokens: 40, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    expect('cost' in (rows.find(row => row.model === 'gpt-5.5') ?? {})).toBe(false)
    expect(rows.find(row => row.model === 'auto')?.category).toBe('free')
  })
})

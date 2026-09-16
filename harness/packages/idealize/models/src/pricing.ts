/**
 * Cost for the Brains pane's Budget tab, computed only from user-configured
 * prices: per-model token prices for metered (API-key) routes and per-provider
 * subscription plan costs. Nothing here estimates a price — a metered route
 * without a configured price contributes no cost and its tokens are reported
 * as unpriced; a signed-in subscription without a configured plan cost is
 * named in `unpricedSubscriptions`. Free-route work costs nothing out of
 * pocket, so its cost is always zero.
 */

import type { PricedModel, PricedTable } from './prices.ts'
import type { ModelTokens, PeriodModels, UsageCategory } from './usage.ts'
import { totalTokens } from './usage.ts'

/** Prices for one model route, in currency units per million tokens. */
export interface TokenPrice {
  /** Price per million uncached input tokens. */
  input: number
  /** Price per million output tokens. */
  output: number
  /** Price per million cache-read input tokens. */
  cacheRead: number
  /** Price per million cache-write input tokens. */
  cacheWrite: number
}

/** Token prices per provider, then per model id. */
export type TokenPriceTable = Record<string, Record<string, TokenPrice>>

/** One subscription's plan cost. */
export interface SubscriptionPlan {
  /** Currency units per calendar month. */
  monthly: number
  /** First month the plan is paid for, `YYYY-MM`; unset counts every month of the current year. */
  since?: string
}

/** Plan costs per subscription provider. */
export type SubscriptionPlanTable = Record<string, SubscriptionPlan>

/** Cost per billing category plus their sum, in the configured currency. */
export type CostTotals = Record<UsageCategory | 'total', number>

/** What the Budget tab shows about money: computed costs and what could not be priced. */
export interface CostBreakdown {
  /** ISO 4217 code the amounts are in. */
  currency: string
  month: CostTotals
  year: CostTotals
  /** Metered tokens from routes without a configured price, per period. */
  unpricedTokens: { month: number; year: number }
  /** Signed-in subscription providers without a configured plan cost. */
  unpricedSubscriptions: string[]
  /** False while no price or plan cost is configured; the panel then shows a hint instead of zeros. */
  configured: boolean
}

/**
 * One model with usage this month, as the Budget tab's per-model table lists
 * it: its tokens, and for a metered route the cost its price computes or the
 * absence of a price. Subscription and free rows carry no per-token cost.
 */
export interface ModelCostRow {
  provider: string
  model: string
  category: UsageCategory
  tokens: ModelTokens
  /** The row's token total. */
  total: number
  /** The cost this month, only for a metered route with a price. */
  cost?: number
  /** The price behind `cost`, with its source. */
  price?: PricedModel
}

/** The price field each token kind bills against. */
const PRICE_OF: Record<keyof ModelTokens, keyof TokenPrice> = {
  inputTokens: 'input',
  outputTokens: 'output',
  cacheReadTokens: 'cacheRead',
  cacheWriteTokens: 'cacheWrite',
}

/** One route's cost from its price. */
function priceTokens(tokens: ModelTokens, price: TokenPrice): number {
  let cost = 0
  for (const kind of Object.keys(PRICE_OF) as (keyof ModelTokens)[]) cost += tokens[kind] * price[PRICE_OF[kind]] / 1e6
  return cost
}

/**
 * Price one period's metered usage.
 * @param models - the period's per-route token detail.
 * @param classify - the provider → category mapping; only metered routes are priced.
 * @param prices - the configured token prices.
 * @returns the cost of the priced routes and the token count of the unpriced ones.
 */
export function meteredCost(
  models: PeriodModels,
  classify: (provider: string) => UsageCategory,
  prices: TokenPriceTable,
): { cost: number; unpricedTokens: number } {
  let cost = 0
  let unpricedTokens = 0
  for (const [provider, byModel] of Object.entries(models)) {
    if (classify(provider) !== 'metered') continue
    for (const [model, tokens] of Object.entries(byModel)) {
      const price = prices[provider]?.[model]
      if (price === undefined) {
        unpricedTokens += totalTokens(tokens)
        continue
      }
      cost += priceTokens(tokens, price)
    }
  }
  return { cost, unpricedTokens }
}

/**
 * The per-model table for one period: every route with usage, metered ones
 * priced where a price exists, ordered by token total descending.
 * @param models - the period's per-route token detail.
 * @param classify - the provider → category mapping.
 * @param prices - the effective, source-marked price table.
 * @returns the rows.
 */
export function modelRows(
  models: PeriodModels,
  classify: (provider: string) => UsageCategory,
  prices: PricedTable,
): ModelCostRow[] {
  const rows: ModelCostRow[] = []
  for (const [provider, byModel] of Object.entries(models)) {
    const category = classify(provider)
    for (const [model, tokens] of Object.entries(byModel)) {
      const price = category === 'metered' ? prices[provider]?.[model] : undefined
      rows.push({
        provider,
        model,
        category,
        tokens,
        total: totalTokens(tokens),
        ...price === undefined ? {} : { cost: priceTokens(tokens, price), price },
      })
    }
  }
  return rows.sort((left, right) => right.total - left.total)
}

/** How many months of the current year the plan is paid for, through the current month. */
function monthsActive(plan: SubscriptionPlan, yearNow: number, monthNow: number): number {
  if (plan.since === undefined) return monthNow + 1
  const sinceYear = Number(plan.since.slice(0, 4))
  const sinceMonth = Number(plan.since.slice(5, 7)) - 1
  if (sinceYear > yearNow || (sinceYear === yearNow && sinceMonth > monthNow)) return 0
  return sinceYear < yearNow ? monthNow + 1 : monthNow - sinceMonth + 1
}

/**
 * Price the subscription plans: every configured plan is counted whether or
 * not it saw usage, because the plan bills regardless.
 * @param signedIn - the subscription providers currently signed in; ones without a plan are reported unpriced.
 * @param plans - the configured plan costs.
 * @param now - the instant that fixes the current month and year (ms, UTC calendar).
 * @returns this month's plan cost, the year-to-date plan cost, and the signed-in providers no plan prices.
 */
export function subscriptionCost(
  signedIn: readonly string[],
  plans: SubscriptionPlanTable,
  now: number,
): { month: number; year: number; unpriced: string[] } {
  const at = new Date(now)
  const yearNow = at.getUTCFullYear()
  const monthNow = at.getUTCMonth()
  let month = 0
  let year = 0
  for (const plan of Object.values(plans)) {
    const months = monthsActive(plan, yearNow, monthNow)
    if (months === 0) continue
    month += plan.monthly
    year += plan.monthly * months
  }
  return { month, year, unpriced: signedIn.filter(provider => plans[provider] === undefined) }
}

/**
 * Assemble the Budget tab's cost payload from configured prices and folded usage.
 * @param models - the per-route token detail of both periods (usage.ts fold).
 * @param classify - the provider → category mapping.
 * @param options - the configured currency, prices and plans, the signed-in subscriptions, and the pricing instant.
 * @returns the per-category costs, the unpriced remainders, and whether anything is configured at all.
 */
export function costBreakdown(
  models: { month: PeriodModels; year: PeriodModels },
  classify: (provider: string) => UsageCategory,
  options: {
    currency: string
    tokenPrices: TokenPriceTable
    subscriptionPlans: SubscriptionPlanTable
    signedIn: readonly string[]
    now: number
  },
): CostBreakdown {
  const plans = subscriptionCost(options.signedIn, options.subscriptionPlans, options.now)
  const month = meteredCost(models.month, classify, options.tokenPrices)
  const year = meteredCost(models.year, classify, options.tokenPrices)
  const configured = Object.keys(options.subscriptionPlans).length > 0
    || Object.values(options.tokenPrices).some(byModel => Object.keys(byModel).length > 0)
  return {
    currency: options.currency,
    month: { subscriptions: plans.month, metered: month.cost, free: 0, total: plans.month + month.cost },
    year: { subscriptions: plans.year, metered: year.cost, free: 0, total: plans.year + year.cost },
    unpricedTokens: { month: month.unpricedTokens, year: year.unpricedTokens },
    unpricedSubscriptions: plans.unpriced,
    configured,
  }
}

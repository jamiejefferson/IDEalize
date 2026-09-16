/**
 * Token usage for the Brains pane's Budget tab: a pure fold of session logs
 * into per-category token totals for the current month and the year to
 * date. Every `assistant/message` event carries the provider that answered
 * (`message.source`) and, when the provider reported it, the call's token
 * usage; the fold sums input, output and cached tokens per category, and
 * keeps the per-route detail (provider, model, token kind) that pricing.ts
 * needs to turn configured token prices into cost.
 *
 * Categories follow how the route is paid for: a subscription sign-in
 * (OAuth), a metered API key, or the free-tokens engine.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** How a provider route is paid for. */
export type UsageCategory = 'subscriptions' | 'metered' | 'free'

/** The categories in display order. */
export const USAGE_CATEGORIES: readonly UsageCategory[] = ['subscriptions', 'metered', 'free']

/** Token totals per category plus their sum. */
export type UsageTotals = Record<UsageCategory | 'total', number>

/** Per-kind token counts for one provider+model route. */
export interface ModelTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** The usage kinds the fold bills: uncached input, output, and cached input (read + write). */
export const MODEL_TOKEN_KEYS: readonly (keyof ModelTokens)[] = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/** Token detail per provider, then per model id (`''` when the event named no model). */
export type PeriodModels = Record<string, Record<string, ModelTokens>>

/** One fold result: month-to-date and year-to-date totals plus the per-route detail behind them. */
export interface UsagePeriods {
  month: UsageTotals
  year: UsageTotals
  /** The tokens behind the totals, by provider and model, for cost calculation. */
  models: { month: PeriodModels; year: PeriodModels }
}

/** The facts that place a provider in a category. */
export interface CategoryFacts {
  /** The free-tokens provider route id. */
  freeProvider: string
  /** Provider ids offered through subscription sign-in (the OAuth surface). */
  subscriptionProviders: readonly string[]
}

/**
 * Place a provider route in its billing category.
 * @param provider - the provider route id.
 * @param facts - the free route id and the subscription provider ids.
 * @returns the category the provider's tokens count towards.
 */
export function categoryOf(provider: string, facts: CategoryFacts): UsageCategory {
  if (provider === facts.freeProvider) return 'free'
  if (facts.subscriptionProviders.includes(provider)) return 'subscriptions'
  return 'metered'
}

function emptyTotals(): UsageTotals {
  return { subscriptions: 0, metered: 0, free: 0, total: 0 }
}

/**
 * A fresh, all-zero fold target.
 * @returns empty month and year totals with no per-route detail.
 */
export function emptyUsagePeriods(): UsagePeriods {
  return { month: emptyTotals(), year: emptyTotals(), models: { month: {}, year: {} } }
}

/** The billable kinds one call reported, or undefined when it billed nothing. */
function tokensOf(usage: unknown): ModelTokens | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const out: ModelTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let sum = 0
  for (const key of MODEL_TOKEN_KEYS) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[key] = value
      sum += value
    }
  }
  return sum === 0 ? undefined : out
}

/**
 * Sum one route's token kinds.
 * @param tokens - the per-kind counts.
 * @returns their total.
 */
export function totalTokens(tokens: ModelTokens): number {
  return tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
}

/** Add one call's tokens to the period's per-route detail. */
function addDetail(models: PeriodModels, provider: string, model: string, tokens: ModelTokens): void {
  const byModel = models[provider] ??= {}
  const entry = byModel[model] ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (const key of MODEL_TOKEN_KEYS) entry[key] += tokens[key]
}

/**
 * Fold one session log's assistant messages into the period totals.
 * @param events - the session's events.
 * @param classify - the provider → category mapping.
 * @param now - the instant that fixes the current month and year (ms).
 * @param into - the totals to add to; a fresh pair when omitted.
 * @returns the accumulated totals.
 */
export function foldUsage(
  events: readonly SessionEvent[],
  classify: (provider: string) => UsageCategory,
  now: number,
  into: UsagePeriods = emptyUsagePeriods(),
): UsagePeriods {
  const at = new Date(now)
  const yearStart = Date.UTC(at.getUTCFullYear(), 0, 1)
  const monthStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)
  for (const event of events) {
    if (event.type !== 'assistant/message' || event.time < yearStart || event.time > now) continue
    const data = event.data as { message?: { source?: { provider?: unknown; model?: unknown } }; usage?: unknown }
    const provider = data.message?.source?.provider
    if (typeof provider !== 'string') continue
    const tokens = tokensOf(data.usage)
    if (tokens === undefined) continue
    const model = typeof data.message?.source?.model === 'string' ? data.message.source.model : ''
    const sum = totalTokens(tokens)
    const category = classify(provider)
    into.year[category] += sum
    into.year.total += sum
    addDetail(into.models.year, provider, model, tokens)
    if (event.time >= monthStart) {
      into.month[category] += sum
      into.month.total += sum
      addDetail(into.models.month, provider, model, tokens)
    }
  }
  return into
}

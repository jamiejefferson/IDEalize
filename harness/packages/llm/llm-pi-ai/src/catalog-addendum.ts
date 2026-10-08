/**
 * Catalog entries for models released after the installed pi-ai. IDEalize fork
 * seam: pi-ai 0.99 reshaped its image and transcript types, so moving past
 * 0.85.1 is its own piece of work, while users asked for these models now
 * (feedback 32d1ec28, 5 Oct 2026).
 *
 * Each entry is copied from pi-ai 1.1.0's `providers/data` catalog, trimmed to
 * the fields 0.85.1's `Model` type describes. Anthropic's list prices agree
 * with the published rates (Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10 per MTok,
 * cache reads $0.20). An installed entry with the same id always wins, so a
 * later pi-ai bump supersedes this list without anyone deleting it.
 *
 * Neither model can turn thinking off (`off: null`): Opus 5.5 and Sonnet 5.5
 * both answer a disabled-thinking request with a 400.
 *
 * @module dsh-llm-pi-ai/catalog-addendum
 */

import type { Api, Model, ThinkingLevelMap } from '@earendil-works/pi-ai'

const ADAPTIVE_ONLY: ThinkingLevelMap = {
  off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
}

const ANTHROPIC_COMPAT = {
  supportsMidConvoEffort: true, forceAdaptiveThinking: true, supportsTemperature: false, supportsStrictTools: true,
}

const OPENROUTER_COMPAT = { supportsMidConvoEffort: true, forceAdaptiveThinking: true, supportsTemperature: false }

const ADDENDUM: Readonly<Record<string, readonly Model<Api>[]>> = {
  anthropic: [
    {
      id: 'claude-opus-5-5', name: 'Claude Opus 5.5', api: 'anthropic-messages', provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com', reasoning: true, thinkingLevelMap: ADAPTIVE_ONLY, input: ['text', 'image'],
      cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, contextWindow: 1_000_000, maxTokens: 128_000,
      compat: ANTHROPIC_COMPAT,
    },
    {
      id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', api: 'anthropic-messages', provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com', reasoning: true, thinkingLevelMap: ADAPTIVE_ONLY, input: ['text', 'image'],
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, contextWindow: 1_000_000, maxTokens: 128_000,
      compat: ANTHROPIC_COMPAT,
    },
  ],
  openrouter: [
    {
      id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', api: 'anthropic-messages', provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api', reasoning: true, thinkingLevelMap: ADAPTIVE_ONLY, input: ['text', 'image'],
      cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, contextWindow: 1_000_000, maxTokens: 128_000,
      compat: OPENROUTER_COMPAT,
    },
    {
      id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', api: 'anthropic-messages', provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api', reasoning: true, thinkingLevelMap: ADAPTIVE_ONLY, input: ['text', 'image'],
      cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, contextWindow: 1_000_000, maxTokens: 128_000,
      compat: OPENROUTER_COMPAT,
    },
  ],
}

/**
 * Addendum models for one route that the installed catalog does not already
 * describe.
 * @param provider - provider route key.
 * @param installed - ids the installed catalog ships for that route.
 * @returns the missing models, in release order.
 */
export function catalogAddendum(provider: string, installed: ReadonlySet<string>): Model<Api>[] {
  return (ADDENDUM[provider] ?? []).filter(model => !installed.has(model.id))
}

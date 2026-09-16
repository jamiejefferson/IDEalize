import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { categoryOf, foldUsage } from '../src/usage.ts'

const FACTS = { freeProvider: 'freetokens', subscriptionProviders: ['openai-codex'] }
const classify = (provider: string) => categoryOf(provider, FACTS)

// 2026-08-21T12:00Z: month starts 2026-08-01, year starts 2026-01-01.
const NOW = Date.UTC(2026, 7, 21, 12)

function message(provider: string, time: number, usage?: Record<string, number>, model: unknown = 'm'): SessionEvent {
  return {
    type: 'assistant/message',
    time,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider, model } }, usage },
  } as unknown as SessionEvent
}

describe('categoryOf', () => {
  it('places the free route, subscription sign-ins, and everything else', () => {
    expect(classify('freetokens')).toBe('free')
    expect(classify('openai-codex')).toBe('subscriptions')
    expect(classify('anthropic')).toBe('metered')
  })
})

describe('foldUsage', () => {
  it('sums billed tokens per category into month and year buckets', () => {
    const events = [
      message('openai-codex', Date.UTC(2026, 7, 20), { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 }),
      message('anthropic', Date.UTC(2026, 2, 3), { inputTokens: 1000, outputTokens: 0 }),
      message('freetokens', Date.UTC(2026, 7, 1), { inputTokens: 7, outputTokens: 3, reasoningTokens: 999 }),
    ]
    const { month, year } = foldUsage(events, classify, NOW)
    expect(month).toEqual({ subscriptions: 160, metered: 0, free: 10, total: 170 })
    expect(year).toEqual({ subscriptions: 160, metered: 1000, free: 10, total: 1170 })
  })

  it('keeps the per-route detail behind the totals for pricing', () => {
    const events = [
      message('anthropic', Date.UTC(2026, 7, 20), { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 5 }, 'claude'),
      message('anthropic', Date.UTC(2026, 7, 21), { inputTokens: 1, outputTokens: 1 }, 'claude'),
      message('anthropic', Date.UTC(2026, 2, 3), { inputTokens: 40 }, 'haiku'),
    ]
    const { models } = foldUsage(events, classify, NOW)
    expect(models.month).toEqual({
      anthropic: { claude: { inputTokens: 101, outputTokens: 51, cacheReadTokens: 0, cacheWriteTokens: 5 } },
    })
    expect(models.year.anthropic).toEqual({
      claude: { inputTokens: 101, outputTokens: 51, cacheReadTokens: 0, cacheWriteTokens: 5 },
      haiku: { inputTokens: 40, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
  })

  it("files a call that named no model under ''", () => {
    const { models } = foldUsage([message('anthropic', NOW - 1, { inputTokens: 2 }, null)], classify, NOW)
    expect(models.month).toEqual({
      anthropic: { '': { inputTokens: 2, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    })
  })

  it('ignores last year, the future, messages without usage or provider, and other event types', () => {
    const events = [
      message('anthropic', Date.UTC(2025, 11, 31, 23), { inputTokens: 5, outputTokens: 5 }),
      message('anthropic', NOW + 1, { inputTokens: 5, outputTokens: 5 }),
      message('anthropic', Date.UTC(2026, 7, 2)),
      message('anthropic', Date.UTC(2026, 7, 2), { reasoningTokens: 5 }),
      {
        type: 'assistant/message',
        time: Date.UTC(2026, 7, 2),
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens: 5 } },
      } as unknown as SessionEvent,
      { type: 'user/message', time: Date.UTC(2026, 7, 2), data: {} } as unknown as SessionEvent,
    ]
    const { month, year, models } = foldUsage(events, classify, NOW)
    expect(month.total).toBe(0)
    expect(year.total).toBe(0)
    expect(models.year).toEqual({})
  })

  it('accumulates into the totals it is handed', () => {
    const into = foldUsage([message('freetokens', NOW - 1, { inputTokens: 1, outputTokens: 1 })], classify, NOW)
    foldUsage([message('freetokens', NOW - 2, { inputTokens: 2, outputTokens: 2 })], classify, NOW, into)
    expect(into.month.free).toBe(6)
    expect(into.models.month.freetokens!.m).toEqual({ inputTokens: 3, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })
})

// @vitest-environment jsdom
// The heart's rating line, the dislike's offer and the comparison card over
// stubbed router routes: the heart opens a line for the model behind the last
// answer and saves stars without sending the model anything, the offer names
// both models and the price of both runs, and the card keeps one answer.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { CompareCard } from '../src/client/CompareCard.tsx'
import { foldStep } from '../src/client/compare-node.ts'
import type { CompareNodeData } from '../src/client/compare-node.ts'
import { en } from '../src/client/locales.ts'
import { RatingLine } from '../src/client/RatingLine.tsx'
import type { RatingLineProps } from '../src/client/RatingLine.tsx'
import { openOffer, openRating, priceKey, setLine } from '../src/client/rating-line.ts'

const t = makeTranslate(en, commonEn)
const at = '2026-10-28T12:00:00.000Z'

interface RecordedCall { url: string; body?: unknown }

function stub(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: RecordedCall[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { body?: string }) => {
    calls.push({ url, ...init?.body === undefined ? {} : { body: JSON.parse(init.body) as unknown } })
    const path = url.split('?')[0] ?? url
    const route = routes[path] ?? { status: 404, body: { error: 'no route' } }
    return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } }))
  }))
  return calls
}

const emptySession = { chat: { nodes: { values: () => [] } } }
const line = (sessionId: string) => render(<RatingLine {...{ sessionId, session: emptySession, t } as unknown as RatingLineProps} />)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setLine('s1', undefined)
})

describe('the heart', () => {
  it('opens a line for the last answer\'s model and saves stars without a message', async () => {
    const calls = stub({
      '/idealize/router/rate-target': {
        body: { kind: 'chat', provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5', tag: 'writing', tags: ['coding', 'writing'], stars: {} },
      },
      '/idealize/router/ratings': { body: { ok: true, models: {} } },
    })
    const view = line('s1')
    await openRating('s1', 'nothing yet')
    await waitFor(() => { expect(view.container.querySelector('[data-rating-line="rate"]')).not.toBeNull() })
    expect(view.container.textContent).toContain('Rate Claude Sonnet 5 for')
    fireEvent.click(view.container.querySelector('[data-rating-star="4"]') as Element)
    await waitFor(() => { expect(view.container.textContent).toContain('Saved: 4 stars for Writing') })
    expect(calls.find(call => call.url === '/idealize/router/ratings')?.body).toMatchObject({
      kind: 'chat', provider: 'anthropic', model: 'claude-sonnet-5', tag: 'writing', stars: 4,
    })
  })

  it('says so when there is no answer to rate', async () => {
    stub({ '/idealize/router/rate-target': { status: 409, body: { error: 'this chat has no answer to rate yet' } } })
    const view = line('s1')
    await openRating('s1', 'There is no answer to rate yet.')
    await waitFor(() => { expect(view.container.textContent).toContain('There is no answer to rate yet.') })
  })
})

describe('the dislike', () => {
  it('offers both models with the price of both runs', async () => {
    const calls = stub({
      '/idealize/router/offer': {
        body: {
          kind: 'chat', tag: 'writing', first: { provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
          alternatives: [{ provider: 'openrouter', model: 'openai/gpt-5.5', label: 'GPT-5.5' }, { provider: 'openrouter', model: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash' }],
          price: { amount: 0.042 },
        },
      },
      '/idealize/router/compare': { body: { ok: true, id: 'c1' } },
    })
    const view = line('s1')
    await openOffer('s1', reason => reason)
    await waitFor(() => { expect(view.container.textContent).toContain('Try GPT-5.5 and Gemini 3.6 Flash on the same ask?') })
    // What one click sends, and to whom, is on the line before the click.
    expect(view.container.querySelector('[data-rating-sends]')?.textContent)
      .toBe('This sends your whole conversation to the companies behind GPT-5.5 and Gemini 3.6 Flash.')
    const button = view.container.querySelector('[data-rating-try]') as HTMLButtonElement
    expect(button.textContent).toBe('Try both · about $0.04')
    fireEvent.click(button)
    await waitFor(() => { expect(view.container.querySelector('[data-rating-line]')).toBeNull() })
    expect(calls.find(call => call.url === '/idealize/router/compare')?.body).toMatchObject({ sessionId: 's1' })
  })

  it('says a picture sends its prompt and settings, and names one company for one model', async () => {
    stub({
      '/idealize/router/offer': {
        body: {
          kind: 'image', tag: 'illustration', first: { provider: 'gen', model: 'a', label: 'First' },
          alternatives: [{ provider: 'gen', model: 'b', label: 'Second' }],
          price: { unknown: true },
        },
      },
    })
    const view = line('s9')
    await openOffer('s9', reason => reason)
    await waitFor(() => {
      expect(view.container.querySelector('[data-rating-sends]')?.textContent)
        .toBe('This sends your prompt and its settings to the company behind Second.')
    })
  })

  it('words the price', () => {
    expect(priceKey({ unknown: true }).key).toBe('line.offer.price.unknown')
    expect(priceKey({ amount: 0 }).key).toBe('line.offer.price.free')
    expect(priceKey({ amount: 0.004 }).key).toBe('line.offer.price.under')
    expect(priceKey({ amount: 0.042 })).toEqual({ key: 'line.offer.price.about', amount: '0.04' })
  })
})

describe('the comparison card', () => {
  const started: CompareNodeData = {
    started: {
      id: 'c1', phase: 'started', at, kind: 'chat', tag: 'writing',
      first: { provider: 'anthropic', model: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      alternatives: [{ provider: 'openrouter', model: 'openai/gpt-5.5', label: 'GPT-5.5' }, { provider: 'openrouter', model: 'x/y', label: 'Y' }],
    },
    answers: [undefined, undefined],
  }

  it('folds answers and the pick', () => {
    const answered = foldStep(started, { id: 'c1', phase: 'answer', at, index: 0, text: 'From GPT' })
    expect(answered.answers[0]?.text).toBe('From GPT')
    expect(foldStep(answered, { id: 'c1', phase: 'picked', at, index: 0 }).picked).toBe(0)
  })

  it('keeps an alternative that has answered', async () => {
    const calls = stub({ '/idealize/router/pick': { body: { ok: true } } })
    const data = foldStep(foldStep(started, { id: 'c1', phase: 'answer', at, index: 0, text: 'From GPT' }), { id: 'c1', phase: 'answer', at, index: 1, failed: 'busy' })
    const view = render(<CompareCard sessionId="s1" data={data} t={t} />)
    expect(view.container.textContent).toContain('Two other answers to your last message')
    expect(view.container.textContent).toContain('Y couldn’t answer: busy')
    expect((view.container.querySelector('[data-compare-use="1"]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.container.querySelector('[data-compare-use="0"]') as Element)
    await waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]?.body).toEqual({ sessionId: 's1', id: 'c1', index: 0 })
  })

  it('folds to one line once the person picks', () => {
    const data = { ...foldStep(started, { id: 'c1', phase: 'answer', at, index: 0, text: 'From GPT' }), picked: 0 }
    const view = render(<CompareCard sessionId="s1" data={data} t={t} />)
    expect(view.container.textContent).toContain('You kept GPT-5.5’s answer, and this chat now runs on it.')
    expect(view.container.querySelector('[data-compare-use]')).toBeNull()
  })
})

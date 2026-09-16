import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  effectivePrices, OPENROUTER_MODELS_URL, openRouterPrices, parsePriceBody, readOpenRouterPriceCache, refreshOpenRouterPrices,
  writeOpenRouterPriceCache,
} from '../src/prices.ts'

const made: string[] = []
const home = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'idealize-models-'))
  made.push(path)
  return path
}
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }) })

/** A slice of OpenRouter's `/api/v1/models` payload: prices are USD per token, printed as strings. */
const DIRECTORY = {
  data: [
    {
      id: 'anthropic/claude-sonnet-4.5',
      name: 'Anthropic: Claude Sonnet 4.5',
      pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375', request: '0', image: '0.0048' },
    },
    // No cache fields: the upstream provider offers no cache discount.
    { id: 'openai/gpt-oss-120b', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
    // Free routes price at zero, which is a real published price.
    { id: 'google/gemma-3-27b-it:free', pricing: { prompt: '0', completion: '0' } },
    // Numbers, should the directory ever print them as such, read the same as strings.
    { id: 'numeric/row', pricing: { prompt: 0.000002, completion: 0.000004 } },
    // Unusable rows: no completion price, a non-numeric price, no id, not an object at all.
    { id: 'broken/no-completion', pricing: { prompt: '0.000001' } },
    { id: 'broken/words', pricing: { prompt: 'n/a', completion: '0.000001' } },
    { pricing: { prompt: '0.000001', completion: '0.000001' } },
    null,
    'not-a-row',
  ],
}

describe('openRouterPrices', () => {
  it('converts per-token strings to per-million figures, cache kinds falling to the prompt price when unpublished', () => {
    const prices = openRouterPrices(DIRECTORY)
    expect(prices['anthropic/claude-sonnet-4.5']).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })
    expect(prices['openai/gpt-oss-120b']).toEqual({ input: 0.15, output: 0.6, cacheRead: 0.15, cacheWrite: 0.15 })
    expect(prices['google/gemma-3-27b-it:free']).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(prices['numeric/row']).toEqual({ input: 2, output: 4, cacheRead: 2, cacheWrite: 2 })
  })

  it('skips rows without both a prompt and a completion price rather than pricing them at zero', () => {
    expect(Object.keys(openRouterPrices(DIRECTORY)).sort()).toEqual([
      'anthropic/claude-sonnet-4.5', 'google/gemma-3-27b-it:free', 'numeric/row', 'openai/gpt-oss-120b',
    ])
    expect(openRouterPrices({ data: 'nope' })).toEqual({})
    expect(openRouterPrices(null)).toEqual({})
  })
})

describe('the OpenRouter price cache', () => {
  it('round-trips through <home>/service-catalogues/openrouter-prices.json with its read time', () => {
    const dir = home()
    const written = writeOpenRouterPriceCache(dir, openRouterPrices(DIRECTORY), Date.UTC(2026, 8, 8, 10, 12))
    expect(written.fetchedAt).toBe('2026-09-08T10:12:00.000Z')
    const file = JSON.parse(readFileSync(join(dir, 'service-catalogues', 'openrouter-prices.json'), 'utf8')) as { fetchedAt: string }
    expect(file.fetchedAt).toBe('2026-09-08T10:12:00.000Z')
    expect(readOpenRouterPriceCache(dir)).toEqual(written)
  })

  it('reads a missing, truncated or hand-edited file as no cache, dropping rows with a kind missing', () => {
    const dir = home()
    expect(readOpenRouterPriceCache(dir)).toBeUndefined()
    mkdirSync(join(dir, 'service-catalogues'))
    writeFileSync(join(dir, 'service-catalogues', 'openrouter-prices.json'), '{"fetchedAt": "2026-', 'utf8')
    expect(readOpenRouterPriceCache(dir)).toBeUndefined()
    writeFileSync(join(dir, 'service-catalogues', 'openrouter-prices.json'), '{"fetchedAt": "2026-09-08T10:12:00.000Z", "prices": null}', 'utf8')
    expect(readOpenRouterPriceCache(dir)).toBeUndefined()
    writeFileSync(join(dir, 'service-catalogues', 'openrouter-prices.json'), JSON.stringify({
      fetchedAt: '2026-09-08T10:12:00.000Z',
      prices: { whole: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, partial: { input: 1, output: 2 } },
    }), 'utf8')
    expect(readOpenRouterPriceCache(dir)).toEqual({
      fetchedAt: '2026-09-08T10:12:00.000Z',
      prices: { whole: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
    })
  })
})

describe('refreshOpenRouterPrices', () => {
  const NOW = Date.UTC(2026, 8, 8, 10, 12)
  const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  it('fetches the directory when there is no cache and writes what it read', async () => {
    const dir = home()
    const fetchImpl = vi.fn(() => Promise.resolve(ok(DIRECTORY)))
    const list = await refreshOpenRouterPrices({ home: dir, fetchImpl: fetchImpl, maxAgeMs: 60_000, now: NOW })
    expect(fetchImpl).toHaveBeenCalledWith(OPENROUTER_MODELS_URL, expect.anything())
    expect(list?.fetchedAt).toBe('2026-09-08T10:12:00.000Z')
    expect(list?.prices['anthropic/claude-sonnet-4.5']?.output).toBe(15)
    expect(readOpenRouterPriceCache(dir)).toEqual(list)
  })

  it('serves a fresh cache without a fetch, refreshes a stale one, and keeps the cache when the fetch fails', async () => {
    const dir = home()
    writeOpenRouterPriceCache(dir, { old: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }, NOW - 30_000)
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')))
    const fresh = await refreshOpenRouterPrices({ home: dir, fetchImpl: fetchImpl, maxAgeMs: 60_000, now: NOW })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(Object.keys(fresh?.prices ?? {})).toEqual(['old'])
    const kept = await refreshOpenRouterPrices({ home: dir, fetchImpl: fetchImpl, maxAgeMs: 1_000, now: NOW })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(Object.keys(kept?.prices ?? {})).toEqual(['old'])
    // A refused response or an empty directory also leaves the cache standing.
    const refused = vi.fn(() => Promise.resolve(new Response('', { status: 429 })))
    const afterRefusal = await refreshOpenRouterPrices({ home: dir, fetchImpl: refused, maxAgeMs: 1_000, now: NOW })
    expect(Object.keys(afterRefusal?.prices ?? {})).toEqual(['old'])
    const empty = vi.fn(() => Promise.resolve(ok({ data: [] })))
    const afterEmpty = await refreshOpenRouterPrices({ home: dir, fetchImpl: empty, maxAgeMs: 1_000, now: NOW })
    expect(Object.keys(afterEmpty?.prices ?? {})).toEqual(['old'])
  })

  it('never fetches with refresh disabled, and yields nothing with no cache', async () => {
    const dir = home()
    const fetchImpl = vi.fn(() => Promise.resolve(ok(DIRECTORY)))
    expect(await refreshOpenRouterPrices({ home: dir, fetchImpl: fetchImpl, maxAgeMs: 0, now: NOW })).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('effectivePrices', () => {
  it('marks OpenRouter rows by source and lets a typed price win over a fetched one', () => {
    const table = effectivePrices(
      { openrouter: { 'a/b': { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 } }, anthropic: { claude: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } } },
      { 'a/b': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, 'c/d': { input: 5, output: 6, cacheRead: 7, cacheWrite: 8 } },
    )
    expect(table.openrouter?.['a/b']).toEqual({ input: 9, output: 9, cacheRead: 9, cacheWrite: 9, source: 'user' })
    expect(table.openrouter?.['c/d']).toEqual({ input: 5, output: 6, cacheRead: 7, cacheWrite: 8, source: 'market' })
    expect(table.anthropic?.claude?.source).toBe('user')
    expect(effectivePrices({}, undefined)).toEqual({})
  })

  it('ranks the person\u2019s entry over OpenRouter\u2019s directory over the shipped catalogue', () => {
    const catalogue = {
      anthropic: {
        claude: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      openrouter: { 'a/b': { input: 100, output: 100, cacheRead: 100, cacheWrite: 100 } },
    }
    const table = effectivePrices(
      { anthropic: { claude: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 } } },
      { 'a/b': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
      catalogue,
    )
    // The person's figure wins over the catalogue's for the same model.
    expect(table.anthropic?.claude).toEqual({ input: 9, output: 9, cacheRead: 9, cacheWrite: 9, source: 'user' })
    // A catalogue model nobody typed keeps the catalogue's figure and its mark.
    expect(table.anthropic?.haiku).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, source: 'catalogue' })
    // OpenRouter's published price replaces the catalogue's for its own route.
    expect(table.openrouter?.['a/b']).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, source: 'market' })
    // The catalogue alone still prices, with no directory read and nothing typed.
    expect(effectivePrices({}, undefined, catalogue).anthropic?.claude?.source).toBe('catalogue')
  })
})

describe('parsePriceBody', () => {
  it('accepts a complete price or null, and names what a refused body lacks', () => {
    expect(parsePriceBody({ provider: 'anthropic', model: 'claude', price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }))
      .toEqual({ ok: true, write: { provider: 'anthropic', model: 'claude', price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } } })
    expect(parsePriceBody({ provider: 'anthropic', model: 'claude', price: null }))
      .toEqual({ ok: true, write: { provider: 'anthropic', model: 'claude', price: null } })
    expect(parsePriceBody(null)).toEqual({ ok: false, error: 'body must be an object' })
    expect(parsePriceBody({ provider: '', model: 'claude', price: null })).toEqual({ ok: false, error: 'provider and model are required' })
    expect(parsePriceBody({ provider: 'anthropic', model: 'claude' }).ok).toBe(false)
    // A missing kind is never read as free, and a negative or non-finite figure is refused.
    expect(parsePriceBody({ provider: 'anthropic', model: 'claude', price: { input: 3, output: 15 } }).ok).toBe(false)
    expect(parsePriceBody({ provider: 'anthropic', model: 'claude', price: { input: -1, output: 15, cacheRead: 0, cacheWrite: 0 } }).ok).toBe(false)
    expect(parsePriceBody({ provider: 'anthropic', model: 'claude', price: { input: '3', output: 15, cacheRead: 0, cacheWrite: 0 } }).ok).toBe(false)
  })
})

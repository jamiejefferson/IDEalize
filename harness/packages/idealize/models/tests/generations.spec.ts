// The Budget tab's generation half: the local fold of committed artefacts per
// endpoint, the reader over fal's `/models/usage` payload (its published
// `time_series` buckets and error body), the cache under the harness home, and
// the merge that lists what was made beside what fal billed for it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  emptyGenerationPeriods, FAL_USAGE_URL, falUsageLines, foldGenerations, generationRows, readFalUsageCache, refreshFalUsage,
  writeFalUsageCache,
} from '../src/generations.ts'
import type { FalBilledLine, FalUsageCache } from '../src/generations.ts'

const made: string[] = []
const home = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'idealize-generations-'))
  made.push(path)
  return path
}
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }) })

/** Noon on 8 September 2026 UTC: the month starts on the 1st, the year on 1 January. */
const NOW = Date.UTC(2026, 8, 8, 12)
const cacheFile = (path: string): string => join(path, 'service-catalogues', 'fal-usage.json')

/** One `artefact/created` event as the artefact store appends it; `null` writes a record carrying no media type. */
const madeAt = (time: number, provenance: unknown, mediaType: string | null = 'image/png'): SessionEvent =>
  ({
    type: 'artefact/created',
    time,
    data: { record: { provenance, ...mediaType === null ? {} : { mediaType } } },
  }) as unknown as SessionEvent

/** An event of another type, which the fold passes over. */
const other = (time: number): SessionEvent => ({ type: 'llm/response', time, data: {} }) as unknown as SessionEvent

describe('foldGenerations', () => {
  it('counts this month and this year per endpoint, and leaves out what falls outside them', () => {
    const events = [
      madeAt(Date.UTC(2026, 8, 2), { provider: 'fal', model: 'fal-ai/flux/dev' }),
      madeAt(Date.UTC(2026, 8, 3), { provider: 'fal', model: 'fal-ai/flux/dev' }),
      madeAt(Date.UTC(2026, 8, 4), { provider: 'fal', model: 'fal-ai/kling/video' }, 'video/mp4'),
      // Earlier this year: the year counts it, the month does not.
      madeAt(Date.UTC(2026, 5, 20), { provider: 'fal', model: 'fal-ai/flux/dev' }),
      // The last instant before this month, and the first of it.
      madeAt(Date.UTC(2026, 8, 1) - 1, { provider: 'fal', model: 'fal-ai/flux/dev' }),
      madeAt(Date.UTC(2026, 8, 1), { provider: 'fal', model: 'fal-ai/flux/dev' }),
      // Last year, and a clock-skewed event after `now`: neither is counted.
      madeAt(Date.UTC(2025, 11, 31), { provider: 'fal', model: 'fal-ai/flux/dev' }),
      madeAt(Date.UTC(2026, 8, 9), { provider: 'fal', model: 'fal-ai/flux/dev' }),
      other(Date.UTC(2026, 8, 5)),
    ]
    const periods = foldGenerations(events, NOW)
    expect(periods.month.fal).toEqual({
      'fal-ai/flux/dev': { count: 3, mediaType: 'image/png' },
      'fal-ai/kling/video': { count: 1, mediaType: 'video/mp4' },
    })
    expect(periods.year.fal?.['fal-ai/flux/dev']).toEqual({ count: 5, mediaType: 'image/png' })
  })

  it('skips a record whose provenance names no endpoint, and keeps the media type of the one it counts', () => {
    const periods = foldGenerations([
      madeAt(Date.UTC(2026, 8, 5), undefined),
      madeAt(Date.UTC(2026, 8, 5), { model: 'fal-ai/flux/dev' }),
      madeAt(Date.UTC(2026, 8, 5), { provider: 'fal' }),
      madeAt(Date.UTC(2026, 8, 5), { provider: 'mediahub', model: 'still-a' }, 'image/webp'),
      // A record older than the media-type field reads as no kind, never as a guess.
      madeAt(Date.UTC(2026, 8, 5), { provider: 'mediahub', model: 'still-b' }, null),
    ], NOW, emptyGenerationPeriods())
    expect(periods.month).toEqual({
      mediahub: {
        'still-a': { count: 1, mediaType: 'image/webp' },
        'still-b': { count: 1, mediaType: '' },
      },
    })
  })

  it('adds into the fold it is handed, so one pass covers every session', () => {
    const into = emptyGenerationPeriods()
    foldGenerations([madeAt(Date.UTC(2026, 8, 5), { provider: 'fal', model: 'fal-ai/flux/dev' })], NOW, into)
    foldGenerations([madeAt(Date.UTC(2026, 8, 6), { provider: 'fal', model: 'fal-ai/flux/dev' })], NOW, into)
    expect(into.month.fal?.['fal-ai/flux/dev']?.count).toBe(2)
  })
})

/** One usage line as fal's item schema publishes it. */
const item = (endpoint: string, quantity: number, cost: number, unit = 'image'): Record<string, unknown> => ({
  endpoint_id: endpoint,
  unit,
  quantity,
  unit_price: cost / quantity,
  percent_discount: null,
  cost_subtotal: cost,
  cost_discount: 0,
  cost_total: cost,
  cost,
  currency: 'USD',
  auth_method: 'Production Key',
})

/** The first page fal answers: two months of buckets, one of them carrying a malformed item. */
const PAGE_ONE = {
  time_series: [
    {
      bucket: '2026-09-01T00:00:00+00:00',
      results: [
        item('fal-ai/flux/dev', 4, 0.32),
        // Billed twice this month at different discount rates: fal sends two rows.
        item('fal-ai/flux/dev', 2, 0.2),
        // Skipped rather than billed at zero: no cost_total, and no endpoint id.
        { endpoint_id: 'fal-ai/broken', unit: 'image', quantity: 1, currency: 'USD' },
        { unit: 'image', quantity: 1, cost_total: 5, currency: 'USD' },
        'not-an-item',
      ],
    },
    { bucket: '2026-06-01T00:00:00+00:00', results: [item('fal-ai/flux/dev', 1, 0.08)] },
  ],
  next_cursor: 'Mg==',
  has_more: true,
}

/** The last page: one more endpoint this month, and no cursor to follow. */
const PAGE_TWO = {
  time_series: [
    { bucket: '2026-09-01T00:00:00+00:00', results: [item('fal-ai/kling/video', 1, 1.4, 'video')] },
  ],
  next_cursor: null,
  has_more: false,
}

describe('falUsageLines', () => {
  it('files each bucket under its calendar month, merges repeated lines, and skips a malformed item', () => {
    const months: Record<string, FalBilledLine[]> = {}
    const cursor = falUsageLines(PAGE_ONE, months)
    expect(cursor).toBe('Mg==')
    expect(months['2026-09']).toEqual([{ endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 6, cost: 0.52, currency: 'USD' }])
    expect(months['2026-06']).toEqual([{ endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 1, cost: 0.08, currency: 'USD' }])
    expect(falUsageLines(PAGE_TWO, months)).toBeUndefined()
    expect(months['2026-09']).toHaveLength(2)
  })

  it('reads nothing from a payload without usable buckets, and treats an empty cursor as the last page', () => {
    const months: Record<string, FalBilledLine[]> = {}
    expect(falUsageLines({ time_series: 'nope', next_cursor: '' }, months)).toBeUndefined()
    expect(falUsageLines(undefined, months)).toBeUndefined()
    expect(falUsageLines({
      time_series: [
        null,
        'not-a-bucket',
        { bucket: 7, results: [] },
        { bucket: 'not-a-date', results: [] },
        { bucket: '2026-09-01T00:00:00+00:00', results: 'nope' },
        // Every field fal requires must be usable: a wrong currency code, a
        // non-string unit and a negative quantity each drop their line.
        {
          bucket: '2026-09-01T00:00:00+00:00',
          results: [
            { ...item('fal-ai/flux/dev', 1, 0.1), currency: 'DOLLARS' },
            { ...item('fal-ai/flux/dev', 1, 0.1), unit: 3 },
            { ...item('fal-ai/flux/dev', 1, 0.1), quantity: -1 },
            { ...item('fal-ai/flux/dev', 1, 0.1), cost_total: Number.NaN },
            { ...item('', 1, 0.1) },
          ],
        },
      ],
    }, months)).toBeUndefined()
    expect(months).toEqual({ '2026-09': [] })
  })
})

describe('the fal usage cache', () => {
  it('round-trips through <home>/service-catalogues/fal-usage.json', () => {
    const path = home()
    const cache: FalUsageCache = {
      fetchedAt: new Date(NOW).toISOString(),
      year: 2026,
      months: { '2026-09': [{ endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 6, cost: 0.52, currency: 'USD' }] },
    }
    expect(writeFalUsageCache(path, cache)).toBe(cache)
    expect(readFalUsageCache(path, 2026)).toEqual(cache)
    expect(readFileSync(cacheFile(path), 'utf8').endsWith('\n')).toBe(true)
  })

  it('reads nothing for another year, an unreadable file, or a file whose fields do not hold', () => {
    const path = home()
    expect(readFalUsageCache(path, 2026)).toBeUndefined()
    writeFalUsageCache(path, { fetchedAt: new Date(NOW).toISOString(), year: 2025, months: {} })
    expect(readFalUsageCache(path, 2026)).toBeUndefined()
    writeFileSync(cacheFile(path), '{"fetchedAt":"2026-09-08T12:00', 'utf8')
    expect(readFalUsageCache(path, 2026)).toBeUndefined()
    writeFileSync(cacheFile(path), JSON.stringify({ year: 2026, months: {} }), 'utf8')
    expect(readFalUsageCache(path, 2026)).toBeUndefined()
    writeFileSync(cacheFile(path), JSON.stringify({ fetchedAt: 'now', year: 2026, months: null }), 'utf8')
    expect(readFalUsageCache(path, 2026)).toBeUndefined()
  })

  it('drops a hand-edited row rather than reading a gap as a free generation', () => {
    const path = home()
    mkdirSync(join(path, 'service-catalogues'), { recursive: true })
    writeFileSync(cacheFile(path), JSON.stringify({
      fetchedAt: new Date(NOW).toISOString(),
      year: 2026,
      months: {
        '2026-09': [
          { endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 6, cost: 0.52, currency: 'USD' },
          null,
          { endpoint: 7, unit: 'image', quantity: 1, cost: 1, currency: 'USD' },
          { endpoint: 'a', unit: 3, quantity: 1, cost: 1, currency: 'USD' },
          { endpoint: 'a', unit: 'image', quantity: 1, cost: 1, currency: 9 },
          { endpoint: 'a', unit: 'image', quantity: 'six', cost: 1, currency: 'USD' },
          { endpoint: 'a', unit: 'image', quantity: 1, cost: -1, currency: 'USD' },
        ],
        '2026-08': 'not-an-array',
      },
    }), 'utf8')
    expect(readFalUsageCache(path, 2026)?.months).toEqual({
      '2026-09': [{ endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 6, cost: 0.52, currency: 'USD' }],
    })
  })
})

/** A fetch answering the two published pages in order, recording every URL it was asked for. */
const paged = (): { fetchImpl: typeof fetch; urls: string[] } => {
  const urls: string[] = []
  const fetchImpl: typeof fetch = (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    urls.push(url)
    const body = url.includes('cursor=Mg') ? PAGE_TWO : PAGE_ONE
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  return { fetchImpl, urls }
}

describe('refreshFalUsage', () => {
  it('follows fal’s cursor through every page and writes what it read under the home', async () => {
    const path = home()
    const { fetchImpl, urls } = paged()
    const { usage, error } = await refreshFalUsage({ home: path, key: 'fal-test', fetchImpl, maxAgeMs: 60_000, now: NOW })
    expect(error).toBeUndefined()
    expect(urls).toHaveLength(2)
    expect(urls[0]?.startsWith(FAL_USAGE_URL)).toBe(true)
    const query = new URL(urls[0]!).searchParams
    expect(query.get('start')).toBe('2026-01-01')
    expect(query.get('timeframe')).toBe('month')
    expect(query.get('expand')).toBe('time_series')
    expect(query.get('cursor')).toBeNull()
    expect(new URL(urls[1]!).searchParams.get('cursor')).toBe('Mg==')
    expect(usage?.year).toBe(2026)
    expect(usage?.months['2026-09']?.map(line => line.endpoint)).toEqual(['fal-ai/flux/dev', 'fal-ai/kling/video'])
    expect(readFalUsageCache(path, 2026)).toEqual(usage)
  })

  it('answers a fresh cache from disk, refreshes a stale one, and never fetches while the age is zero', async () => {
    const path = home()
    const cache: FalUsageCache = {
      fetchedAt: new Date(NOW - 30_000).toISOString(),
      year: 2026,
      months: { '2026-09': [{ endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 1, cost: 0.1, currency: 'USD' }] },
    }
    writeFalUsageCache(path, cache)
    const fresh = paged()
    expect((await refreshFalUsage({ home: path, key: 'k', fetchImpl: fresh.fetchImpl, maxAgeMs: 60_000, now: NOW })).usage).toEqual(cache)
    expect(fresh.urls).toHaveLength(0)

    // Older than the age it is trusted for: fal is read again.
    const stale = paged()
    const refreshed = await refreshFalUsage({ home: path, key: 'k', fetchImpl: stale.fetchImpl, maxAgeMs: 10_000, now: NOW })
    expect(stale.urls).toHaveLength(2)
    expect(refreshed.usage?.fetchedAt).toBe(new Date(NOW).toISOString())

    // Zero minutes configured: the cache stands and nothing is fetched.
    const never = paged()
    expect((await refreshFalUsage({ home: path, key: 'k', fetchImpl: never.fetchImpl, maxAgeMs: 0, now: NOW })).usage?.fetchedAt)
      .toBe(new Date(NOW).toISOString())
    expect(never.urls).toHaveLength(0)
    // With no cache at all, zero minutes reports nothing rather than a figure.
    expect(await refreshFalUsage({ home: home(), key: 'k', fetchImpl: never.fetchImpl, maxAgeMs: 0, now: NOW })).toEqual({})
  })

  it('reports fal’s own refusal message and keeps the report it already has', async () => {
    const path = home()
    const cache: FalUsageCache = { fetchedAt: new Date(NOW - 60_000).toISOString(), year: 2026, months: {} }
    writeFalUsageCache(path, cache)
    const refused = ((): Promise<Response> => Promise.resolve(new Response(
      JSON.stringify({ error: { type: 'authorization_error', message: 'Access denied' } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ))) as typeof fetch
    expect(await refreshFalUsage({ home: path, key: 'k', fetchImpl: refused, maxAgeMs: 1, now: NOW }))
      .toEqual({ usage: cache, error: 'fal.ai answered 403: Access denied' })

    // A refusal that is not fal's JSON: the status alone is reported.
    const gateway = ((): Promise<Response> => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))) as typeof fetch
    expect((await refreshFalUsage({ home: home(), key: 'k', fetchImpl: gateway, maxAgeMs: 1, now: NOW })).error)
      .toBe('fal.ai answered 502')
    // JSON without fal's error field reads the same way.
    const bare = ((): Promise<Response> => Promise.resolve(new Response('{"detail":"nope"}', {
      status: 500, headers: { 'content-type': 'application/json' },
    }))) as typeof fetch
    expect((await refreshFalUsage({ home: home(), key: 'k', fetchImpl: bare, maxAgeMs: 1, now: NOW })).error)
      .toBe('fal.ai answered 500')
  })

  it('reports a fetch that threw, whatever it threw', async () => {
    const offline = ((): Promise<Response> => Promise.reject(new Error('fetch failed'))) as typeof fetch
    expect(await refreshFalUsage({ home: home(), key: 'k', fetchImpl: offline, maxAgeMs: 1, now: NOW }))
      .toEqual({ error: 'fetch failed' })
    // A rejection that is not an Error still has to reach the pane as text.
    // The type-aware lint pass wants an Error here, which is the case under test.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    const odd = ((): Promise<Response> => Promise.reject('dns')) as typeof fetch
    expect((await refreshFalUsage({ home: home(), key: 'k', fetchImpl: odd, maxAgeMs: 1, now: NOW })).error).toBe('dns')
  })
})

describe('generationRows', () => {
  const local = {
    month: {
      fal: {
        'fal-ai/flux/dev': { count: 6, mediaType: 'image/png' },
        'fal-ai/whisper': { count: 2, mediaType: 'audio/mpeg' },
      },
      mediahub: { 'still-a': { count: 3, mediaType: 'image/png' } },
    },
    year: {},
  }
  const usage: FalUsageCache = {
    fetchedAt: new Date(NOW).toISOString(),
    year: 2026,
    months: {
      '2026-09': [
        { endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 6, cost: 0.52, currency: 'USD' },
        { endpoint: 'fal-ai/kling/video', unit: 'video', quantity: 1, cost: 1.4, currency: 'USD' },
      ],
      '2026-06': [{ endpoint: 'fal-ai/flux/dev', unit: 'image', quantity: 1, cost: 0.08, currency: 'USD' }],
    },
  }

  it('merges the local count with fal’s billed line, keeps an endpoint only fal reported, and sorts by cost then count', () => {
    const { rows, billed } = generationRows(local, usage, NOW)
    expect(rows).toEqual([
      { provider: 'fal', model: 'fal-ai/kling/video', count: 0, billed: { quantity: 1, unit: 'video', cost: 1.4, currency: 'USD' } },
      { provider: 'fal', model: 'fal-ai/flux/dev', mediaType: 'image/png', count: 6, billed: { quantity: 6, unit: 'image', cost: 0.52, currency: 'USD' } },
      // Unbilled rows follow, the busiest first; another backend is never billed by fal.
      { provider: 'mediahub', model: 'still-a', mediaType: 'image/png', count: 3 },
      { provider: 'fal', model: 'fal-ai/whisper', mediaType: 'audio/mpeg', count: 2 },
    ])
    expect(billed).toEqual({ month: { USD: 1.92 }, year: { USD: 2 } })
  })

  it('lists the local counts alone while fal has reported nothing', () => {
    const { rows, billed } = generationRows(local, undefined, NOW)
    expect(rows.every(row => row.billed === undefined)).toBe(true)
    expect(rows).toHaveLength(3)
    expect(billed).toBeUndefined()
    // A report that covers other months bills this one at nothing, not at a guess.
    const elsewhere = generationRows(local, { ...usage, months: { '2026-06': usage.months['2026-06']! } }, NOW)
    expect(elsewhere.billed).toEqual({ month: {}, year: { USD: 0.08 } })
  })

  it('holds nothing when nothing was generated and nothing was billed', () => {
    expect(generationRows(emptyGenerationPeriods(), undefined, NOW)).toEqual({ rows: [] })
  })
})

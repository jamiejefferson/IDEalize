/**
 * Generation spend for the Brains pane's Budget tab. Images, video and sound
 * run through fal, which bills per generated unit and reports what it billed
 * through its Platform API (`GET https://api.fal.ai/v1/models/usage`,
 * `Authorization: Key <key>`). Two folds meet here:
 *
 * - a local count of generations from `artefact/created` session events
 *   (`record.provenance.provider` and `.model` name the backend and the
 *   endpoint), per month and year to date, so the table lists what was made
 *   even before fal answers;
 * - fal's own usage rows — billed quantity, unit, currency and `cost_total`
 *   with discounts applied — read per endpoint per calendar month for the
 *   current year and cached at `<home>/service-catalogues/fal-usage.json`
 *   with the instant they were read, refreshed after the configured age.
 *
 * Nothing here prices a generation itself: a row fal has not reported stays
 * unpriced, and a failed read is reported as its error text.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// The `artefact/created` vocabulary, so a record's provenance reads as itself.
import type {} from '@idealize/artefacts'

/** The fal backend id, as `@idealize/services` registers it. */
export const FAL_PROVIDER = 'fal'

/** fal's usage report; `start`, `end`, `timeframe`, `expand` and `cursor` are query parameters. */
export const FAL_USAGE_URL = 'https://api.fal.ai/v1/models/usage'

/** Pages of usage followed through `next_cursor` before a read stops; a year of one account's rows fits in far fewer. */
const MAX_USAGE_PAGES = 24

const DIR = 'service-catalogues'
const FILE = 'fal-usage.json'

/** One backend endpoint's local count for a period. */
export interface GenerationCount {
  /** How many artefacts the endpoint produced. */
  count: number
  /** The media type of the artefacts, from the first one seen. */
  mediaType: string
}

/** Local counts per backend, then per endpoint (the artefact's `provenance.model`). */
export type PeriodGenerations = Record<string, Record<string, GenerationCount>>

/** The local fold: month-to-date and year-to-date counts with their per-endpoint detail. */
export interface GenerationPeriods {
  month: PeriodGenerations
  year: PeriodGenerations
}

/**
 * A fresh, empty fold target.
 * @returns empty month and year detail.
 */
export function emptyGenerationPeriods(): GenerationPeriods {
  return { month: {}, year: {} }
}

function addCount(into: PeriodGenerations, provider: string, model: string, mediaType: string): void {
  const byModel = into[provider] ??= {}
  const entry = byModel[model] ??= { count: 0, mediaType }
  entry.count += 1
}

/**
 * Fold one session log's committed artefacts into per-endpoint counts.
 * @param events - the session's events.
 * @param now - the instant that fixes the current month and year (ms).
 * @param into - the counts to add to; a fresh pair when omitted.
 * @returns the accumulated counts.
 */
export function foldGenerations(
  events: readonly SessionEvent[],
  now: number,
  into: GenerationPeriods = emptyGenerationPeriods(),
): GenerationPeriods {
  const at = new Date(now)
  const yearStart = Date.UTC(at.getUTCFullYear(), 0, 1)
  const monthStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)
  for (const event of events) {
    if (event.type !== 'artefact/created' || event.time < yearStart || event.time > now) continue
    // A stored log is a durable boundary: a record written before the
    // provenance fields existed carries none, whatever the current type says,
    // and it names no endpoint to count against.
    const { provenance, mediaType } = event.data.record as {
      mediaType?: string
      provenance?: { provider?: string; model?: string }
    }
    const provider = provenance?.provider
    const model = provenance?.model
    if (provider === undefined || model === undefined) continue
    const kind = mediaType ?? ''
    addCount(into.year, provider, model, kind)
    if (event.time >= monthStart) addCount(into.month, provider, model, kind)
  }
  return into
}

/** One billed line as fal reports it, folded per endpoint within one month. */
export interface FalBilledLine {
  endpoint: string
  /** fal's billing unit for the endpoint (`image`, `video`, a compute unit). */
  unit: string
  /** Billed quantity in `unit`. */
  quantity: number
  /** Amount charged after discounts, in `currency`. */
  cost: number
  /** ISO 4217 code. */
  currency: string
}

/** What the fal usage cache file holds: the current year's billed lines per calendar month. */
export interface FalUsageCache {
  /** ISO instant the report was read. */
  fetchedAt: string
  /** The calendar year the months belong to. */
  year: number
  /** Billed lines by `YYYY-MM`. */
  months: Record<string, FalBilledLine[]>
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** One usage line item, validated against fal's published item schema; the wire is a boundary. */
function lineFrom(raw: unknown): FalBilledLine | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  const quantity = finite(row.quantity)
  const cost = finite(row.cost_total)
  if (
    typeof row.endpoint_id !== 'string' || row.endpoint_id === '' || typeof row.unit !== 'string'
    || typeof row.currency !== 'string' || row.currency.length !== 3 || quantity === undefined || cost === undefined
  ) return undefined
  return { endpoint: row.endpoint_id, unit: row.unit, quantity, cost, currency: row.currency }
}

/** Add one line to a month, merging with an earlier line for the same endpoint, unit and currency. */
function addLine(lines: FalBilledLine[], line: FalBilledLine): void {
  const standing = lines.find(entry => entry.endpoint === line.endpoint && entry.unit === line.unit && entry.currency === line.currency)
  if (standing === undefined) {
    lines.push({ ...line })
    return
  }
  standing.quantity += line.quantity
  standing.cost += line.cost
}

/**
 * Read the billed lines out of one page of fal's `/models/usage` payload,
 * requested with `timeframe=month` and `expand=time_series`, into the cache's
 * per-month table. A bucket is filed under its UTC calendar month; a line
 * missing a required field is skipped rather than billed at zero.
 * @param payload - the parsed JSON body of one page.
 * @param into - the per-month table to add to.
 * @returns the `next_cursor` to follow, or undefined when the page was the last.
 */
export function falUsageLines(payload: unknown, into: Record<string, FalBilledLine[]>): string | undefined {
  const body = (payload ?? {}) as { time_series?: unknown; next_cursor?: unknown }
  if (Array.isArray(body.time_series)) {
    for (const bucket of body.time_series) {
      if (typeof bucket !== 'object' || bucket === null) continue
      const { bucket: at, results } = bucket as { bucket?: unknown; results?: unknown }
      const time = typeof at === 'string' ? Date.parse(at) : NaN
      if (!Number.isFinite(time) || !Array.isArray(results)) continue
      const stamp = new Date(time)
      const month = `${String(stamp.getUTCFullYear())}-${String(stamp.getUTCMonth() + 1).padStart(2, '0')}`
      const lines = into[month] ??= []
      for (const item of results) {
        const line = lineFrom(item)
        if (line !== undefined) addLine(lines, line)
      }
    }
  }
  return typeof body.next_cursor === 'string' && body.next_cursor !== '' ? body.next_cursor : undefined
}

/**
 * Read the last fal usage report this home fetched, for the given year only.
 * @param home - the harness home directory.
 * @param year - the calendar year the report must cover.
 * @returns the cache, or undefined when there is no readable one for that year.
 */
export function readFalUsageCache(home: string, year: number): FalUsageCache | undefined {
  let raw: string
  try {
    raw = readFileSync(join(home, DIR, FILE), 'utf8')
  } catch {
    // No cache: a first run, or a home that never held a fal key.
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; year?: unknown; months?: unknown }
    if (typeof parsed.fetchedAt !== 'string' || parsed.year !== year || typeof parsed.months !== 'object' || parsed.months === null) return undefined
    const months: Record<string, FalBilledLine[]> = {}
    for (const [month, rows] of Object.entries(parsed.months as Record<string, unknown>)) {
      if (!Array.isArray(rows)) continue
      const lines: FalBilledLine[] = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const { endpoint, unit, quantity, cost, currency } = row as Record<string, unknown>
        if (typeof endpoint !== 'string' || typeof unit !== 'string' || typeof currency !== 'string') continue
        const amount = finite(quantity)
        const charged = finite(cost)
        if (amount === undefined || charged === undefined) continue
        lines.push({ endpoint, unit, quantity: amount, cost: charged, currency })
      }
      months[month] = lines
    }
    return { fetchedAt: parsed.fetchedAt, year, months }
  } catch {
    // A truncated or hand-edited file reads as no cache; the next fetch replaces it.
    return undefined
  }
}

/**
 * Record the usage fal just reported.
 * @param home - the harness home directory.
 * @param cache - the report to write.
 * @returns the cache as written.
 */
export function writeFalUsageCache(home: string, cache: FalUsageCache): FalUsageCache {
  const dir = join(home, DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, FILE), `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  return cache
}

/** The message a refused fal response carries, per its error schema, else the status line. */
async function falErrorText(response: Response): Promise<string> {
  let message: string | undefined
  try {
    const body = await response.json() as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // A non-JSON refusal (a gateway page): the status alone has to do.
  }
  return `fal.ai answered ${String(response.status)}${message === undefined ? '' : `: ${message}`}`
}

/** The query for one page of this year's usage, bucketed by calendar month. */
function usageUrl(now: number, cursor: string | undefined): string {
  const at = new Date(now)
  const url = new URL(FAL_USAGE_URL)
  url.searchParams.set('start', `${String(at.getUTCFullYear())}-01-01`)
  url.searchParams.set('end', at.toISOString())
  url.searchParams.set('timeframe', 'month')
  url.searchParams.set('expand', 'time_series')
  if (cursor !== undefined) url.searchParams.set('cursor', cursor)
  return url.href
}

/**
 * This year's fal usage, read from fal when the cache is missing or older
 * than `maxAgeMs`, else from disk. A failed read keeps the cache it has and
 * reports the failure; a failed read with no cache reports the failure alone.
 * @param options.home - the harness home directory.
 * @param options.key - the stored fal API key.
 * @param options.fetchImpl - the fetch to use (tests inject one).
 * @param options.maxAgeMs - how old a cache may be before it is refreshed; 0 disables fetching.
 * @param options.now - the current instant (ms).
 * @returns the usage with its read time when one is known, and the error text when the read failed.
 */
export async function refreshFalUsage(options: {
  home: string
  key: string
  fetchImpl: typeof fetch
  maxAgeMs: number
  now: number
}): Promise<{ usage?: FalUsageCache; error?: string }> {
  const year = new Date(options.now).getUTCFullYear()
  const cached = readFalUsageCache(options.home, year)
  const keep = cached === undefined ? {} : { usage: cached }
  if (options.maxAgeMs <= 0) return keep
  if (cached !== undefined && options.now - Date.parse(cached.fetchedAt) < options.maxAgeMs) return keep
  const months: Record<string, FalBilledLine[]> = {}
  try {
    let cursor: string | undefined
    for (let page = 0; page < MAX_USAGE_PAGES; page += 1) {
      const response = await options.fetchImpl(usageUrl(options.now, cursor), {
        headers: { authorization: `Key ${options.key}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return { ...keep, error: await falErrorText(response) }
      cursor = falUsageLines(await response.json(), months)
      if (cursor === undefined) break
    }
  } catch (error) {
    // Offline, refused, or a body that is not JSON: the last report read stands.
    return { ...keep, error: error instanceof Error ? error.message : String(error) }
  }
  return { usage: writeFalUsageCache(options.home, { fetchedAt: new Date(options.now).toISOString(), year, months }) }
}

/**
 * One endpoint with generations this month, as the Budget tab's table lists
 * it: the local count, and what fal billed for it where fal reported it.
 */
export interface GenerationRow {
  provider: string
  /** The endpoint id (`fal-ai/flux/dev`). */
  model: string
  /** The artefacts' media type, from the local fold; absent for an endpoint only fal reported. */
  mediaType?: string
  /** Artefacts this app made this month; 0 for an endpoint only fal reported. */
  count: number
  /** What fal billed this month, with discounts applied. */
  billed?: { quantity: number; unit: string; cost: number; currency: string }
}

/** Billed totals per currency: fal may bill one account in one currency, so this is usually one entry. */
export type BilledTotals = Record<string, number>

function totalOf(lines: readonly FalBilledLine[]): BilledTotals {
  const totals: BilledTotals = {}
  for (const line of lines) totals[line.currency] = (totals[line.currency] ?? 0) + line.cost
  return totals
}

/** The `YYYY-MM` key of the month `now` falls in. */
function monthKey(now: number): string {
  const at = new Date(now)
  return `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * The Budget tab's generation rows for this month and the billed totals fal
 * reported, this month and year to date.
 * @param local - the local fold of committed artefacts.
 * @param usage - fal's cached report, when one is known.
 * @param now - the instant that fixes the current month (ms).
 * @returns rows by billed cost then count descending, and the per-currency totals fal reported.
 */
export function generationRows(
  local: GenerationPeriods,
  usage: FalUsageCache | undefined,
  now: number,
): { rows: GenerationRow[]; billed?: { month: BilledTotals; year: BilledTotals } } {
  const rows: GenerationRow[] = []
  const thisMonth = usage?.months[monthKey(now)] ?? []
  for (const [provider, byModel] of Object.entries(local.month)) {
    for (const [model, entry] of Object.entries(byModel)) {
      const line = provider === FAL_PROVIDER ? thisMonth.find(candidate => candidate.endpoint === model) : undefined
      rows.push({
        provider,
        model,
        mediaType: entry.mediaType,
        count: entry.count,
        ...line === undefined ? {} : { billed: { quantity: line.quantity, unit: line.unit, cost: line.cost, currency: line.currency } },
      })
    }
  }
  for (const line of thisMonth) {
    if (rows.some(row => row.provider === FAL_PROVIDER && row.model === line.endpoint)) continue
    rows.push({
      provider: FAL_PROVIDER,
      model: line.endpoint,
      count: 0,
      billed: { quantity: line.quantity, unit: line.unit, cost: line.cost, currency: line.currency },
    })
  }
  rows.sort((left, right) => (right.billed?.cost ?? 0) - (left.billed?.cost ?? 0) || right.count - left.count)
  if (usage === undefined) return { rows }
  return {
    rows,
    billed: { month: totalOf(thisMonth), year: totalOf(Object.values(usage.months).flat()) },
  }
}

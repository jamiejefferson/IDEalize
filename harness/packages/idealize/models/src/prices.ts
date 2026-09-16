/**
 * Where token prices come from, besides the person typing them. OpenRouter
 * publishes every model's price inside its `/api/v1/models` payload, so a
 * connected OpenRouter route prices its own usage; the prices are cached on
 * disk beside the media catalogues (`<home>/service-catalogues/openrouter-prices.json`)
 * with the instant they were read, and refreshed when the cache is older
 * than the configured age. The model catalogue the app ships (pi-ai's
 * provider data, read through `@idealize/services`) carries a published price
 * per catalogue model, which prices a metered route the person has not typed
 * a price for. Nothing here estimates: a model no source prices stays
 * unpriced, and the sources rank typed price, then OpenRouter's directory,
 * then the shipped catalogue.
 *
 * This module also validates the `POST /idealize/models/prices` body — the
 * one place a price enters the settings document from the pane.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TokenPrice, TokenPriceTable } from './pricing.ts'

/** The OpenRouter route id, as `llm-pi-ai` declares it. */
export const OPENROUTER_PROVIDER = 'openrouter'

/** OpenRouter's public model directory; each row carries its `pricing`. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Directory under the harness home shared with the media catalogues. */
const DIR = 'service-catalogues'
const FILE = 'openrouter-prices.json'

/**
 * Who supplied a price: the person, the public market directory the app
 * fetches, or the model catalogue it ships. The market's own name stays in
 * the payload beside the prices, so a surface can say which market without
 * naming a provider in its source (the mode/provider boundary, AC-03).
 */
export type PriceSource = 'user' | 'market' | 'catalogue'

/** A price with its origin, so the pane can say where a figure came from. */
export type PricedModel = TokenPrice & { source: PriceSource }

/** Prices with their origin, per provider then model. */
export type PricedTable = Record<string, Record<string, PricedModel>>

/** What the price cache file holds. */
export interface OpenRouterPriceCache {
  /** ISO instant the directory was read. */
  fetchedAt: string
  /** USD per million tokens, by OpenRouter model id. */
  prices: Record<string, TokenPrice>
}

/** A USD-per-token string as OpenRouter prints it, or a number, to a finite non-negative per-million figure. */
function perMillion(value: unknown): number | undefined {
  const perToken = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(perToken) || perToken < 0) return undefined
  // The published strings are per token to nine decimals; scaling leaves float
  // residue (2.4999999) that would print as a wrong price.
  return Math.round(perToken * 1e6 * 1e6) / 1e6
}

/**
 * Read the prices out of an OpenRouter `/api/v1/models` payload.
 *
 * `pricing.prompt` and `pricing.completion` are required for a row to count;
 * a row missing either, or printing a non-numeric string, is skipped rather
 * than priced at zero. `input_cache_read` and `input_cache_write` are absent
 * for models whose upstream provider offers no cache discount; such a model
 * bills a cached token at its prompt price, so that is what the absent field
 * resolves to — no discount is assumed.
 * @param payload - the parsed JSON body.
 * @returns USD per million tokens by model id; empty when the payload has no usable rows.
 */
export function openRouterPrices(payload: unknown): Record<string, TokenPrice> {
  const prices: Record<string, TokenPrice> = {}
  const rows = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) return prices
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const { id, pricing } = row as { id?: unknown; pricing?: unknown }
    if (typeof id !== 'string' || id === '' || typeof pricing !== 'object' || pricing === null) continue
    const fields = pricing as Record<string, unknown>
    const input = perMillion(fields.prompt)
    const output = perMillion(fields.completion)
    if (input === undefined || output === undefined) continue
    prices[id] = {
      input,
      output,
      cacheRead: perMillion(fields.input_cache_read) ?? input,
      cacheWrite: perMillion(fields.input_cache_write) ?? input,
    }
  }
  return prices
}

/** One cached price, validated: the file is a boundary, whoever wrote it. */
function priceFrom(raw: unknown): TokenPrice | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  const read = (key: keyof TokenPrice): number | undefined => {
    const value = row[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const input = read('input')
  const output = read('output')
  const cacheRead = read('cacheRead')
  const cacheWrite = read('cacheWrite')
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) return undefined
  return { input, output, cacheRead, cacheWrite }
}

/**
 * Read the last OpenRouter price list this home fetched.
 * @param home - the harness home directory.
 * @returns the cache, or undefined when there is no readable one.
 */
export function readOpenRouterPriceCache(home: string): OpenRouterPriceCache | undefined {
  let raw: string
  try {
    raw = readFileSync(join(home, DIR, FILE), 'utf8')
  } catch {
    // No cache: a first run, or a home that never had a connected OpenRouter route.
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; prices?: unknown }
    if (typeof parsed.fetchedAt !== 'string' || typeof parsed.prices !== 'object' || parsed.prices === null) return undefined
    const prices: Record<string, TokenPrice> = {}
    for (const [id, row] of Object.entries(parsed.prices as Record<string, unknown>)) {
      const price = priceFrom(row)
      if (price !== undefined) prices[id] = price
    }
    return { fetchedAt: parsed.fetchedAt, prices }
  } catch {
    // A truncated or hand-edited file reads as no cache; the next fetch replaces it.
    return undefined
  }
}

/**
 * Record the prices OpenRouter just published.
 * @param home - the harness home directory.
 * @param prices - the converted per-million prices.
 * @param fetchedAt - the instant they were read (ms).
 * @returns the cache as written.
 */
export function writeOpenRouterPriceCache(home: string, prices: Record<string, TokenPrice>, fetchedAt: number): OpenRouterPriceCache {
  const dir = join(home, DIR)
  mkdirSync(dir, { recursive: true })
  const body: OpenRouterPriceCache = { fetchedAt: new Date(fetchedAt).toISOString(), prices }
  writeFileSync(join(dir, FILE), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  return body
}

/**
 * The OpenRouter price list, refreshed from the directory when the cache is
 * missing or older than `maxAgeMs`, else read from disk. A failed fetch keeps
 * the cache it has; a failed fetch with no cache yields nothing, which prices
 * nothing.
 * @param options.home - the harness home directory.
 * @param options.fetchImpl - the fetch to use (tests inject one).
 * @param options.maxAgeMs - how old a cache may be before it is refreshed; 0 disables fetching.
 * @param options.now - the current instant (ms).
 * @returns the prices with their read time, or undefined.
 */
export async function refreshOpenRouterPrices(options: {
  home: string
  fetchImpl: typeof fetch
  maxAgeMs: number
  now: number
}): Promise<OpenRouterPriceCache | undefined> {
  const cached = readOpenRouterPriceCache(options.home)
  if (options.maxAgeMs <= 0) return cached
  if (cached !== undefined && options.now - Date.parse(cached.fetchedAt) < options.maxAgeMs) return cached
  try {
    const response = await options.fetchImpl(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return cached
    const prices = openRouterPrices(await response.json())
    if (Object.keys(prices).length === 0) return cached
    return writeOpenRouterPriceCache(options.home, prices, options.now)
  } catch {
    // Offline or refused: the last list read stands until the next request.
    return cached
  }
}

/**
 * The price table cost is computed from, lowest source first: the shipped
 * catalogue's prices per route, OpenRouter's published prices under its
 * route, then the person's own entries over both, each marked with its source.
 * @param user - the configured `tokenPrices`.
 * @param openRouter - the cached OpenRouter prices, when the route is connected and the currency is USD.
 * @param shipped - the catalogue prices per route, when the currency is USD; a route absent here has none.
 * @returns the merged, source-marked table.
 */
export function effectivePrices(
  user: TokenPriceTable,
  openRouter: Record<string, TokenPrice> | undefined,
  shipped: TokenPriceTable = {},
): PricedTable {
  const table: PricedTable = {}
  const lay = (provider: string, byModel: Record<string, TokenPrice>, source: PriceSource): void => {
    const target = table[provider] ??= {}
    for (const [model, price] of Object.entries(byModel)) target[model] = { ...price, source }
  }
  for (const [provider, byModel] of Object.entries(shipped)) lay(provider, byModel, 'catalogue')
  if (openRouter !== undefined) lay(OPENROUTER_PROVIDER, openRouter, 'market')
  for (const [provider, byModel] of Object.entries(user)) lay(provider, byModel, 'user')
  return table
}

/** A valid `POST /idealize/models/prices` body: a price to store, or `null` to clear one. */
export interface PriceWrite {
  provider: string
  model: string
  price: TokenPrice | null
}

/**
 * Validate a `POST /idealize/models/prices` body. Every price kind must be
 * present and a finite non-negative number: a missing kind is never read as
 * free.
 * @param body - the parsed JSON body.
 * @returns the write to apply, or the reason it is refused.
 */
export function parsePriceBody(body: unknown): { ok: true; write: PriceWrite } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be an object' }
  const { provider, model, price } = body as { provider?: unknown; model?: unknown; price?: unknown }
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
    return { ok: false, error: 'provider and model are required' }
  }
  if (price === null) return { ok: true, write: { provider, model, price: null } }
  const parsed = priceFrom(price)
  if (parsed === undefined) {
    return { ok: false, error: 'price must carry input, output, cacheRead and cacheWrite as non-negative numbers per million tokens' }
  }
  return { ok: true, write: { provider, model, price: parsed } }
}

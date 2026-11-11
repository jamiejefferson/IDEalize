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
 * A model a route's own live directory lists, in the fields a directory
 * states. The wire protocol, endpoint and compatibility switches are this
 * module's to fill in, per route.
 */
export interface LiveCatalogModel {
  id: string
  name: string
  /** Whether the model reads pictures as well as text. */
  vision: boolean
  reasoning: boolean
  contextWindow: number
  maxTokens: number
  /** USD per million tokens. */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

/**
 * How a live row becomes a catalog entry, per route. OpenRouter serves every
 * model over chat completions, and its directory is the only one read so far.
 */
const LIVE_SHAPE: Readonly<Record<string, (row: LiveCatalogModel) => Model<Api>>> = {
  openrouter: row => ({
    id: row.id, name: row.name, api: 'openai-completions', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1',
    reasoning: row.reasoning, input: row.vision ? ['text', 'image'] : ['text'], cost: row.cost,
    contextWindow: row.contextWindow, maxTokens: row.maxTokens,
    compat: { supportsDeveloperRole: false, thinkingFormat: 'openrouter' },
  }),
}

const live = new Map<string, readonly Model<Api>[]>()
const listed = new Map<string, ReadonlySet<string>>()
const liveListeners = new Set<() => void>()

/** Whether a live row can be served: a named id and whole, positive capacities. */
function serviceable(row: LiveCatalogModel): boolean {
  return row.id !== '' && Number.isInteger(row.contextWindow) && row.contextWindow > 0
    && Number.isInteger(row.maxTokens) && row.maxTokens > 0
}

/**
 * Record the models a route's live directory lists now. Models the installed
 * catalog and the addendum above lack join the route; an entry either already
 * holds always wins. A route with no live shape is ignored.
 * @param provider - provider route key.
 * @param rows - the directory's chat models.
 * @param listedIds - every model id the directory lists, chat or otherwise; a shipped model missing from it is retired.
 * @returns whether the recorded list changed.
 */
export function setLiveCatalog(provider: string, rows: readonly LiveCatalogModel[], listedIds?: readonly string[]): boolean {
  const shape = LIVE_SHAPE[provider]
  if (shape === undefined) return false
  const next = rows.filter(serviceable).map(shape)
  const nextListed = [...new Set(listedIds ?? [])].sort()
  const sameRows = JSON.stringify(next) === JSON.stringify(live.get(provider) ?? [])
  const sameListed = JSON.stringify(nextListed) === JSON.stringify([...listed.get(provider) ?? []])
  if (sameRows && sameListed) return false
  live.set(provider, next)
  listed.set(provider, new Set(nextListed))
  for (const listener of liveListeners) listener()
  return true
}

/**
 * The shipped models a route's live directory has stopped listing. A directory
 * that lists fewer than half the shipped models is read as a broken answer and
 * retires nothing, so a bad read cannot empty the picker.
 * @param provider - provider route key.
 * @param shipped - ids the installed catalog and the addendum describe for that route.
 * @returns the retired ids; empty when no directory has been read.
 */
export function retiredModels(provider: string, shipped: Iterable<string>): Set<string> {
  const ids = [...shipped]
  const now = listed.get(provider)
  if (now === undefined || now.size * 2 < ids.length) return new Set()
  return new Set(ids.filter(id => !now.has(id)))
}

/** The maker before the slash, or nothing for an id without one. */
function makerOf(id: string): string {
  const slash = id.indexOf('/')
  return slash === -1 ? '' : id.slice(0, slash)
}

/** Words that name a release stage and say nothing about which model it is. */
const STAGE_WORDS: ReadonlySet<string> = new Set(['preview', 'latest', 'exp', 'beta'])

/** An id's family words and version numbers: `claude-3.5-haiku` reads as claude + haiku and 3, 5. */
function idParts(id: string): { words: Set<string>; numbers: number[] } {
  const tokens = id.slice(id.indexOf('/') + 1).toLowerCase().match(/[a-z]+|\d+/gu) ?? []
  const words = new Set<string>()
  const numbers: number[] = []
  // A year or a longer number opens a release date, and a date is no part of the version: two dated builds of one
  // model are the same model.
  let dated = false
  for (const token of tokens) {
    if (/^[a-z]/u.test(token)) { if (!STAGE_WORDS.has(token)) words.add(token) }
    else if (token.length >= 4) dated = true
    else if (!dated) numbers.push(Number(token))
  }
  return { words, numbers }
}

/** Shared family words over all family words, 0 to 1. */
function familyOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const union = new Set([...a, ...b])
  if (union.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / union.size
}

/** A model's price for a million tokens each way; a router's placeholder price reads as nothing. */
function priceOf(model: Model<Api>): number {
  return Math.max(0, model.cost.input) + Math.max(0, model.cost.output)
}

/** How far apart two prices sit, as a ratio in log space; a free model beside a paid one is far. */
function priceGap(a: Model<Api>, b: Model<Api>): number {
  if (priceOf(a) === 0 && priceOf(b) === 0) return 0
  if (priceOf(a) === 0 || priceOf(b) === 0) return 10
  return Math.abs(Math.log(priceOf(a) / priceOf(b)))
}

/** Whether version `a` sits below version `b`, number by number. */
function olderThan(a: readonly number[], b: readonly number[]): boolean {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left < right
  }
  return false
}

/** The variant after the colon, such as `free` or `batch`: a different way of buying the same model. */
function variantOf(id: string): string {
  const colon = id.indexOf(':')
  return colon === -1 ? '' : id.slice(colon + 1)
}

/**
 * The live model closest to a retired one. A free model is only ever replaced
 * by a free one, so nobody starts paying because a model was withdrawn. After
 * that the tests run in the order a person would apply them: the same maker,
 * the same variant, a version no older than the retired one, a model that
 * still reads pictures and still reasons when the old one did, the same family
 * name, then the nearest price.
 * @param retired - the retired model as the app shipped it.
 * @param candidates - the models the route serves today.
 * @returns the closest live model, or nothing when the route serves none that fits.
 */
export function closestLiveModel(retired: Model<Api>, candidates: readonly Model<Api>[]): Model<Api> | undefined {
  const free = priceOf(retired) === 0
  const affordable = free ? candidates.filter(model => priceOf(model) === 0) : candidates
  const maker = makerOf(retired.id)
  const sameMaker = affordable.filter(model => makerOf(model.id) === maker)
  const pool = sameMaker.length > 0 ? sameMaker : affordable
  const mine = idParts(retired.id)
  const rank = (model: Model<Api>): number[] => {
    const theirs = idParts(model.id)
    const keepsSight = !retired.input.includes('image') || model.input.includes('image')
    const keepsReasoning = !retired.reasoning || model.reasoning
    return [
      // Every free model is bought the same way, whatever its id says after the colon.
      free || variantOf(model.id) === variantOf(retired.id) ? 0 : 1,
      // A model with no version in its id, such as a router, is never the older one.
      theirs.numbers.length > 0 && olderThan(theirs.numbers, mine.numbers) ? 1 : 0,
      keepsSight && keepsReasoning ? 0 : 1,
      -familyOverlap(mine.words, theirs.words),
      priceGap(retired, model),
    ]
  }
  let best: { model: Model<Api>; rank: number[] } | undefined
  for (const model of pool) {
    const ranked = rank(model)
    if (best === undefined || lower(ranked, best.rank)) best = { model, rank: ranked }
  }
  return best?.model
}

/** Whether rank `a` sorts before rank `b`; equal ranks keep the earlier model. */
function lower(a: readonly number[], b: readonly number[]): boolean {
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left < right
  }
  return false
}

/**
 * Hear when a route's live list changes, so resolved routes can be rebuilt.
 * @param listener - called after each change.
 * @returns a function that stops the listening.
 */
export function onLiveCatalogChange(listener: () => void): () => void {
  liveListeners.add(listener)
  return () => { liveListeners.delete(listener) }
}

/**
 * Addendum models for one route that the installed catalog does not already
 * describe: the entries above, then the route's live directory.
 * @param provider - provider route key.
 * @param installed - ids the installed catalog ships for that route.
 * @returns the missing models, addendum entries first.
 */
export function catalogAddendum(provider: string, installed: ReadonlySet<string>): Model<Api>[] {
  const seen = new Set(installed)
  const missing: Model<Api>[] = []
  for (const model of [...ADDENDUM[provider] ?? [], ...live.get(provider) ?? []]) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    missing.push(model)
  }
  return missing
}

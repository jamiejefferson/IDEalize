/**
 * The line under the composer that the heart and the dislike bring up (Paper
 * "Ratings and dislike" boards 01 and 02). One line per chat at a time: the
 * heart's "Rate X for [tag] ☆☆☆☆☆", or the dislike's offer to try two other
 * models. The router's loopback routes answer both; this module holds which
 * line each chat shows and the calls behind it.
 * @module @idealize/ui-bar/client/rating-line
 */

import { useSyncExternalStore } from 'react'

/** The kinds of model a line can be about. */
export type LineKind = 'chat' | 'image' | 'video' | 'audio'

/** One model as the router names it. */
export interface LineModel { provider: string; model: string; label: string }

/** What the heart's line rates: the model behind the chat's last answer. */
export interface RateTarget extends LineModel {
  kind: LineKind
  /** The kind of work the router read for that answer; the line opens on it. */
  tag: string
  /** Every tag the kind can be rated for. */
  tags: string[]
  /** The person's stars for this model, by tag. */
  stars: Record<string, number>
}

/** What both runs of an offer should cost. */
export type LinePrice = { amount: number } | { unknown: true }

/** The dislike's offer. */
export interface Offer {
  kind: LineKind
  tag: string
  first: LineModel
  alternatives: LineModel[]
  price: LinePrice
}

export type LineState =
  | { kind: 'loading'; from: 'heart' | 'dislike' }
  | { kind: 'rate'; target: RateTarget; tag: string; saved?: { stars: number | null; before: number | null } | undefined }
  | { kind: 'offer'; offer: Offer; starting?: boolean | undefined }
  | { kind: 'note'; from: 'heart' | 'dislike'; message: string }

const lines = new Map<string, LineState>()
const listeners = new Set<() => void>()

/**
 * Show or clear one chat's line.
 * @param sessionId - the chat.
 * @param state - the line, or undefined to clear it.
 */
export function setLine(sessionId: string, state: LineState | undefined): void {
  if (state === undefined) lines.delete(sessionId)
  else lines.set(sessionId, state)
  for (const listener of listeners) listener()
}

/**
 * The line one chat shows.
 * @param sessionId - the chat.
 */
export function lineOf(sessionId: string): LineState | undefined {
  return lines.get(sessionId)
}

/**
 * Subscribe a component to one chat's line.
 * @param sessionId - the chat.
 * @returns its line.
 */
export function useLine(sessionId: string): LineState | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    () => lines.get(sessionId),
  )
}

const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** A route's JSON, or its error sentence. */
async function call(path: string, body?: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
    const value: unknown = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string' ? value.error : undefined
      return { ok: false, error: error ?? `the router answered ${String(response.status)}` }
    }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const query = (sessionId: string): string => `?sessionId=${encodeURIComponent(sessionId)}`

/**
 * The heart: open the rating line, or close it when it is already open.
 * @param sessionId - the chat.
 * @param nothingYet - the note shown when the chat has no answer to rate.
 */
export async function openRating(sessionId: string, nothingYet: string): Promise<void> {
  const open = lines.get(sessionId)
  if (open?.kind === 'rate' || (open?.kind === 'note' && open.from === 'heart')) {
    setLine(sessionId, undefined)
    return
  }
  setLine(sessionId, { kind: 'loading', from: 'heart' })
  const answer = await call(`/idealize/router/rate-target${query(sessionId)}`)
  const target = answer.ok ? answer.value as RateTarget : undefined
  setLine(sessionId, target !== undefined
    ? { kind: 'rate', target, tag: target.tag }
    : { kind: 'note', from: 'heart', message: nothingYet })
}

/**
 * Set or clear the stars on the line's model for the line's tag.
 * @param sessionId - the chat.
 * @param stars - 1 to 5, or null to clear.
 */
export async function rateOnLine(sessionId: string, stars: number | null): Promise<void> {
  const line = lines.get(sessionId)
  if (line?.kind !== 'rate') return
  const { target, tag } = line
  const before = target.stars[tag] ?? null
  const answer = await call('/idealize/router/ratings', {
    kind: target.kind, provider: target.provider, model: target.model, tag, stars, label: target.label,
  })
  if (!answer.ok) return
  const next = Object.fromEntries(Object.entries(target.stars).filter(([one]) => one !== tag))
  if (stars !== null) next[tag] = stars
  // The line may have moved on while the write was out; only the line that asked shows it saved.
  if (lines.get(sessionId) === line) setLine(sessionId, { kind: 'rate', target: { ...target, stars: next }, tag, saved: { stars, before } })
}

/**
 * The dislike: ask the router for two models to try, or close the offer.
 * @param sessionId - the chat.
 * @param cannot - the note shown when nothing can be offered, given the router's reason.
 */
export async function openOffer(sessionId: string, cannot: (reason: string) => string): Promise<void> {
  const open = lines.get(sessionId)
  if (open?.kind === 'offer' || (open?.kind === 'note' && open.from === 'dislike')) {
    setLine(sessionId, undefined)
    return
  }
  setLine(sessionId, { kind: 'loading', from: 'dislike' })
  const answer = await call(`/idealize/router/offer${query(sessionId)}`)
  setLine(sessionId, answer.ok
    ? { kind: 'offer', offer: answer.value as Offer }
    : { kind: 'note', from: 'dislike', message: cannot(answer.error) })
}

/**
 * Accept the offer: the router runs the alternatives and the comparison card takes over.
 * @param sessionId - the chat.
 * @param failed - the note shown when the router refuses, given its reason.
 */
export async function acceptOffer(sessionId: string, failed: (reason: string) => string): Promise<void> {
  const line = lines.get(sessionId)
  if (line?.kind !== 'offer' || line.starting === true) return
  setLine(sessionId, { ...line, starting: true })
  const answer = await call('/idealize/router/compare', {
    sessionId, alternatives: line.offer.alternatives.map(({ provider, model }) => ({ provider, model })),
  })
  setLine(sessionId, answer.ok ? undefined : { kind: 'note', from: 'dislike', message: failed(answer.error) })
}

/**
 * Keep one alternative, or the first answer.
 * @param sessionId - the chat.
 * @param id - the comparison.
 * @param index - the alternative, or -1 for the first answer.
 * @returns the router's error sentence, or undefined.
 */
export async function pickAnswer(sessionId: string, id: string, index: number): Promise<string | undefined> {
  const answer = await call('/idealize/router/pick', { sessionId, id, index })
  return answer.ok ? undefined : answer.error
}

/**
 * The offer's price as the button says it.
 * @param price - the router's estimate.
 * @returns the locale key and its amount.
 */
export function priceKey(price: LinePrice): { key: 'line.offer.price.about' | 'line.offer.price.under' | 'line.offer.price.free' | 'line.offer.price.unknown'; amount?: string } {
  if ('unknown' in price) return { key: 'line.offer.price.unknown' }
  if (price.amount === 0) return { key: 'line.offer.price.free' }
  if (price.amount < 0.01) return { key: 'line.offer.price.under' }
  return { key: 'line.offer.price.about', amount: price.amount.toFixed(2) }
}

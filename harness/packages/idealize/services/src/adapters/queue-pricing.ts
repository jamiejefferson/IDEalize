/**
 * Queue-service prices, pure: build the batched `GET /models/pricing`
 * addresses, read one response page, and state each rate per typical output
 * so models priced in different units sort together.
 *
 * The response shape follows fal's Platform API documentation:
 * `{ prices: [{ endpoint_id, unit_price, unit, currency }], next_cursor, has_more }`.
 * @module @idealize/services/adapters/queue-pricing
 */

import type { GenArtefact, GenModelPrice } from '@idealize/generate'

/** How many endpoint ids one pricing request names. */
export const PRICING_BATCH = 50

/**
 * The pricing addresses for a list of endpoints, one per batch.
 * @param pricingUrl - the service's pricing endpoint.
 * @param ids - the endpoint ids to price.
 * @param batch - ids per request.
 * @returns one URL per batch, in id order.
 */
export function pricingUrls(pricingUrl: string, ids: readonly string[], batch = PRICING_BATCH): string[] {
  const urls: string[] = []
  for (let start = 0; start < ids.length; start += batch) {
    const url = new URL(pricingUrl)
    for (const id of ids.slice(start, start + batch)) url.searchParams.append('endpoint_id', id)
    urls.push(url.toString())
  }
  return urls
}

/** One endpoint's price as the service states it, before it is stated per output. */
export interface ListedPrice {
  unitPrice: number
  unit: string
  currency: string
}

/**
 * Read one pricing response page. Rows without an endpoint id, a finite
 * non-negative price or a unit are dropped; a missing currency reads as USD,
 * the only currency fal bills in.
 * @param body - the parsed response JSON (wire boundary: untrusted).
 * @returns prices by endpoint id.
 */
export function pricesFrom(body: unknown): Map<string, ListedPrice> {
  const prices = new Map<string, ListedPrice>()
  const rows = (body as { prices?: unknown } | null | undefined)?.prices
  if (!Array.isArray(rows)) return prices
  for (const row of rows) {
    const { endpoint_id: id, unit_price: unitPrice, unit, currency } = (row ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || id === '') continue
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) continue
    if (typeof unit !== 'string' || unit.trim() === '') continue
    prices.set(id, {
      unitPrice,
      unit: unit.trim(),
      currency: typeof currency === 'string' && currency.trim() !== '' ? currency.trim().toUpperCase() : 'USD',
    })
  }
  return prices
}

/** The unit with case, plural and fal's "processed" qualifier folded away. */
function foldedUnit(unit: string): string {
  return unit.toLowerCase().replace(/^processed\s+/, '').replace(/s$/, '').trim()
}

/**
 * A listed price, with its cost per typical output where the unit allows:
 * an image unit is per image, a megapixel unit is one 1-megapixel image, a
 * second of video is a fifth of a 5-second clip, and a second or minute of
 * audio is stated per minute. Any other unit (`units`, tokens, compute
 * seconds) states no per-output figure, because none can be read from it.
 * @param listed - the price as the service lists it.
 * @param artefact - what the model makes.
 * @returns the seam's price.
 */
export function modelPrice(listed: ListedPrice, artefact: GenArtefact): GenModelPrice {
  const unit = foldedUnit(listed.unit)
  const per = (amount: number, output: NonNullable<GenModelPrice['perOutput']>['output']): GenModelPrice => ({
    ...listed, perOutput: { amount: Math.round(amount * 1e6) / 1e6, output },
  })
  if (artefact === 'image' && unit === 'image') return per(listed.unitPrice, 'image')
  if (artefact === 'image' && (unit === 'megapixel' || unit === 'mp')) return per(listed.unitPrice, '1 MP image')
  if (artefact === 'video' && unit === 'second') return per(listed.unitPrice * 5, '5 s clip')
  if (artefact === 'audio' && unit === 'second') return per(listed.unitPrice * 60, 'minute of audio')
  if (artefact === 'audio' && unit === 'minute') return per(listed.unitPrice, 'minute of audio')
  return { ...listed }
}

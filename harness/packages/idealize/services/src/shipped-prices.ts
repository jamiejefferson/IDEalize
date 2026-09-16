/**
 * Token prices the app ships with its model catalogue. pi-ai's provider data
 * carries a `cost` per catalogue model (USD per million tokens for input,
 * output, cache read and cache write), published by the library at packaging
 * time. This module reads that table for one chat route so the Budget tab can
 * price a metered model nobody has typed a price for and OpenRouter does not
 * list. Two costs mean "no figure" rather than a rate: every component zero
 * (a hand-declared model, a free tier), and a negative component, which pi-ai
 * writes for a router whose price depends on the model it picks
 * (`openrouter/auto` carries -1000000). Both read here as no price.
 * @module @idealize/services/shipped-prices
 */

import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'

/** One model's token prices in USD per million tokens, every kind explicit. */
export interface ShippedTokenPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** The currency pi-ai publishes every catalogue cost in. */
export const SHIPPED_PRICE_CURRENCY = 'USD'

/**
 * The catalogue prices for one chat route's models.
 *
 * Tiered prices (a higher rate above a token threshold) contribute their base
 * rate only; the tier is not applied. A model priced at zero throughout, or
 * carrying a negative component, is left out.
 * @param provider - the chat route id, as `llm-pi-ai` names it.
 * @returns prices by model id; undefined for a route the catalogue does not ship or prices nowhere.
 */
export function shippedTokenPrices(provider: string): Record<string, ShippedTokenPrice> | undefined {
  if (!(getBuiltinProviders() as readonly string[]).includes(provider)) return undefined
  const prices: Record<string, ShippedTokenPrice> = {}
  for (const model of getBuiltinModels(provider as BuiltinProvider)) {
    const { input, output, cacheRead, cacheWrite } = model.cost
    const parts = [input, output, cacheRead, cacheWrite]
    if (parts.some(part => !Number.isFinite(part) || part < 0)) continue
    if (parts.every(part => part === 0)) continue
    prices[model.id] = { input, output, cacheRead, cacheWrite }
  }
  return Object.keys(prices).length === 0 ? undefined : prices
}

/**
 * The models a chat could be moved to: every model of a connected route,
 * with what the app holds about each (price, image input, a display name).
 * Context size is read later and only for the models a decision turns on,
 * because resolving it costs one adapter call per model.
 */

import type { Candidate, Price } from './decide.ts'

export const FREE_PROVIDER = 'freetokens'

/** How a route is paid for, as the Brains pane already tells them apart. */
export type RouteAuth = 'free' | 'oauth' | 'apiKey'

export interface ConnectedRoute {
  provider: string
  auth: RouteAuth
  models: ReadonlyArray<{ id: string; name?: string | undefined; inputModalities?: readonly string[] | undefined }>
}

/** Per provider then model, USD per million tokens. */
export type PriceTable = Readonly<Record<string, Readonly<Record<string, { input: number; output: number }>>>>

/**
 * What one more token costs the user on a route. A signed-in subscription is
 * already paid for, so a turn on it costs nothing more and it reads as free;
 * the free-tokens engine is free by design; a keyed route costs its listed
 * price, and an unlisted one is unknown.
 */
function priceOf(route: ConnectedRoute, model: string, prices: PriceTable): Price {
  if (route.auth !== 'apiKey') return 'free'
  const listed = prices[route.provider]?.[model]
  if (listed === undefined) return undefined
  return listed.input === 0 && listed.output === 0 ? 'free' : { input: listed.input, output: listed.output }
}

/**
 * The candidate list.
 * @param routes - the connected routes and their models.
 * @param prices - the effective price table.
 * @returns one candidate per model; the free-tokens route is a single candidate, because its engine chooses the provider per call.
 */
export function candidatesFrom(routes: readonly ConnectedRoute[], prices: PriceTable): Candidate[] {
  const candidates: Candidate[] = []
  for (const route of routes) {
    if (route.provider === FREE_PROVIDER) {
      const first = route.models[0]
      if (first !== undefined) candidates.push({ provider: FREE_PROVIDER, model: first.id, label: 'Free tokens', price: 'free', images: false })
      continue
    }
    for (const model of route.models) {
      candidates.push({
        provider: route.provider,
        model: model.id,
        label: model.name === undefined || model.name === '' ? model.id : model.name,
        price: priceOf(route, model.id, prices),
        // An absent list is unknown; a list without `image` is a stated no.
        ...model.inputModalities === undefined ? {} : { images: model.inputModalities.includes('image') },
      })
    }
  }
  return candidates
}

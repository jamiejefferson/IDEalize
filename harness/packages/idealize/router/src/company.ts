/**
 * The company behind a model, and the two limits a person sets on where the
 * router may move a chat: inside the company of the chat's own model, and
 * among the models they left ticked (JJ, 24 Nov 2026: a chat runs on one
 * company's models). Pure.
 */

import { routeKey } from './refused.ts'

/** Every route a key gateway adds starts with this, as `@idealize/services` names them. */
const GATEWAY_PREFIX = 'gateway-'

/**
 * Routes run by the same company under another name, in the spelling OpenRouter's model
 * ids use for that maker, so a direct route and OpenRouter's copy count as one company.
 */
const COMPANY_OF_ROUTE: Readonly<Record<string, string>> = {
  'deepseek-official': 'deepseek',
  'google-vertex': 'google',
  'kimi-coding': 'moonshotai',
  'minimax-cn': 'minimax',
  'mistral': 'mistralai',
  'moonshotai-cn': 'moonshotai',
  'openai-codex': 'openai',
  'qwen-token-plan': 'qwen',
  'qwen-token-plan-cn': 'qwen',
  'qwen-token-plan-individual': 'qwen',
  'xai': 'x-ai',
  'xiaomi-token-plan-ams': 'xiaomi',
  'xiaomi-token-plan-cn': 'xiaomi',
  'xiaomi-token-plan-sgp': 'xiaomi',
  'zai': 'z-ai',
  'zai-coding-cn': 'z-ai',
}

/** The route a key gateway's route fronts; any other route is itself. */
const fronted = (provider: string): string =>
  provider.startsWith(GATEWAY_PREFIX) ? provider.slice(GATEWAY_PREFIX.length) : provider

/**
 * The company that receives what a route is sent. OpenRouter's model ids name their maker
 * (`~anthropic/claude-haiku-latest`), a key gateway's route reaches the company of the route
 * it fronts, and any other route answers for itself. The free-tokens engine picks a provider
 * per call, so it is a company of its own.
 * @param provider - the route's id.
 * @param model - the model's id on that route.
 * @returns the company's name, in the spelling OpenRouter uses for it.
 */
export function companyOf(provider: string, model: string): string {
  const route = fronted(provider)
  if (route === 'openrouter') {
    const maker = model.replace(/^~/u, '').split('/')[0]
    return maker === undefined || maker === '' ? route : maker
  }
  return COMPANY_OF_ROUTE[route] ?? route
}

/** A model by its route. */
interface Routed { provider: string; model: string }

const same = (a: Routed, b: Routed): boolean => a.provider === b.provider && a.model === b.model

/**
 * Whether a person unticked this model. A model reached through a key gateway follows the
 * tick of the route the gateway fronts, because the list shows one row for both.
 * @param model - the model asked about.
 * @param excluded - the unticked `provider/model` keys.
 * @returns true when the router must leave it alone.
 */
export function isExcluded(model: Routed, excluded: readonly string[]): boolean {
  return excluded.includes(routeKey(model)) || excluded.includes(routeKey({ provider: fronted(model.provider), model: model.model }))
}

/** What limits a routed move. */
export interface MoveLimits {
  /** On: only models of the company of the chat's own model. */
  sameCompany: boolean
  /** The `provider/model` keys the person unticked. */
  excluded: readonly string[]
}

/**
 * The models a routed turn may consider.
 * @param candidates - every connected model.
 * @param own - the chat's own model, whose company sets the limit.
 * @param limits - the person's two limits.
 * @param keep - models the chat is on now, which stay in the list so they keep their name and price.
 * @returns the candidates inside the limits, in their order.
 */
export function withinLimits<T extends Routed>(
  candidates: readonly T[], own: Routed, limits: MoveLimits, keep: readonly Routed[] = [],
): T[] {
  const company = companyOf(own.provider, own.model)
  return candidates.filter((candidate) => {
    if (same(candidate, own) || keep.some(model => same(candidate, model))) return true
    if (limits.sameCompany && companyOf(candidate.provider, candidate.model) !== company) return false
    return !isExcluded(candidate, limits.excluded)
  })
}

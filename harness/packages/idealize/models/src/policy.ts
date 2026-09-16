/**
 * The auto-selection policy: a pure decision over the preference weights and
 * the live facts. The dominant weight orders the tiers — cost or speed puts
 * free tokens first (the engine's own `auto` router already picks the
 * cheapest-then-fastest healthy free route per call), intelligence puts the
 * ChatGPT subscription first. The first tier whose facts say "usable" wins.
 * Paid keyed routes join in a later drop; today the policy never routes to a
 * provider it cannot verify credentials for.
 */

export interface PolicyWeights {
  cost: number
  speed: number
  intelligence: number
}

/** What the policy knows about the free-tokens route and its engine. */
export interface FreetokensFacts {
  /** Models on the registered freetokens route; 0 = no route. */
  routeModels: number
  /** Whether anything answers at the engine origin right now. */
  engineUp: boolean
  /**
   * Enabled + healthy upstream provider keys in the engine; undefined when
   * unknowable (an adopted engine this host did not provision).
   */
  usableKeys: number | undefined
}

/** Everything the auto policy decides from. */
export interface PolicyFacts {
  freetokens: FreetokensFacts
  /** OAuth provider ids with stored credentials (e.g. openai-codex). */
  signedIn: string[]
  /** Live model ids per provider, from the directory. */
  models: Record<string, string[]>
}

/** The policy's answer: a model to select, or none, with the reason the models page shows. */
export interface PolicyDecision {
  /** Absent when nothing usable is available. */
  choice?: { provider: string; model: string }
  reason: string
}

const SUBSCRIPTION_PROVIDER = 'openai-codex'

type Dominant = 'cost' | 'speed' | 'intelligence'

/**
 * The heaviest weight; ties resolve towards cost — free-first is the product promise.
 * @param weights - the three relative preference weights.
 * @returns the dominant axis.
 */
export function dominantWeight(weights: PolicyWeights): Dominant {
  if (weights.cost >= weights.speed && weights.cost >= weights.intelligence) return 'cost'
  if (weights.intelligence >= weights.speed) return 'intelligence'
  return 'speed'
}

function freeUsable(facts: FreetokensFacts): boolean {
  return facts.routeModels > 0 && facts.engineUp
    && (facts.usableKeys === undefined || facts.usableKeys > 0)
}

/** Why the free tier is out, for the reason string. */
function freeBlocker(facts: FreetokensFacts): string {
  if (facts.routeModels === 0) return 'no free-tokens route is registered'
  if (!facts.engineUp) return 'the free-tokens engine is not running'
  return 'the free-tokens engine has no usable provider key'
}

/**
 * The subscription flagships, newest first. The route's model ids carry no
 * ordering of their own (`gpt-6-astra` sorts below `gpt-5.6-terra`), so the
 * intelligence tier reads this list rather than guessing from the id; a route
 * carrying none of them falls back to its first non-mini id (JJ, 8 Sep 2026:
 * "update the auto policy to prefer gpt-6-astra").
 */
const FLAGSHIPS = ['gpt-6-astra', 'gpt-5.5'] as const

/**
 * Pick the subscription model. The flagship carries intelligence; when speed
 * leads the weights a `-mini` variant of it is preferred if one exists.
 * @param models - the live model ids on the subscription provider.
 * @param dominant - the dominant preference axis.
 * @returns the chosen model id, or undefined when the list is empty.
 */
export function subscriptionModel(models: string[], dominant: Dominant): string | undefined {
  if (models.length === 0) return undefined
  const flagship = FLAGSHIPS.find(id => models.includes(id))
    ?? models.find(id => !id.includes('-mini')) ?? models[0]
  if (dominant === 'speed') {
    const mini = models.find(id => id === `${flagship}-mini`) ?? models.find(id => id.includes('-mini'))
    if (mini !== undefined) return mini
  }
  return flagship
}

/**
 * Decide the auto model: free when the engine is usable and cost leads, the
 * subscription when signed in and intelligence or speed leads, otherwise
 * whichever is available.
 * @param weights - the preference weights.
 * @param facts - the current route, sign-in, and directory facts.
 * @returns the decision with its reason; `choice` is absent when neither route is usable.
 */
export function choose(weights: PolicyWeights, facts: PolicyFacts): PolicyDecision {
  const dominant = dominantWeight(weights)
  const free = freeUsable(facts.freetokens)
  const subModel = facts.signedIn.includes(SUBSCRIPTION_PROVIDER)
    ? subscriptionModel(facts.models[SUBSCRIPTION_PROVIDER] ?? [], dominant)
    : undefined

  const freeChoice = (lead: string): PolicyDecision => ({
    choice: { provider: 'freetokens', model: 'auto' },
    reason: `${lead}; the free-tokens engine routes each call to the best healthy free provider${
      facts.freetokens.usableKeys === undefined ? '' : ` (${facts.freetokens.usableKeys} usable key${facts.freetokens.usableKeys === 1 ? '' : 's'})`}`,
  })
  const subChoice = (lead: string): PolicyDecision => ({
    choice: { provider: SUBSCRIPTION_PROVIDER, model: subModel as string },
    reason: `${lead}; your ChatGPT subscription serves ${subModel as string}`,
  })

  if (dominant === 'intelligence') {
    if (subModel !== undefined) return subChoice('intelligence leads your weights')
    if (free) return freeChoice('intelligence leads your weights but no subscription is signed in')
  } else {
    const lead = dominant === 'cost' ? 'cost leads your weights' : 'speed leads your weights'
    if (free) return freeChoice(lead)
    if (subModel !== undefined) return subChoice(freeBlocker(facts.freetokens))
  }

  return {
    reason: `no route is usable: ${freeBlocker(facts.freetokens)} and no subscription is signed in`,
  }
}

/**
 * The router stepping in. A chat's model can stop being able to answer in the
 * middle of a turn: its sign-in lapsed, its key went, its credit ran out, or the
 * provider stayed busy through the host's retries. Left alone the turn fails on
 * screen, so the router hands it to the best other connected model, a free one
 * first and a paid one when nothing free can answer (JJ, 4 Nov 2026: a working
 * key must answer). A model that would cut the chat's context is only offered,
 * and so is one at another company: a chat can hold client work under NDA, so its
 * history moves to a new company only when the person says so (JJ, 4 Nov 2026).
 * Pure, like the routing decision: the host supplies the candidates and the
 * model facts.
 */

import { losesContext, score, viaGateway } from './decide.ts'
import type { Candidate, Scored, Weights } from './decide.ts'
import type { Standing } from './ratings.ts'
import type { ScoreRow } from './score-table.ts'
import type { TaskReading } from './tasks.ts'

/** The route id of the free-tokens engine. */
const FREE_PROVIDER = 'freetokens'

/** The name the free-tokens route goes by. */
export const FREE_LABEL = 'Free tokens'

/** No turn tries more than this many stand-ins, so a broken network is not walked through the whole catalogue. */
export const MAX_STAND_INS = 3

/** How each failure the router answers reads in the chat. A code not listed here is not the model's fault to route around. */
const CANNOT_ANSWER: Readonly<Record<string, string>> = {
  MISSING_CREDENTIAL: 'has no key or sign-in',
  NO_ADAPTER: 'has no key or sign-in',
  INVALID_CREDENTIAL: 'refused the saved key or sign-in',
  AUTH: 'refused the saved key or sign-in',
  QUOTA: 'has run out of credit',
  RATE_LIMIT: 'stayed busy through its retries',
  SERVER: 'kept returning server errors',
  UNSUPPORTED_CONTENT: "can't see the pictures in this chat",
}

/**
 * The failures that rule out every model on the route: the first four are about
 * the account. The last two reach here only from a stand-in: one says the route will
 * not take this chat's history, which its other models would refuse just the same,
 * and the other that the route's address did not answer, whichever model was asked.
 */
const ROUTE_WIDE = new Set(['MISSING_CREDENTIAL', 'NO_ADAPTER', 'INVALID_CREDENTIAL', 'AUTH', 'QUOTA', 'INVALID_REQUEST', 'TRANSPORT'])

/**
 * Whether a failure is one the router steps in for. A dropped connection and a
 * timeout are left out: they usually mean the person's own network, which no
 * other model would cure.
 * @param code - the failure's code.
 * @returns true when another model could answer where this one cannot.
 */
export const canStepIn = (code: string): boolean => Object.hasOwn(CANNOT_ANSWER, code)

export interface StepInInput {
  /** The model that just failed the turn. */
  failed: { provider: string; model: string }
  /** The failure's code. */
  code: string
  /** Every model this turn has already failed on. */
  tried: ReadonlyArray<{ provider: string; model: string }>
  candidates: readonly Candidate[]
  reading: Pick<TaskReading, 'task' | 'difficulty'>
  weights: Weights
  /** Free models go first; a paid one takes the turn only when no free one can. */
  preferFree: boolean
  /** Tokens the chat holds; a candidate with a smaller window would lose some. */
  contextTokens?: number | undefined
  /** The chat holds images, so a stand-in must take them. */
  hasImages: boolean
  /** No model has answered in this chat yet, so it holds no history for a company to receive. */
  nothingSent?: boolean | undefined
  /** The choice is only ever offered, so the best model at any company is the one to name. */
  offerOnly?: boolean | undefined
  table?: readonly ScoreRow[] | undefined
  standingOf?: ((candidate: Candidate) => Standing) | undefined
}

export type StepIn =
  /** This model takes the turn. */
  | { kind: 'use'; to: Scored }
  /** The turn fails as it would have, and this model waits for the person to accept it. */
  | { kind: 'offer'; to: Scored; reason: 'loses-context' | 'other-company' }
  /** Nothing else can answer. */
  | { kind: 'none' }

const same = (a: { provider: string; model: string }, b: { provider: string; model: string }): boolean =>
  a.provider === b.provider && a.model === b.model

/**
 * OpenRouter's `:free` models share one pool across everyone, so they are often
 * rate-limited and many take no tools. A rescue has to land, so it never rests on one.
 */
const isSharedPool = (candidate: Candidate): boolean => candidate.provider === 'openrouter' && candidate.model.endsWith(':free')

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

/**
 * The company that receives what a route is sent. OpenRouter's model ids name their maker
 * (`~anthropic/claude-haiku-latest`), and any other route answers for itself.
 */
const companyOf = (route: { provider: string; model: string }): string => {
  // A key gateway's route reaches the same company as the route it fronts.
  const provider = route.provider.startsWith('gateway-') ? route.provider.slice('gateway-'.length) : route.provider
  if (provider === 'openrouter') return route.model.replace(/^~/u, '').split('/')[0] ?? provider
  return COMPANY_OF_ROUTE[provider] ?? provider
}

/**
 * Whether a chat may move to this model with nobody asked. An empty free engine never
 * received the chat, so anything may follow it, and so may a first message on a route with
 * no account behind it, which the person's connected account then answers. Otherwise the
 * model has to share an account or a company with a model the chat has already been sent to.
 */
const movesFreely = (input: StepInInput, candidate: Candidate): boolean => {
  if (input.offerOnly === true) return true
  if (input.failed.provider === FREE_PROVIDER && input.code === 'MISSING_CREDENTIAL') return true
  if (input.nothingSent === true && (input.code === 'MISSING_CREDENTIAL' || input.code === 'NO_ADAPTER')) return true
  return [input.failed, ...input.tried].some(model =>
    model.provider === candidate.provider || companyOf(model) === companyOf(candidate))
}

/**
 * Choose who takes the turn.
 * @param input - the failure, the models and the settings.
 * @param contextWindow - the model's context size, when the adapter knows it; read only for models the choice can land on.
 * @returns the stand-in, an offer, or nothing.
 */
export async function chooseStandIn(
  input: StepInInput, contextWindow: (candidate: Candidate) => Promise<number | undefined>,
): Promise<StepIn> {
  const ranked = input.candidates
    .filter(candidate => !isSharedPool(candidate))
    .filter(candidate => !(ROUTE_WIDE.has(input.code) && candidate.provider === input.failed.provider))
    .filter(candidate => !same(candidate, input.failed) && !input.tried.some(model => same(candidate, model)))
    .filter(candidate => !input.hasImages || candidate.images !== false)
    .map(candidate => ({ candidate, rated: input.standingOf?.(candidate) }))
    // One star bars a model from this kind of work, even now.
    .filter(({ rated }) => rated?.barred !== true)
    .map(({ candidate, rated }) => score(candidate, input.reading, input.weights, input.table, rated))
    // Catalogues list models that write no chat (embeddings, image models); only the scored ones are known to.
    .filter(candidate => candidate.known)
    .sort((a, b) => b.total - a.total)

  const byPrice = input.preferFree
    ? [...ranked.filter(candidate => candidate.price === 'free'), ...ranked.filter(candidate => candidate.price !== 'free')]
    : ranked
  // A connected key gateway goes first, as it does for a routed turn: the organisation pays, and its key is the
  // one known to work. A sign-in's catalogue lists models the account cannot run, and a rescue walked three of
  // those while the gateway stood ready (11 Nov 2026).
  const order = [...byPrice.filter(viaGateway), ...byPrice.filter(candidate => !viaGateway(candidate))]
  let tooSmall: Scored | undefined
  let elsewhere: Scored | undefined
  for (const candidate of order) {
    const size = input.contextTokens === undefined ? undefined : await contextWindow(candidate).catch(() => undefined)
    if (losesContext({ ...candidate, contextWindow: size }, input.contextTokens)) {
      tooSmall ??= candidate
      continue
    }
    if (movesFreely(input, candidate)) return { kind: 'use', to: candidate }
    elsewhere ??= candidate
  }
  if (elsewhere !== undefined) return { kind: 'offer', to: elsewhere, reason: 'other-company' }
  if (tooSmall !== undefined) return { kind: 'offer', to: tooSmall, reason: 'loses-context' }
  return { kind: 'none' }
}

/**
 * The sentence the chat shows. Written from the facts, never from a model.
 * @param failedLabel - the name of the model that failed.
 * @param code - the failure's code.
 * @param choice - what the router did about it.
 * @returns one or two sentences.
 */
export function stepInRationale(failedLabel: string, code: string, choice: Exclude<StepIn, { kind: 'none' }>): string {
  // The free tier takes no key of the person's own: its engine holds none to send.
  const empty = failedLabel === FREE_LABEL && code === 'MISSING_CREDENTIAL'
  const cause = `${failedLabel} ${empty ? 'has no keys' : CANNOT_ANSWER[code] ?? 'could not answer'}`
  if (choice.kind !== 'use') return `${cause}.`
  // The organisation behind a gateway pays for its models, so the person is told where the turn went.
  const note = viaGateway(choice.to)
    ? ' It runs through your organisation\'s key gateway.'
    : typeof choice.to.price === 'object' ? ` ${choice.to.label} is a paid model.` : ''
  return `${cause}, so ${choice.to.label} took the turn.${note}`
}

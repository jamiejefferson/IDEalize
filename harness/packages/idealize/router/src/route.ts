/**
 * One turn, routed: read the message (Jev first, the local rules when Jev
 * cannot answer), decide, and say what the chat should record. Everything the
 * host supplies arrives as an argument, so the whole path runs in a test.
 */

import { decide, PRESETS } from './decide.ts'
import type { Aggressiveness, Candidate, Decision, Weights } from './decide.ts'
import type { JevFailure, JevResult } from './jev.ts'
import { currentModel } from './projection.ts'
import type { RoutedModel, RouterEventData } from './projection-types.ts'
import type { ScoreRow } from './score-table.ts'
import { readLocally } from './tasks.ts'
import type { TaskReading } from './tasks.ts'

export interface TurnInput {
  /** What the request would run on without the router. */
  resolved: { provider: string; model: string }
  /** The earlier switch that still holds. */
  routed?: RouterEventData | undefined
  lastSwitchAt?: string | undefined
  message: string
  hasImages: boolean
  brain?: { id: string; instructions?: string | undefined } | undefined
  contextTokens?: number | undefined
  candidates: Candidate[]
  weights: Weights
  aggressiveness: Aggressiveness
  preferFree: boolean
  table?: readonly ScoreRow[] | undefined
  now: Date
}

export interface TurnDeps {
  /** Ask Jev; undefined when Jev is switched off. Never throws. */
  askJev?: ((message: string, brain: TurnInput['brain']) => Promise<JevResult>) | undefined
  /** The model's context size, when the adapter knows it. */
  contextWindow(candidate: Candidate): Promise<number | undefined>
}

export interface TurnResult {
  use: { provider: string; model: string }
  /** The chat's model before this turn was routed. */
  from: Candidate
  decision: Decision
  reading: TaskReading
  jev?: JevResult | undefined
  jevFailure?: JevFailure | undefined
  /** What the chat's log should record, when the turn switched, made an offer, or dropped an earlier switch. */
  events: RouterEventData[]
}

const same = (a: { provider: string; model: string }, b: { provider: string; model: string }): boolean =>
  a.provider === b.provider && a.model === b.model

const named = (model: Candidate): RoutedModel => ({ provider: model.provider, model: model.model, label: model.label })

/** How many of the best-scoring models have their context size read before the decision is final. */
const WINDOWS_READ = 3

/**
 * Route one turn.
 * @param input - the chat's state, the message and the settings.
 * @param deps - Jev and the adapter's model facts.
 * @returns the model to run on and what to record.
 */
export async function routeTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const { current, dropped } = currentModel(input.resolved, input.routed)
  const from = input.candidates.find(candidate => same(candidate, current))
    ?? { provider: current.provider, model: current.model, label: current.model, price: undefined }
  const events: RouterEventData[] = []
  const at = input.now.toISOString()
  if (dropped && input.routed !== undefined) {
    events.push({ outcome: 'reset', at, from: input.routed.to, to: named(from) })
  }

  const jev = deps.askJev === undefined ? undefined : await deps.askJev(input.message, input.brain)
  const reading = jev?.reading ?? readLocally(input.message, input.brain?.id)

  const lastSwitch = dropped ? at : input.lastSwitchAt
  const sinceLastSwitch = lastSwitch === undefined ? undefined : Math.max(0, (input.now.getTime() - Date.parse(lastSwitch)) / 1000)
  const situation = {
    current: from, candidates: input.candidates, reading, weights: input.weights, gates: PRESETS[input.aggressiveness],
    sinceLastSwitch, preferFree: input.preferFree, contextTokens: input.contextTokens, hasImages: input.hasImages,
    ...input.table === undefined ? {} : { table: input.table },
  }
  let decision = decide(situation)
  // A turn never waits on the router past Jev's limit, and never moves on a guess: when Jev was asked and gave
  // no reading (no key, a timeout, an error), the chat keeps its model. The keyword rules only fill the log.
  if (deps.askJev !== undefined && jev?.reading === undefined) {
    const { recommended: _unused, ...rest } = decision
    decision = { ...rest, use: from, switched: false, stayed: 'jev-unavailable', rationale: `${from.label} stays: the message was not read.` }
  }
  if (input.contextTokens !== undefined && decision.recommended !== undefined && decision.stayed !== 'jev-unavailable') {
    // The context check needs sizes; read them for the few models the decision can land on, then decide again.
    const contenders = decision.scored.slice(1, 1 + WINDOWS_READ)
    const sizes = await Promise.all(contenders.map(candidate => deps.contextWindow(candidate).catch(() => undefined)))
    const sized = input.candidates.map((candidate) => {
      const index = contenders.findIndex(contender => same(contender, candidate))
      const contextWindow = index === -1 ? undefined : sizes[index]
      return contextWindow === undefined ? candidate : { ...candidate, contextWindow }
    })
    decision = decide({ ...situation, candidates: sized })
  }

  const offered = decision.stayed === 'needs-payment' || decision.stayed === 'loses-context'
  if (decision.switched || (offered && decision.recommended !== undefined)) {
    const to = decision.switched ? decision.use : decision.recommended as Candidate
    events.push({
      outcome: decision.switched ? 'switched' : 'offer',
      at, from: named(from), to: named(to), task: reading.task, rationale: decision.rationale,
      improvement: Number(decision.improvement.toFixed(3)),
      ...decision.stayed === 'needs-payment' || decision.stayed === 'loses-context' ? { reason: decision.stayed } : {},
    })
  }
  return {
    use: { provider: decision.use.provider, model: decision.use.model },
    from, decision, reading, jev,
    ...jev?.failure === undefined ? {} : { jevFailure: jev.failure },
    events,
  }
}

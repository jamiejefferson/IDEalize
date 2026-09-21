/**
 * The routing decision: score every candidate for one reading of the task
 * under the user's priorities, then let a better one through three gates.
 * Pure. Jev (or the local rules) supplies the reading; the arithmetic lives
 * here because a decision model compares numbers unreliably, and because a
 * rationale the user can check has to come from figures the app holds.
 */

import { FREE_TOKENS, NEUTRAL, SHIPPED_SCORES } from './score-table.ts'
import type { ScoreRow } from './score-table.ts'
import { TASKS } from './tasks.ts'
import type { Capability, Difficulty, TaskReading } from './tasks.ts'

export interface Weights { cost: number; speed: number; intelligence: number }

export type Aggressiveness = 'conservative' | 'balanced' | 'aggressive'

export interface Gates {
  /** The least confidence in the reading that lets a switch through. */
  confidence: number
  /** The least gain in weighted score, 0 to 1. */
  improvement: number
  /** The least time between two switches in one chat. */
  seconds: number
}

/** The presets of the settings' one control (spec §4.1, §4.2). */
export const PRESETS: Record<Aggressiveness, Gates> = {
  conservative: { confidence: 0.9, improvement: 0.3, seconds: 300 },
  balanced: { confidence: 0.75, improvement: 0.15, seconds: 180 },
  aggressive: { confidence: 0.6, improvement: 0.05, seconds: 30 },
}

/** No preset switches sooner than this after the last switch (spec §4.1). */
export const HARD_THROTTLE_SECONDS = 30
/** A switch inside this window costs the next one confidence, so marginal readings cannot flip a chat back and forth (spec §10.2). */
export const STABILITY_WINDOW_SECONDS = 120
export const STABILITY_PENALTY = 0.1

/** USD per million tokens, or `free`; undefined when no price is known. */
export type Price = 'free' | { input: number; output: number } | undefined

/** One model the chat could use, with what the app knows about it. */
export interface Candidate {
  provider: string
  model: string
  /** The name a badge shows. */
  label: string
  price: Price
  contextWindow?: number | undefined
  /** Whether it takes image input; undefined when the catalogue does not say. */
  images?: boolean | undefined
}

export interface Scored extends Candidate {
  family: string
  /** False for a model no row of the table matches. */
  known: boolean
  /** Capability fit for the task, 0 to 1. */
  fit: number
  speed: number
  /** 1 for free, falling with price on a log scale. */
  thrift: number
  /** The weighted total the gates compare. */
  total: number
}

const same = (a: { provider: string; model: string }, b: { provider: string; model: string }): boolean =>
  a.provider === b.provider && a.model === b.model

/**
 * The table row for a model. The free-tokens route is one candidate whatever
 * model id it carries, because the engine chooses the provider per call.
 * @param candidate - the model to look up.
 * @param table - the user's rows first, then the shipped ones.
 * @returns the row, and whether the table knew the model.
 */
export function rowFor(candidate: { provider: string; model: string }, table: readonly ScoreRow[] = SHIPPED_SCORES): { row: Omit<ScoreRow, 'pattern'>; known: boolean } {
  if (candidate.provider === 'freetokens') return { row: FREE_TOKENS, known: true }
  const id = candidate.model.toLowerCase()
  for (const row of table) {
    try {
      if (new RegExp(row.pattern).test(id)) return { row, known: true }
    } catch {
      // A user's row with a broken pattern matches nothing; the rest of the table still reads.
    }
  }
  return { row: NEUTRAL, known: false }
}

/** Price to a 0 to 1 thrift score: free is 1, $1 a million sits near 0.85, $100 a million is 0. */
export function thriftOf(price: Price): number {
  if (price === 'free') return 1
  if (price === undefined) return 0.5
  // Chat turns read far more than they write, so input carries three quarters of the blend.
  const blended = price.input * 0.75 + price.output * 0.25
  return Math.max(0, 1 - Math.log10(1 + blended) / Math.log10(101))
}

/** A hard task leans on capability and a simple one on cost and speed, whatever the sliders say. */
const DIFFICULTY_LEAN: Record<Difficulty, number> = { simple: 0.5, moderate: 1, hard: 2.5 }

/**
 * Capability scores of usable models sit between 0.4 and 1, while speed and
 * thrift use the whole scale, so unstretched a cheap small model out-scored a
 * strong one on a hard task under even weights. Fit is spread over the same
 * range before it is weighed.
 */
const FIT_FLOOR = 0.4
const stretched = (fit: number): number => Math.min(1, Math.max(0, (fit - FIT_FLOOR) / (1 - FIT_FLOOR)))

function normalised(weights: Weights, difficulty: Difficulty): Weights {
  const cost = Math.max(0, weights.cost)
  const speed = Math.max(0, weights.speed)
  const intelligence = Math.max(0, weights.intelligence) * DIFFICULTY_LEAN[difficulty]
  const sum = cost + speed + intelligence
  if (sum === 0) return { cost: 1 / 3, speed: 1 / 3, intelligence: 1 / 3 }
  return { cost: cost / sum, speed: speed / sum, intelligence: intelligence / sum }
}

/**
 * Score one candidate for a reading.
 * @param candidate - the model.
 * @param reading - the task and its difficulty.
 * @param weights - the user's or the brain's priorities, any non-negative scale.
 * @param table - the capability table.
 * @returns the candidate with its scores.
 */
export function score(candidate: Candidate, reading: Pick<TaskReading, 'task' | 'difficulty'>, weights: Weights, table?: readonly ScoreRow[]): Scored {
  const { row, known } = rowFor(candidate, table)
  const needs = Object.entries(TASKS[reading.task].needs) as Array<[Capability, number]>
  const asked = needs.reduce((sum, [, weight]) => sum + weight, 0)
  const fit = needs.reduce((sum, [capability, weight]) => sum + weight * row.scores[capability], 0) / asked
  const thrift = thriftOf(candidate.price)
  const w = normalised(weights, reading.difficulty)
  const total = w.intelligence * stretched(fit) + w.speed * row.speed + w.cost * thrift
  return { ...candidate, family: row.family, known, fit, speed: row.speed, thrift, total }
}

/** What the chat brings to the decision besides the message. */
export interface Situation {
  current: Candidate
  candidates: Candidate[]
  reading: TaskReading
  weights: Weights
  gates: Gates
  /** Seconds since this chat last switched; undefined when it never has. */
  sinceLastSwitch?: number | undefined
  /** Only free models may be switched to. */
  preferFree: boolean
  /** Tokens the chat holds; a candidate with a smaller window would lose some. */
  contextTokens?: number | undefined
  /** The chat holds images, so a candidate must take them. */
  hasImages: boolean
  table?: readonly ScoreRow[]
}

export type StayReason =
  | 'no-recommendation'
  | 'throttle-failed'
  | 'confidence-gate-failed'
  | 'improvement-gate-failed'
  | 'needs-payment'
  | 'loses-context'
  /** Jev was asked and did not answer in time or at all; the turn keeps its model. */
  | 'jev-unavailable'

export interface Decision {
  /** The model the turn runs on. */
  use: Candidate
  switched: boolean
  /** Why the chat stayed; absent on a switch. */
  stayed?: StayReason
  /** The better model a gate or a warning held back, for the badge's offer. */
  recommended?: Scored | undefined
  currentModelConfidence: number
  switchConfidence: number
  improvement: number
  gates: { throttle: boolean; confidence: boolean; improvement: boolean }
  rationale: string
  scored: Scored[]
}

/** The rationale's second clause names the one axis besides fit that moved most. */
function sideBenefit(to: Scored, from: Scored): string {
  const thrift = to.thrift - from.thrift
  const speed = to.speed - from.speed
  if (thrift >= 0.1 && thrift >= speed) return to.price === 'free' ? ', and free' : ', and cheaper'
  if (speed >= 0.1) return ', and faster'
  if (thrift <= -0.1) return '; it costs more'
  return ''
}

/**
 * The sentence a badge shows. Written from the figures, never from a model.
 * @param to - the recommended model.
 * @param from - the chat's current model.
 * @param reading - the task reading.
 * @returns one sentence.
 */
export function rationaleFor(to: Scored, from: Scored, reading: TaskReading): string {
  const task = TASKS[reading.task].label
  const lead = to.fit - from.fit >= 0.03
    ? `${to.label} is stronger at ${task}`
    : `${to.label} handles ${task} as well as ${from.label}`
  return `${lead}${sideBenefit(to, from)}.`
}

/**
 * Decide one turn.
 * @param situation - the chat's model, its alternatives, the reading and the settings.
 * @returns the model to use and the full account of why.
 */
export function decide(situation: Situation): Decision {
  const { current, reading, weights, gates, table } = situation
  const from = score(current, reading, weights, table)
  const eligible = situation.candidates
    .filter(candidate => !same(candidate, current))
    .filter(candidate => !situation.hasImages || candidate.images !== false)
    .map(candidate => score(candidate, reading, weights, table))
    // An unscored model is never switched to: nothing the app holds says it is better.
    .filter(candidate => candidate.known)
    .sort((a, b) => b.total - a.total)
  const scored = [from, ...eligible]
  const best = eligible[0]

  const since = situation.sinceLastSwitch
  const penalty = since !== undefined && since < STABILITY_WINDOW_SECONDS ? STABILITY_PENALTY : 0
  const switchConfidence = Math.max(0, reading.confidence - penalty)
  const improvement = best === undefined ? 0 : Math.max(0, best.total - from.total)
  const currentModelConfidence = best === undefined || best.total <= from.total ? 1 : from.total / best.total
  const passed = {
    throttle: since === undefined || (since >= HARD_THROTTLE_SECONDS && since >= gates.seconds),
    confidence: switchConfidence >= gates.confidence,
    improvement: improvement >= gates.improvement,
  }
  const base = { currentModelConfidence, switchConfidence, improvement, gates: passed, scored }
  const stay = (stayed: StayReason, recommended?: Scored): Decision => ({
    ...base, use: current, switched: false, stayed, recommended,
    rationale: recommended === undefined ? `${from.label} suits this.` : rationaleFor(recommended, from, reading),
  })

  if (best === undefined || best.total <= from.total) return stay('no-recommendation')
  if (!passed.throttle) return stay('throttle-failed', best)
  if (!passed.confidence) return stay('confidence-gate-failed', best)
  if (!passed.improvement) return stay('improvement-gate-failed', best)
  // Two switches are the user's to make, so the router offers them and stays:
  // one that starts spending money, and one that would cut the chat's context.
  if (situation.preferFree && best.price !== 'free') {
    const free = eligible.find(candidate => candidate.price === 'free' && candidate.total - from.total >= gates.improvement
      && !losesContext(candidate, situation.contextTokens))
    if (free === undefined) return stay('needs-payment', best)
    return {
      ...base, use: free, switched: true, improvement: free.total - from.total, recommended: free,
      rationale: rationaleFor(free, from, reading),
    }
  }
  if (losesContext(best, situation.contextTokens)) return stay('loses-context', best)
  return { ...base, use: best, switched: true, recommended: best, rationale: rationaleFor(best, from, reading) }
}

/** A window the chat has already outgrown, with a tenth kept free for the reply. */
function losesContext(candidate: Candidate, contextTokens: number | undefined): boolean {
  if (contextTokens === undefined || candidate.contextWindow === undefined) return false
  return contextTokens > candidate.contextWindow * 0.9
}

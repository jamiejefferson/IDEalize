/**
 * A brain's own routing criteria: how readily its chats move, and what a
 * better model weighs for its kind of work (spec §3.2; JJ, 21 Sep 2026:
 * "people will want different criteria for different tasks"). Pure. A brain
 * with nothing saved starts from the shipped row for its id, then from the
 * app-wide values, which also serve a chat that runs no brain.
 */

import type { Aggressiveness, Weights } from './decide.ts'

/** What a brain's sheet saves; every field optional, so a partial entry still reads. */
export interface BrainCriteria {
  aggressiveness?: Aggressiveness
  cost?: number
  speed?: number
  intelligence?: number
}

/** The criteria one turn is decided under. */
export interface Criteria { aggressiveness: Aggressiveness; weights: Weights }

/** The starting points of the shipped brains, from the spec's §3.2 examples, on the sliders' 0 to 100 scale. */
export const SHIPPED_CRITERIA: Readonly<Record<string, BrainCriteria>> = {
  coding: { cost: 10, speed: 80, intelligence: 80 },
  design: { cost: 30, speed: 50, intelligence: 80 },
  admin: { cost: 90, speed: 70, intelligence: 20 },
}

/**
 * The criteria for one brain's turn.
 * @param saved - the `brains` map of the router's settings.
 * @param brain - the chat's brain, when it runs one.
 * @param fallback - the app-wide values.
 * @returns the brain's saved fields over its shipped row over the fallback.
 */
export function criteriaFor(
  saved: Readonly<Record<string, BrainCriteria>> | undefined,
  brain: string | undefined,
  fallback: Criteria,
): Criteria {
  if (brain === undefined) return fallback
  const own = { ...SHIPPED_CRITERIA[brain], ...saved?.[brain] }
  return {
    aggressiveness: own.aggressiveness ?? fallback.aggressiveness,
    weights: {
      cost: own.cost ?? fallback.weights.cost,
      speed: own.speed ?? fallback.weights.speed,
      intelligence: own.intelligence ?? fallback.weights.intelligence,
    },
  }
}

/** The request header that carries a turn's vector to the free-token engine. */
export const ROUTING_HEADER = 'x-idealize-routing'

/** The share of the engine's score that stays on reliability: its own balanced preset's. */
const ENGINE_RELIABILITY = 0.5

/** The free-token engine's weight vector. */
export interface EngineWeights { reliability: number; speed: number; intelligence: number }

/**
 * The free-token engine's vector for a brain's priorities. Every model inside
 * the engine costs nothing, so cost has no say there: reliability keeps the
 * balanced preset's half, and speed and intelligence split the other half in
 * the brain's own proportion. Even priorities give the engine's balanced preset.
 * @param weights - the brain's priorities.
 * @returns a vector that sums to 1.
 */
export function engineWeights(weights: Weights): EngineWeights {
  const speed = Math.max(0, weights.speed)
  const intelligence = Math.max(0, weights.intelligence)
  const total = speed + intelligence
  const rest = 1 - ENGINE_RELIABILITY
  if (total === 0) return { reliability: ENGINE_RELIABILITY, speed: rest / 2, intelligence: rest / 2 }
  return { reliability: ENGINE_RELIABILITY, speed: rest * speed / total, intelligence: rest * intelligence / total }
}

/**
 * The header value for a vector: three figures to three places, in the engine's axis order.
 * @param vector - the engine's vector.
 * @returns `reliability,speed,intelligence`.
 */
export const routingHeaderValue = (vector: EngineWeights): string =>
  [vector.reliability, vector.speed, vector.intelligence].map(value => value.toFixed(3)).join(',')

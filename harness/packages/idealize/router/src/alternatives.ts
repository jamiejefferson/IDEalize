/**
 * The two models a dislike offers. They are the best-suited models the person
 * has not rated for this kind of work, so every test fills a gap in what the
 * router knows (JJ, 28 Oct 2026); starred models step in only when too few
 * unrated ones fit. A model barred with one star, the model that gave the
 * disliked answer, and the free-token engine (which picks its own provider
 * per call, so there is no one model to rate) are never offered.
 */

import { FREE_PROVIDER } from './candidates.ts'
import { score } from './decide.ts'
import type { Candidate, Scored, Weights } from './decide.ts'
import type { Standing } from './ratings.ts'
import type { ScoreRow } from './score-table.ts'
import type { TaskReading } from './tasks.ts'

export interface AlternativesInput {
  /** The model that gave the answer the person disliked. */
  current: { provider: string; model: string }
  candidates: readonly Candidate[]
  reading: Pick<TaskReading, 'task' | 'difficulty'>
  weights: Weights
  /** The chat holds images, so an alternative must take them. */
  hasImages: boolean
  table?: readonly ScoreRow[] | undefined
  standingOf?: ((candidate: Candidate) => Standing) | undefined
}

const same = (a: { provider: string; model: string }, b: { provider: string; model: string }): boolean =>
  a.provider === b.provider && a.model === b.model

/**
 * Pick the alternatives.
 * @param input - the disliked model, the candidates and the reading.
 * @param count - how many to offer.
 * @returns up to `count` models, unrated first, one per family where the list allows.
 */
export function alternativesFor(input: AlternativesInput, count = 2): Scored[] {
  const scored = input.candidates
    .filter(candidate => candidate.provider !== FREE_PROVIDER && !same(candidate, input.current))
    .filter(candidate => !input.hasImages || candidate.images !== false)
    .map(candidate => ({ candidate, rated: input.standingOf?.(candidate) }))
    .filter(({ rated }) => rated?.barred !== true)
    .map(({ candidate, rated }) => score(candidate, { ...input.reading }, input.weights, input.table, rated))
    // Nothing the app holds says an unscored, unrated model suits the work.
    .filter(candidate => candidate.known)
    .sort((a, b) => b.total - a.total)
  const ordered = [
    ...scored.filter(candidate => candidate.stars === undefined),
    ...scored.filter(candidate => candidate.stars !== undefined),
  ]
  // Two models of one family answer alike; a second family makes the comparison worth its price.
  const picked: Scored[] = []
  for (const candidate of ordered) {
    if (picked.length === count) break
    if (!picked.some(other => other.family === candidate.family)) picked.push(candidate)
  }
  for (const candidate of ordered) {
    if (picked.length === count) break
    if (!picked.includes(candidate)) picked.push(candidate)
  }
  return picked
}

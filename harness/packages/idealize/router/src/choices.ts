/**
 * What the chat box's model chip shows and writes: how the router behaves
 * (`mode`), where the Cheaper to Smarter slider sits (`lean`), and the list of
 * the chat's company's models with a tick each (JJ, 24 Nov 2026). Pure: the
 * host supplies the connected models and the chat's own model.
 */

import { companyOf, isExcluded } from './company.ts'
import { DEFAULT_LEAN, leanOf } from './criteria.ts'
import type { Candidate } from './decide.ts'
import type { RoutedModel, RouterChoice, RouterChoices, RouterMode } from './projection-types.ts'

export type { RouterChoice, RouterChoices, RouterMode } from './projection-types.ts'

/** Every mode, in the order the chip shows them. */
export const ROUTER_MODES: readonly RouterMode[] = ['auto', 'ask', 'fixed']

/**
 * The mode a stored or posted value names.
 * @param value - what the settings or a request hold.
 * @returns the mode, or undefined when the value names none.
 */
export function modeOf(value: unknown): RouterMode | undefined {
  return ROUTER_MODES.find(mode => mode === value)
}

/** The fields of the router's settings the chip writes. */
export interface ChoiceSettings { mode?: RouterMode; lean?: number; excluded?: string[] }

/**
 * The chip's share of a `POST /idealize/router/settings` body.
 * @param body - the parsed request body.
 * @returns the valid fields; a field of the wrong shape is left out.
 */
export function choiceSettings(body: Readonly<Record<string, unknown>>): ChoiceSettings {
  const mode = modeOf(body.mode)
  const lean = leanOf(body.lean)
  const listed: unknown = body.excluded
  const excluded = Array.isArray(listed) && listed.every((item): item is string => typeof item === 'string')
    ? [...new Set(listed)]
    : undefined
  return {
    ...mode === undefined ? {} : { mode },
    ...lean === undefined ? {} : { lean },
    ...excluded === undefined ? {} : { excluded },
  }
}

export interface ChoicesInput {
  mode: RouterMode | undefined
  lean: number | undefined
  excluded: readonly string[]
  sameCompany: boolean
  /** The chat's own model. */
  own: RoutedModel
  /** The routed model while a switch holds, else the chat's own. */
  answering: RoutedModel
  /** Every connected model. */
  candidates: readonly Candidate[]
}

const same = (a: { provider: string; model: string }, b: { provider: string; model: string }): boolean =>
  a.provider === b.provider && a.model === b.model

/** Where a price sorts: free first, then by what a million written tokens cost, and an unknown price last. */
const costRank = (price: RouterChoice['price']): number =>
  price === 'free' ? 0 : price === null ? Number.POSITIVE_INFINITY : price.output

/**
 * Compose the chip's answer.
 * @param input - the settings, the chat's models and the connected models.
 * @returns the settings and the company's models, cheapest first. An unticked model is listed
 * with `allowed: false`, and the answering model is listed even when no connected route names it.
 */
export function choicesFor(input: ChoicesInput): RouterChoices {
  const company = companyOf(input.own.provider, input.own.model)
  const inCompany = input.candidates.filter(candidate =>
    !input.sameCompany || same(candidate, input.answering) || companyOf(candidate.provider, candidate.model) === company)
  const listed: Candidate[] = inCompany.some(candidate => same(candidate, input.answering))
    ? inCompany
    : [...inCompany, { ...input.answering, price: undefined }]
  const models = listed
    .map((candidate): RouterChoice => ({
      provider: candidate.provider,
      model: candidate.model,
      label: candidate.label,
      price: candidate.price ?? null,
      allowed: !isExcluded(candidate, input.excluded),
      answering: same(candidate, input.answering),
    }))
    .sort((a, b) => costRank(a.price) - costRank(b.price) || a.label.localeCompare(b.label))
  return {
    mode: input.mode ?? 'auto', lean: leanOf(input.lean) ?? DEFAULT_LEAN, company, answering: input.answering, models,
    excluded: [...input.excluded],
  }
}

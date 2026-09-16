/**
 * The compatibility rule between a model and a capability requirement, as one
 * pure predicate both the runtime and the media routes apply.
 * @module @idealize/generate/compat
 */

import type { CapabilityRequirement, GenModelInfo } from './types.ts'

/**
 * Whether a model satisfies one requirement: the artefact type matches and
 * every required input modality is among the model's input modalities.
 * @param model - the model as its backend publishes it.
 * @param requirement - the artefact and input modalities the task needs.
 * @returns true when the model can serve the requirement.
 */
export function satisfies(model: GenModelInfo, requirement: CapabilityRequirement): boolean {
  if (model.artefact !== requirement.artefact) return false
  return requirement.inputModalities.every(modality => model.inputModalities.includes(modality))
}

/**
 * Whether a model satisfies every requirement in a set.
 * @param model - the model as its backend publishes it.
 * @param requirements - the full requirement set (a preset's `requiredCapabilities`).
 * @returns true when {@link satisfies} holds for each requirement.
 */
export function satisfiesAll(model: GenModelInfo, requirements: readonly CapabilityRequirement[]): boolean {
  return requirements.every(requirement => satisfies(model, requirement))
}

/**
 * Event vocabulary of the generation tools: the `generation/rerouted` notice
 * appended when a preset's stored model cannot serve a task and the router
 * falls back to the first compatible catalogue entry (BRN routing rule).
 * Types only — no runtime code.
 * @module @idealize/gen-tools/src/types
 */

import type { GenArtefact, GenModelRef } from '@idealize/generate'

/** Payload of `generation/rerouted`: the preset, the stored choice, and the model actually used. */
export interface GenerationReroutedData {
  /** The media preset whose stored choice could not serve the task. */
  readonly presetId: string
  readonly artefact: GenArtefact
  /** The stored preset→model choice, kept in settings untouched. */
  readonly stored: GenModelRef
  /** The compatible model the task actually ran on. */
  readonly used: GenModelRef
  /** Why the stored choice was passed over. */
  readonly reason: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records one routing fallback: a generation task whose preset's stored
     * model was absent from the compatible catalogue ran on the first
     * compatible entry instead. The stored choice itself is never rewritten —
     * a later task retries it. Informational (the tool result carries the
     * same notice as model-visible text), so the envelope marks it ignorable
     * for readers without this vocabulary.
     */
    'generation/rerouted': GenerationReroutedData
  }
}

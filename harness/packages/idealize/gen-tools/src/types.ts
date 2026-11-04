/**
 * Event vocabulary of the generation tools: the `generation/rerouted` notice
 * appended when a preset's stored model cannot serve a task and the router
 * falls back to the first compatible catalogue entry (BRN routing rule).
 * Types only — no runtime code.
 * @module @idealize/gen-tools/src/types
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { GenArtefact, GenCatalogEntry, GenModelRef } from '@idealize/generate'

/** Payload of `generation/rerouted`: the preset, the stored choice, and the model actually used. */
export interface GenerationReroutedData {
  /** The media preset whose stored choice could not serve the task. */
  readonly presetId: string
  readonly artefact: GenArtefact
  /** The stored preset→model choice, kept in settings untouched. */
  readonly stored: GenModelRef
  /** The compatible model the task actually ran on. */
  readonly used: GenModelRef
  /** Why the stored choice was passed over, in words for the person. */
  readonly reason: string
  /** The tool call this move served, so its card can say why. */
  readonly callId?: string
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

/** What a listener of `generation/choose-model` knows about one call. */
export interface GenerationChoice {
  readonly session: Session
  /** The media preset the tool serves: `images`, `motion` or `sound`. */
  readonly presetId: string
  readonly artefact: GenArtefact
  readonly prompt: string
  /** The compatible models that can run this call's inputs. */
  readonly candidates: readonly GenCatalogEntry[]
  /** Whether the call carries a reference picture. */
  readonly hasReference: boolean
}

/** What a listener of `generation/replace-model` knows about one call. */
export interface GenerationReplacement {
  readonly session: Session
  readonly presetId: string
  /** The model that cannot serve the call. */
  readonly failed: GenCatalogEntry
  /** The models that could take over. */
  readonly candidates: readonly GenCatalogEntry[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Choose the model one generation runs on. `await next()` yields the
     * person's stored choice (or the first runnable model when that is
     * missing); a listener may return another entry of `choice.candidates`.
     * Anything else is ignored and the call runs on the stored choice.
     * @mode waterfall
     * @param choice - the call: its session, preset, prompt and runnable models.
     * @param next - the stored choice.
     */
    'generation/choose-model'(choice: GenerationChoice, next: () => Promise<GenCatalogEntry>): Promise<GenCatalogEntry>
    /**
     * A model cannot serve this call: name the one that takes over, or
     * undefined to let the call fail.
     * @mode waterfall
     * @param choice - the call: its session, preset, the failed model and the candidates.
     * @param next - the replacement named so far, undefined when none has been.
     */
    'generation/replace-model'(choice: GenerationReplacement, next: () => Promise<GenCatalogEntry | undefined>): Promise<GenCatalogEntry | undefined>
  }
}

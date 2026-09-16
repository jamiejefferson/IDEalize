/**
 * The Gallery view target's vocabulary: one row per generation task, the
 * snapshot the grid reads, and the generation settings the composer strip
 * carries. Types only — the Definition and its builder live in
 * `definition.ts`.
 * @module @idealize/ui-gallery/client/contract
 */

import type { ConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

/** The artefact kinds a Gallery row can be generating. */
export type GalleryArtefactKind = 'image' | 'video' | 'audio'

/** One committed artefact inside a finished row. */
export interface GalleryArtefact {
  /** The `ArtefactId` the raw route serves bytes for. */
  readonly id: string
  readonly mediaType: string
  readonly bytes: number
  /** Project-relative storage path, shown in the enlarged view; follows the file when it is archived or kept. */
  readonly relPath: string
  /** True once the user archived it (`artefact/disposition`); archived tiles fold under the grid. */
  readonly archived: boolean
}

/**
 * The generation settings one task ran with, as the tool call carried them.
 * Retry resubmits these values verbatim, so a retried task asks for exactly
 * what the failed one asked for.
 */
export interface GallerySettings {
  /** Aspect ratio or size hint (images); absent when the task named none. */
  readonly aspect?: string
  /** Target duration in seconds (video and audio); absent when the task named none. */
  readonly durationSeconds?: number
}

/**
 * One generation task as the Gallery renders it: the call that started it, the
 * prompt and settings it ran with, and its outcome. `running` covers a
 * dispatched call with no artefact and no failure recorded yet, including a
 * background job still in flight.
 */
export interface GalleryRow {
  /** The `tool/call` id; stable identity of the row across its lifetime. */
  readonly callId: string
  readonly toolName: string
  readonly artefactKind: GalleryArtefactKind
  /** What the model asked the provider for. */
  readonly prompt: string
  readonly settings: GallerySettings
  readonly status: 'running' | 'done' | 'failed'
  /** Log time of the `tool/call` event, in epoch milliseconds. */
  readonly startedAt: number
  /** Log sequence of the `tool/call` event; the grid's newest-first ordering key. */
  readonly startSeq: number
  /** The turn the call ran in, as its `tool/call` event carries it; joins the row to its {@link GalleryTurn}. */
  readonly turn: number
  /** Artefacts committed by this task, in commit order; empty until one lands. */
  readonly artefacts: readonly GalleryArtefact[]
  /**
   * The provider-reported cause (MOD-05), taken from `artefact/failed` when the
   * adapter reached the provider, and from the failing tool result otherwise.
   */
  readonly error?: string
}

/**
 * Where one turn of the chat stands, as the grid tells it: `thinking` from the
 * turn's start until the model calls a generation tool or the turn ends;
 * `generating` once a generation call is in the log (the {@link GalleryRow}
 * then carries the task); `no-generation` when the turn ended without one, so
 * the model's reply is what the person needs to read; `generated` when the
 * turn ended after at least one generation call.
 */
export type GalleryTurnPhase = 'thinking' | 'generating' | 'no-generation' | 'generated'

/**
 * One turn of the chat as the grid shows it while nothing has been made yet:
 * what the person asked, whether the model is still thinking, and what it said
 * when it made nothing. Folded from `turn/start`, the turn's generation
 * `tool/call`s, `assistant/message` and `turn/end`; the prompt text joins from
 * the turn's first user message (a {@link GalleryPrompt}) in the view target's
 * builder, because a `user/message` event carries no turn number of its own.
 */
export interface GalleryTurn {
  readonly turn: number
  /** Log sequence of the `turn/start` event; orders the turn among the rows. */
  readonly startSeq: number
  /** Log time of the `turn/start` event, in epoch milliseconds. */
  readonly startedAt: number
  /** The person's message that opened the turn; empty until its `user/message` is joined. */
  readonly prompt: string
  readonly phase: GalleryTurnPhase
  /** The generation calls the turn made, in log order. */
  readonly callIds: readonly string[]
  /** The model's last text of the turn; what a `no-generation` turn shows in place of a tile. */
  readonly reply: string
  /** Why the turn ended, once it has (`completed`, `aborted`, `error`, …). */
  readonly endReason?: string
  /**
   * The failure the turn ended on, when `endReason` is `error`. A provider
   * that refuses the request leaves no reply, and without this the grid said
   * only that nothing was generated — which reads as the generator being
   * broken rather than the account (JJ, 1 Sep 2026: "image gen isn't
   * working", against a ChatGPT token the route could not read an account id
   * out of).
   */
  readonly error?: string
}

/** One user message of the chat, published so the builder can give each turn its prompt. */
export interface GalleryPrompt {
  readonly messageId: string
  readonly seq: number
  readonly text: string
}

/** Envelope of a generation row in the `gallery` target. */
export interface GalleryGenerationViewNode extends ConversationViewNode {
  readonly kind: 'gallery-generation'
  readonly target: 'gallery'
  readonly data: GalleryRow
}

/** Envelope of a turn row in the `gallery` target. */
export interface GalleryTurnViewNode extends ConversationViewNode {
  readonly kind: 'gallery-turn'
  readonly target: 'gallery'
  readonly data: GalleryTurn
}

/** Envelope of a user prompt in the `gallery` target. */
export interface GalleryPromptViewNode extends ConversationViewNode {
  readonly kind: 'gallery-prompt'
  readonly target: 'gallery'
  readonly data: GalleryPrompt
}

/** Target envelope one Gallery node travels in: a generation row, a turn, or a prompt. */
export type GalleryConversationViewNode = GalleryGenerationViewNode | GalleryTurnViewNode | GalleryPromptViewNode

/**
 * The rows of one artefact kind, newest first.
 *
 * The Definition publishes every generation the chat ran, whatever it made,
 * because one chat's log is one stream. Each space then shows its own kind:
 * Images, Sounds and Video are three views of the same per-chat source, and a
 * space that showed another kind's work would be claiming a generation the
 * person did not do there.
 * @param snapshot - the target snapshot, or undefined before one is assembled.
 * @param kind - the artefact kind this view shows.
 * @returns the matching rows, in snapshot order.
 */
export function rowsOfKind(
  snapshot: GallerySnapshot | undefined,
  kind: GalleryArtefactKind,
): readonly GalleryRow[] {
  return (snapshot?.rows ?? []).filter(row => row.artefactKind === kind)
}

/**
 * The Gallery target snapshot: every generation row of the loaded window and
 * every turn of the chat, each newest first. The turns carry their prompt
 * already joined.
 */
export interface GallerySnapshot {
  readonly rows: readonly GalleryRow[]
  readonly turns: readonly GalleryTurn[]
}

/**
 * The turns a view shows as rows of their own: a turn still thinking, and a
 * turn that ended without generating. A turn that reached a generation call
 * is told by its {@link GalleryRow}s instead.
 * @param snapshot - the target snapshot, or undefined before one is assembled.
 * @returns the turns to render, in snapshot order.
 */
export function pendingTurns(snapshot: GallerySnapshot | undefined): readonly GalleryTurn[] {
  return (snapshot?.turns ?? []).filter(turn => turn.phase === 'thinking' || turn.phase === 'no-generation')
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationViewSnapshotMap {
    /** Generation rows assembled for the Gallery grid. */
    gallery: GallerySnapshot
  }
}

/**
 * One generation setting the composer strip offers: an input of the active
 * space's model, as `GET /idealize/generate/inputs` publishes it (the seam's
 * `GenInputField`, restated because the client bundle imports no host
 * package), or one of the fallback vocabularies the strip carries for a space
 * whose model publishes no schema. `kind` decides the control: a select for an
 * enum, a number input for a number, a checkbox for a boolean.
 */
export type GenerationField = GenerationEnumField | GenerationNumberField | GenerationBooleanField

/** What every {@link GenerationField} carries, whatever its kind. */
export interface GenerationFieldBase {
  /** The model's input name; the tag part is spelled with this name, except `aspect_ratio` which writes `aspect`. */
  readonly name: string
  /** Short display word (Aspect, Duration, Resolution); fallback fields carry their locale text here. */
  readonly label: string
}

/** A string-enum setting, rendered as a select. */
export interface GenerationEnumField extends GenerationFieldBase {
  readonly kind: 'enum'
  /** The values the select offers, in menu order. */
  readonly values: readonly string[]
  /** The value the model uses when the part is absent; a field at its default writes no part. Absent: the strip shows an unset choice. */
  readonly default?: string
}

/** A numeric setting, rendered as a number input within the model's bounds. */
export interface GenerationNumberField extends GenerationFieldBase {
  readonly kind: 'number'
  /** True when the model takes whole numbers only; the input then steps by one. */
  readonly integer: boolean
  readonly min?: number
  readonly max?: number
  /** The value the model uses when the part is absent. Absent: the input starts empty. */
  readonly default?: number
}

/** A boolean setting, rendered as a checkbox. */
export interface GenerationBooleanField extends GenerationFieldBase {
  readonly kind: 'boolean'
  /**
   * The value the model uses when the part is absent. Absent: the box starts
   * unticked and a tick writes `name true`.
   */
  readonly default?: boolean
}

/** What `GET /idealize/generate/inputs?space=` answers. */
export interface GenerationInputs {
  /** The model the space resolves to, or null while the space has none. */
  readonly model: { readonly provider: string; readonly model: string } | null
  /**
   * The model's enum, number and boolean inputs, `prompt` and provider-internal
   * fields excluded; empty when the service publishes no schema.
   */
  readonly fields: readonly GenerationField[]
}

/** The controls one strip renders: the fields in row order, and the image-count menu where the space offers one. */
export interface GenerationStrip {
  readonly fields: readonly GenerationField[]
  /** How many images one prompt may ask for, in menu order; absent on spaces without a count control. */
  readonly counts?: readonly number[]
}

/** The choices the composer strip holds for one draft. */
export interface GenerationSelection {
  /** Chosen value per field name; a field absent here sits at its default (or unset). */
  readonly values: Readonly<Record<string, string>>
  /** How many images one prompt asks for; 1 states none and writes no part. */
  readonly count: number
}

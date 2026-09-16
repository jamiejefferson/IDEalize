/**
 * The Gallery's conversation Definitions and view-target builder, folded from
 * the events the host already writes.
 *
 * `gallery-generation`, one Context per generation task:
 * - `tool/call` for one of the three generation tools STARTS a row and carries
 *   the prompt and settings the model asked for (the raw arguments JSON).
 * - `artefact/created` whose `sourceTask.callId` names that call adds the
 *   committed artefact and settles the row.
 * - `artefact/failed` settles the row with the adapter's provider cause
 *   (MOD-05); the first cause recorded wins, so a following error result never
 *   overwrites the provider's own words with the generic tool text.
 * - `artefact/disposition` marks one of the row's artefacts archived or kept
 *   and moves its path with the file.
 * - A failing `tool/result` settles a row whose call never reached the
 *   provider (an unavailable media preset fails before any adapter runs, so no
 *   `artefact/failed` exists to carry a cause).
 *
 * `gallery-turn`, one Context per turn of the chat (JJ, 8 Sep 2026: posting a
 * message on Images, Video or Sounds "looks like it's not working"):
 * - `turn/start` STARTS the turn in the `thinking` phase.
 * - a generation `tool/call` in that turn moves it to `generating`.
 * - `assistant/message` records the model's last text.
 * - `turn/end` settles it: `generated` when a generation call happened,
 *   `no-generation` otherwise, so the view shows what the model said instead.
 *
 * `gallery-prompt`, one Context per user message: the person's text and its
 * log position. A `user/message` carries no turn number, so the builder joins
 * each prompt to the turn whose `turn/start` precedes it.
 *
 * The Definitions add no session events: everything they read is already in
 * the log and in the read vocabulary.
 * @module @idealize/ui-gallery/client/definition
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatchResult, ConversationNodeContext, ConversationNodeDefinition,
  ConversationViewBuilder, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Type-only: the `artefact/created` / `artefact/failed` SessionEventMap merge
// (the client half declares it; the client bundle purity gate never sees a
// type-only import, and the Host face never enters this program).
import type {} from '@idealize/artefacts/src/types.ts'
import type {
  GalleryArtefact, GalleryArtefactKind, GalleryConversationViewNode, GalleryPrompt, GalleryRow, GallerySnapshot,
  GallerySettings, GalleryTurn,
} from './contract.ts'

/** The generation Definition kind; also its Context key prefix. */
export const GALLERY_KIND = 'gallery-generation'

/** The turn Definition kind; also its Context key prefix. */
export const GALLERY_TURN_KIND = 'gallery-turn'

/** The prompt Definition kind; also its Context key prefix. */
export const GALLERY_PROMPT_KIND = 'gallery-prompt'

/** The Gallery's view target id. */
export const GALLERY_TARGET = 'gallery'

/** The generation tools whose calls become Gallery rows, and the artefact each produces. */
export const GENERATION_TOOLS: Readonly<Record<string, GalleryArtefactKind>> = {
  generate_image: 'image',
  generate_video: 'video',
  generate_audio: 'audio',
}

/** Stable empty target used until a session has assembled generation rows. */
export const EMPTY_GALLERY_SNAPSHOT: GallerySnapshot = { rows: [], turns: [] }

/**
 * Read the prompt and settings out of one `tool/call`'s raw arguments JSON.
 * The model produced this string, so every field is checked before use.
 * @param raw - the arguments string exactly as the model produced it.
 * @returns the prompt (empty when the model sent none or sent invalid JSON) and
 * the settings it named.
 */
export function readToolArguments(raw: string): { prompt: string; settings: GallerySettings } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // An unparsable call still deserves a row, so the grid can show it running
    // and then failing.
    return { prompt: '', settings: {} }
  }
  if (typeof parsed !== 'object' || parsed === null) return { prompt: '', settings: {} }
  const fields = parsed as Record<string, unknown>
  const settings: GallerySettings = {
    ...typeof fields.aspect === 'string' ? { aspect: fields.aspect } : {},
    ...typeof fields.duration_s === 'number' ? { durationSeconds: fields.duration_s } : {},
  }
  return { prompt: typeof fields.prompt === 'string' ? fields.prompt : '', settings }
}

/** The call id one `tool/result` settles. */
function resultCallId(event: SessionEvent<'tool/result'>): string {
  return String(event.data.message.content[0].toolCallId)
}

/** Whether one `tool/result` reported a failure. */
function resultFailed(event: SessionEvent<'tool/result'>): boolean {
  return event.data.error !== undefined || event.data.message.content[0].isError === true
}

/** The failing result's model-facing text, used only when no provider cause was recorded. */
function resultErrorText(event: SessionEvent<'tool/result'>): string {
  const parts: string[] = []
  for (const block of event.data.message.content[0].content) {
    if (block.type === 'text') parts.push(block.text)
  }
  const text = parts.join('\n').trim()
  if (text !== '') return text
  return event.data.error === undefined ? 'the generation failed' : `${event.data.error.name}: ${event.data.error.code}`
}

/**
 * The Gallery Definition: one Context per generation call, publishing one
 * {@link GalleryRow} into the `gallery` target.
 */
export const galleryDefinition: ConversationNodeDefinition<GalleryRow> = {
  kind: GALLERY_KIND,
  target: GALLERY_TARGET,
  match: (event): ConversationMatchResult | null => {
    if (event.type === 'tool/call') {
      return event.data.name in GENERATION_TOOLS ? { id: String(event.data.callId), role: 'start' } : null
    }
    if (event.type === 'artefact/created') {
      const task = event.data.record.sourceTask
      return task.toolName in GENERATION_TOOLS ? { id: String(task.callId), role: 'update' } : null
    }
    if (event.type === 'artefact/failed' || event.type === 'artefact/disposition') {
      const task = event.data.sourceTask
      return task.toolName in GENERATION_TOOLS ? { id: String(task.callId), role: 'update' } : null
    }
    if (event.type === 'tool/result' && resultFailed(event)) {
      // Only failures: a successful result adds nothing an artefact event does
      // not already carry, and matching every result would open a Context for
      // every tool call in the session.
      return { id: resultCallId(event), role: 'update' }
    }
    return null
  },
  start: (_context, match): GalleryRow => {
    const event = match.event
    if (event.type !== 'tool/call') throw new Error('a gallery row starts at a generation tool/call')
    const artefactKind = GENERATION_TOOLS[event.data.name]
    if (artefactKind === undefined) throw new Error(`tool ${event.data.name} produces no gallery artefact`)
    const { prompt, settings } = readToolArguments(event.data.arguments)
    return {
      callId: String(event.data.callId),
      toolName: event.data.name,
      artefactKind,
      prompt,
      settings,
      status: 'running',
      startedAt: event.time,
      startSeq: event.seq,
      turn: event.data.turn,
      artefacts: [],
    }
  },
  update: (context, match): GalleryRow => {
    const state = context.state
    const event = match.event
    if (event.type === 'artefact/created') {
      const record = event.data.record
      const artefact: GalleryArtefact = {
        id: String(record.id),
        mediaType: record.mediaType,
        bytes: record.storage.bytes,
        relPath: record.storage.relPath,
        archived: record.disposition === 'archived',
      }
      return { ...state, status: 'done', artefacts: [...state.artefacts, artefact] }
    }
    if (event.type === 'artefact/disposition') {
      const id = String(event.data.artefactId)
      return {
        ...state,
        artefacts: state.artefacts.map(artefact => artefact.id === id
          ? { ...artefact, relPath: event.data.relPath, archived: event.data.disposition === 'archived' }
          : artefact),
      }
    }
    if (event.type === 'artefact/failed') {
      // The provider's own words: recorded once and never replaced.
      return { ...state, status: 'failed', error: state.error ?? event.data.error }
    }
    if (event.type === 'tool/result') {
      return { ...state, status: 'failed', error: state.error ?? resultErrorText(event) }
    }
    return state
  },
  buildViewNode: (context: ConversationNodeContext<GalleryRow>): GalleryConversationViewNode | null => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: GALLERY_KIND,
      id: context.id,
      target: GALLERY_TARGET,
      data: context.state,
    }
  },
}

/** The text blocks of one assistant message, joined; empty when it carried none. */
function assistantText(event: SessionEvent<'assistant/message'>): string {
  const parts: string[] = []
  for (const block of event.data.message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * The turn Definition: one Context per turn, publishing one {@link GalleryTurn}
 * into the `gallery` target.
 */
export const galleryTurnDefinition: ConversationNodeDefinition<GalleryTurn> = {
  kind: GALLERY_TURN_KIND,
  target: GALLERY_TARGET,
  match: (event): ConversationMatchResult | null => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end' || event.type === 'assistant/message') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/call' && event.data.name in GENERATION_TOOLS) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match): GalleryTurn => {
    const event = match.event
    if (event.type !== 'turn/start') throw new Error('a gallery turn starts at turn/start')
    return {
      turn: event.data.turn,
      startSeq: event.seq,
      startedAt: event.time,
      prompt: '',
      phase: 'thinking',
      callIds: [],
      reply: '',
    }
  },
  update: (context, match): GalleryTurn => {
    const state = context.state
    const event = match.event
    if (event.type === 'tool/call') {
      return { ...state, phase: 'generating', callIds: [...state.callIds, String(event.data.callId)] }
    }
    if (event.type === 'assistant/message') {
      const text = assistantText(event)
      return text === '' ? state : { ...state, reply: text }
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason
      return {
        ...state,
        phase: state.callIds.length === 0 ? 'no-generation' : 'generated',
        endReason: reason.kind,
        ...reason.kind === 'error' ? { error: reason.error.message } : {},
      }
    }
    return state
  },
  buildViewNode: (context: ConversationNodeContext<GalleryTurn>): GalleryConversationViewNode | null => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: GALLERY_TURN_KIND,
      id: context.id,
      target: GALLERY_TARGET,
      data: context.state,
    }
  },
}

/** The text blocks of one user message, joined; empty when the person sent only attachments. */
function userText(event: SessionEvent<'user/message'>): string {
  const parts: string[] = []
  for (const block of event.data.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * The prompt Definition: one Context per message the person sent (a `plugin`
 * or `model` source is context the model reads, not something the person
 * asked for), publishing one {@link GalleryPrompt} into the `gallery` target.
 */
export const galleryPromptDefinition: ConversationNodeDefinition<GalleryPrompt> = {
  kind: GALLERY_PROMPT_KIND,
  target: GALLERY_TARGET,
  match: (event): ConversationMatchResult | null => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return null
    return { id: String(event.data.id), role: 'start' }
  },
  start: (_context, match): GalleryPrompt => {
    const event = match.event
    if (event.type !== 'user/message') throw new Error('a gallery prompt starts at user/message')
    return { messageId: String(event.data.id), seq: event.seq, text: userText(event) }
  },
  update: context => context.state,
  buildViewNode: (context: ConversationNodeContext<GalleryPrompt>): GalleryConversationViewNode | null => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: GALLERY_PROMPT_KIND,
      id: context.id,
      target: GALLERY_TARGET,
      data: context.state,
    }
  },
}

/**
 * Give each turn the prompt that opened it: the first user message logged
 * after the turn's start and before the next turn's start.
 * @param turns - the turns, in any order.
 * @param prompts - the user messages, in any order.
 * @returns the turns with their prompt text, newest first.
 */
export function joinPrompts(turns: readonly GalleryTurn[], prompts: readonly GalleryPrompt[]): GalleryTurn[] {
  const ordered = [...turns].sort((left, right) => left.startSeq - right.startSeq)
  const bySeq = [...prompts].sort((left, right) => left.seq - right.seq)
  const joined = ordered.map((turn, index) => {
    const next = ordered[index + 1]?.startSeq ?? Number.POSITIVE_INFINITY
    const prompt = bySeq.find(candidate => candidate.seq > turn.startSeq && candidate.seq < next)
    return prompt === undefined ? turn : { ...turn, prompt: prompt.text }
  })
  return joined.reverse()
}

/** Collects the published nodes and republishes rows and turns newest first, each turn carrying its prompt. */
class GallerySnapshotBuilder implements ConversationViewBuilder<GalleryConversationViewNode, GallerySnapshot> {
  readonly empty = EMPTY_GALLERY_SNAPSHOT

  private readonly rows = new Map<string, GalleryRow>()
  private readonly turns = new Map<string, GalleryTurn>()
  private readonly prompts = new Map<string, GalleryPrompt>()

  /**
   * Adopt a complete node set.
   * @param input - every materialized Gallery node.
   * @returns the rebuilt snapshot.
   */
  replace(input: { readonly nodes: readonly GalleryConversationViewNode[] }): GallerySnapshot {
    this.rows.clear()
    this.turns.clear()
    this.prompts.clear()
    for (const node of input.nodes) this.adopt(node)
    return this.publish()
  }

  /**
   * Apply the nodes that changed in one transaction.
   * @param input - the changed Gallery nodes.
   * @returns the updated snapshot.
   */
  apply(input: { readonly upserts: readonly GalleryConversationViewNode[] }): GallerySnapshot {
    for (const node of input.upserts) this.adopt(node)
    return this.publish()
  }

  private adopt(node: GalleryConversationViewNode): void {
    switch (node.kind) {
      case 'gallery-generation':
        this.rows.set(node.key, node.data)
        break
      case 'gallery-turn':
        this.turns.set(node.key, node.data)
        break
      case 'gallery-prompt':
        this.prompts.set(node.key, node.data)
        break
      default:
        assertNever(node)
    }
  }

  private publish(): GallerySnapshot {
    // Newest generation first: the tile the user just asked for leads the grid.
    const rows = [...this.rows.values()].sort((left, right) => right.startSeq - left.startSeq)
    return { rows, turns: joinPrompts([...this.turns.values()], [...this.prompts.values()]) }
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected gallery node ${JSON.stringify(value)}`)
}

/** The Gallery target factory. */
export const galleryViewDefinition: ConversationViewDefinition<GalleryConversationViewNode, GallerySnapshot> = {
  target: GALLERY_TARGET,
  create: () => new GallerySnapshotBuilder(),
}

/**
 * Register the three Gallery Definitions and their view target.
 * @param ctx - the client plugin context carrying `conversationEvents` and `conversationViews`.
 */
export function registerGalleryConversation(ctx: Context): void {
  ctx.conversationEvents.register(galleryDefinition)
  ctx.conversationEvents.register(galleryTurnDefinition)
  ctx.conversationEvents.register(galleryPromptDefinition)
  ctx.conversationViews.register(galleryViewDefinition)
}

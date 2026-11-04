/**
 * A comparison after a dislike (JJ, 28 Oct 2026). The person disliked a
 * reply; two other models answer the same ask; the person keeps one of them or
 * their first answer. These helpers read the log: which reply the dislike is
 * about, what the first model read before it answered, what both runs should
 * cost, and the steps of a comparison so far.
 *
 * A kept answer reaches the model as a note in the person's voice that takes
 * the disliked reply's place in what the model reads, the way a compaction
 * summary takes the place of the turns it covers. The chat still shows the
 * first reply, and the card under it says which answer the chat carries on from.
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

import type { Price } from './decide.ts'
import type { RouterCompareEventData, RouterMediaEventData } from './projection-types.ts'

/** The reply a dislike is about. */
export interface LastReply {
  seq: number
  turn: number
  provider: string
  model: string
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number | undefined
    cacheWriteTokens?: number | undefined
  } | undefined
}

const textOf = (content: readonly { type: string; text?: string }[]): string =>
  content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n').trim()

/**
 * The closing reply of the chat's latest finished turn, when the chat is idle
 * and that reply has words in it.
 * @param events - the session log, oldest first.
 * @returns the reply, or undefined while a turn runs or when the last turn closed without text.
 */
export function lastReply(events: readonly SessionEvent[]): LastReply | undefined {
  const end = events.findLast(event => event.type === 'turn/end')
  const start = events.findLast(event => event.type === 'turn/start')
  if (end?.type !== 'turn/end' || (start !== undefined && start.seq > end.seq)) return undefined
  const reply = events.findLast(event => event.seq < end.seq && event.type === 'assistant/message' && event.data.turn === end.data.turn)
  if (reply?.type !== 'assistant/message') return undefined
  const text = textOf(reply.data.message.content)
  if (text === '') return undefined
  return {
    seq: reply.seq,
    turn: reply.data.turn,
    provider: reply.data.message.source.provider,
    model: reply.data.message.source.model,
    text,
    ...reply.data.usage === undefined ? {} : { usage: reply.data.usage },
  }
}

/** The parts of a session the ask is read from. */
export interface SurfaceReader {
  readonly events: readonly SessionEvent[]
  readonly surface: { readonly nodes: readonly number[] }
  deriveEventMessage(event: SessionEvent): Message | null
}

/**
 * What a step's new messages ask: the person's words, or the brief another chat
 * started this chat with, without the line saying who wrote it.
 * @param messages - the step's new messages.
 * @returns those messages and their words.
 */
export function askOf<T extends Pick<Message, 'content' | 'source'>>(messages: readonly T[]): { mine: T[]; message: string } {
  const mine = messages.filter(item => item.source.kind === 'user' || (item.source.kind as string) === 'chat-brief')
  const message = mine.flatMap((item) => {
    const brief = (item.source as { brief?: unknown }).brief
    return typeof brief === 'string' ? [brief] : item.content.map(block => (block.type === 'text' ? block.text : ''))
  }).join('\n').trim()
  return { mine, message }
}

/**
 * What the first model read before it answered: the history up to and
 * including the person's message before the reply.
 * @param session - the session.
 * @param replySeq - the disliked reply's log position.
 * @returns the messages and the ask's words, or undefined when no message of the person's precedes the reply.
 */
export function askBefore(session: SurfaceReader, replySeq: number): { messages: Message[]; ask: string; askSeq: number } | undefined {
  const asked = session.events.findLast(event =>
    event.seq < replySeq && event.type === 'user/message' && (event.data.source.kind === 'user' || (event.data.source.kind as string) === 'chat-brief') && event.surfaceOp === 'append')
  if (asked?.type !== 'user/message') return undefined
  const messages: Message[] = []
  for (const seq of session.surface.nodes) {
    if (seq > asked.seq) break
    const event = session.events[seq]
    const message = event === undefined ? null : session.deriveEventMessage(event)
    if (message !== null) messages.push(message)
  }
  return { messages, ask: textOf(asked.data.content), askSeq: asked.seq }
}

/**
 * What the two runs should cost, read off the disliked reply's own tokens:
 * each alternative reads the same history and writes an answer of about the
 * same length.
 * @param prices - each alternative's price per million tokens.
 * @param usage - the disliked reply's tokens.
 * @returns the sum in US dollars, or `unknown` when a price or the reply's tokens are missing.
 */
export function compareCost(prices: readonly Price[], usage: LastReply['usage']): { amount: number } | { unknown: true } {
  if (usage === undefined) return { unknown: true }
  const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  let amount = 0
  for (const price of prices) {
    if (price === undefined) return { unknown: true }
    if (price === 'free') continue
    amount += (input * price.input + usage.outputTokens * price.output) / 1_000_000
  }
  return { amount }
}

/**
 * The note a kept answer reaches the model as.
 * @param label - the model that wrote it.
 * @param text - the answer.
 * @returns the note's words.
 */
export function keptNote(label: string, text: string): string {
  return `I asked other models to answer my last message and kept this answer, from ${label}. `
    + `Treat it as the answer I was given and carry on from it.\n\n${text}`
}

/** Told to each alternative: it answers once, with no tool to run, so the comparison is of answers. */
export const ANSWER_IN_TEXT = 'Answer the last message in text. No tools can run for this answer, so do not call any.'

/** Everything a comparison has recorded so far. */
export interface CompareState {
  started: RouterCompareEventData
  answers: Array<RouterCompareEventData | undefined>
  /** The alternative kept, -1 for the first answer, undefined while the person decides. */
  picked?: number | undefined
}

/**
 * Fold one comparison's steps.
 * @param events - the session log, oldest first.
 * @param id - the comparison.
 * @returns its state, or undefined when it never started.
 */
export function foldCompare(events: readonly SessionEvent[], id: string): CompareState | undefined {
  let state: CompareState | undefined
  for (const event of events) {
    if (event.type !== 'idealize/router-compare' || event.data.id !== id) continue
    const data = event.data
    if (data.phase === 'started') state = { started: data, answers: (data.alternatives ?? []).map(() => undefined) }
    else if (state !== undefined && data.phase === 'answer' && data.index !== undefined) state.answers[data.index] = data
    else if (state !== undefined && data.phase === 'picked') state.picked = data.index
  }
  return state
}

/**
 * The media model the person kept for a preset, which serves the rest of the
 * chat's generations of that kind.
 * @param events - the session log, oldest first.
 * @param presetId - `images`, `motion` or `sound`.
 * @returns the kept model, or undefined.
 */
export function foldMediaKept(events: readonly SessionEvent[], presetId: string): RouterMediaEventData | undefined {
  const kept = events.findLast(event => event.type === 'idealize/router-media' && event.data.outcome === 'kept' && event.data.presetId === presetId)
  return kept?.type === 'idealize/router-media' ? kept.data : undefined
}

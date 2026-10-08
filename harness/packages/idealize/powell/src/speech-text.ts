/**
 * The text side of Powell's voice: cutting a streaming reply into sentences
 * the moment each one is complete, keeping the spoken budget short, reading
 * the reply's markers (choices and an open target), and picking the instant
 * acknowledgement for a request. Pure functions, so every rule here is
 * pinned by a spec rather than by listening.
 * @module @idealize/powell/speech-text
 */

import { readProjectSwitch } from './switch.ts'

/** The acknowledgement library (latency addendum §1): small on purpose. */
export const ACK_LIBRARY: readonly { id: string; text: string }[] = [
  { id: 'yep', text: 'Yep.' },
  { id: 'got-it', text: 'Got it.' },
  { id: 'sure', text: 'Sure.' },
  { id: 'on-it', text: 'On it.' },
  { id: 'one-sec', text: 'One sec.' },
  { id: 'done', text: 'Done.' },
  { id: 'saved', text: 'Saved.' },
  { id: 'updated', text: 'Updated.' },
  { id: 'found-it', text: 'Found it.' },
  { id: 'which-one', text: 'Which one?' },
  { id: 'try-again', text: 'Try again?' },
  { id: 'listening', text: "I'm listening." },
]

/**
 * Clips safe to play before any work has happened: none of them claims an
 * outcome (addendum §5). `done`, `saved` and `updated` play only as the
 * reply's own words, after the work.
 */
export const PRE_ACTION_ACKS: readonly string[] = ['yep', 'got-it', 'sure', 'on-it', 'one-sec']

/** Sentences Powell speaks per turn unless the person asked for detail. */
export const SPOKEN_BUDGET = 2

/** Sentences Powell may speak when the person asked it to explain. */
export const EXPLAIN_BUDGET = 8

/**
 * Normalise a sentence for matching against the clip library: lower case,
 * curly quotes straightened, trailing punctuation and spaces dropped.
 * @param text - the sentence.
 * @returns the key form.
 */
export function clipKey(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[\s.!?]+$/u, '').trim()
}

/**
 * The cached clip that says exactly this sentence, so it plays with no
 * synthesis at all.
 * @param sentence - one spoken sentence.
 * @returns the clip id, or undefined when live speech is needed.
 */
export function clipFor(sentence: string): string | undefined {
  const key = clipKey(sentence)
  return ACK_LIBRARY.find(clip => clipKey(clip.text) === key)?.id
}

/** Words that open a question or chat rather than an instruction. */
const CONVERSATIONAL_OPENERS = new RegExp('^(what|what\'s|whats|why|how|who|where|when|which|is|are|do|does|did|can you tell|tell me about'
  + '|hi|hello|hey|thanks|thank you|cheers|good (morning|afternoon|evening))\\b', 'i')

/**
 * Whether a request reads as a clear instruction, which earns an instant
 * acknowledgement while the work starts (addendum §5). Questions and chat
 * get none: the answer itself is the first thing Powell says.
 * @param text - the person's message.
 * @returns true for an actionable instruction.
 */
export function isActionable(text: string): boolean {
  const trimmed = text.trim()
  // A bare project switch is answered at once; an acknowledgement would only delay it.
  if (readProjectSwitch(trimmed)?.rest === '') return false
  if (trimmed === '' || trimmed.endsWith('?')) return false
  if (CONVERSATIONAL_OPENERS.test(trimmed)) return false
  return trimmed.split(/\s+/).length >= 2
}

/**
 * Pick the acknowledgement for an instruction. It rotates through the safe
 * set so Powell does not repeat itself every time.
 * @param turn - a counter that advances per request.
 * @returns the clip id.
 */
export function pickAck(turn: number): string {
  return PRE_ACTION_ACKS[Math.abs(turn) % PRE_ACTION_ACKS.length] as string
}

/**
 * Whether the person asked for a longer spoken answer (spec §7: the user can
 * relax the speech budget).
 * @param text - the person's message.
 * @returns true when detail was asked for.
 */
export function wantsDetail(text: string): boolean {
  return /\b(explain|tell me more|in detail|walk me through|read (it|that|this) (out|to me)|talk me through)\b/i.test(text)
}

/** A marker line Powell writes after its spoken line. */
const CHOICES_LINE = /^\s*\[\s*choices?\s*:\s*(.+?)\s*\]\s*$/im
const OPEN_LINE = /^\s*\[\s*open\s*:\s*(.+?)\s*\]\s*$/im

/** What Powell's finished reply carries. */
export interface ParsedReply {
  /** The words shown and spoken, markers removed. */
  text: string
  /** Tap answers from a `[choices: A | B]` line. */
  choices: string[]
  /** A destination from an `[open: path-or-url]` line. */
  open?: string
}

/**
 * Split Powell's reply into its words and its markers.
 * @param reply - the assistant text of the turn's last step.
 * @returns the parsed reply.
 */
export function parseReply(reply: string): ParsedReply {
  let text = reply
  const choicesMatch = CHOICES_LINE.exec(text)
  const choices = choicesMatch === null
    ? []
    : (choicesMatch[1] ?? '').split('|').map(choice => choice.trim()).filter(choice => choice !== '').slice(0, 3)
  if (choicesMatch !== null) text = text.replace(choicesMatch[0], '')
  const openMatch = OPEN_LINE.exec(text)
  const open = openMatch?.[1]?.trim()
  if (openMatch !== null) text = text.replace(openMatch[0], '')
  return { text: tidy(text), choices, ...open === undefined || open === '' ? {} : { open } }
}

/**
 * Plain words for the bubble and the voice: markdown emphasis, headings,
 * bullets, links and code fences removed, whitespace collapsed.
 * @param text - model text.
 * @returns the plain text.
 */
export function tidy(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|no|approx)\.$/i

/**
 * Cuts a streaming reply into complete sentences as they arrive, so the first
 * one can go to synthesis before the model has finished writing (addendum §2).
 * Marker lines never reach the voice.
 */
export class SentenceStream {
  private buffer = ''
  private spoken = 0
  private stopped = false

  /** @param budget - how many sentences may be spoken this turn. */
  constructor(private readonly budget: number = SPOKEN_BUDGET) {}

  /**
   * Add streamed text.
   * @param delta - the next chunk of assistant text.
   * @returns the sentences that became complete, within the budget.
   */
  push(delta: string): string[] {
    if (this.stopped) return []
    this.buffer += delta
    const out: string[] = []
    for (;;) {
      const cut = this.boundary()
      if (cut === -1) break
      const sentence = this.buffer.slice(0, cut)
      this.buffer = this.buffer.slice(cut)
      if (!this.take(sentence, out)) break
    }
    return out
  }

  /**
   * End of the reply: whatever is left is the last sentence.
   * @returns the remaining sentence, within the budget.
   */
  flush(): string[] {
    const out: string[] = []
    if (!this.stopped) void this.take(this.buffer, out)
    this.buffer = ''
    return out
  }

  /**
   * Speak one cut piece, unless it is a marker line or over budget, which
   * stop speech for the turn (the rest is for the screen).
   * @returns false once speech has stopped.
   */
  private take(raw: string, out: string[]): boolean {
    if (/^\s*\[\s*(choices?|open)\s*:/i.test(raw)) {
      this.stopped = true
      return false
    }
    const sentence = tidy(raw)
    if (sentence === '' || !/[\p{L}\p{N}]/u.test(sentence)) return true
    if (this.spoken >= this.budget) {
      this.stopped = true
      return false
    }
    this.spoken += 1
    out.push(sentence)
    return true
  }

  /** Index just past the first complete sentence in the buffer, or -1. */
  private boundary(): number {
    const text = this.buffer
    // A marker line starts at a line break: everything before it is speech.
    const marker = /\n\s*\[\s*(choices?|open)\s*:/i.exec(text)
    const limit = marker === null ? text.length : marker.index
    for (let index = 0; index < limit; index += 1) {
      const char = text[index]
      if (char === '\n' && text.slice(0, index).trim() !== '') return index + 1
      if (char !== '.' && char !== '!' && char !== '?') continue
      const next = text[index + 1]
      // Wait for the character after the stop: "3.5" and "e.g." are not ends.
      if (next === undefined) return -1
      if (!/\s/.test(next)) continue
      if (char === '.' && ABBREVIATIONS.test(text.slice(0, index + 1))) continue
      return index + 1
    }
    // No sentence end before the marker: what precedes it is the last sentence.
    if (marker !== null && marker.index > 0) return marker.index
    return -1
  }
}

/**
 * The Studio event vocabulary: what one durable coordination record carries,
 * the closed set of event kinds, and the wire schema that validates a
 * submitted event. Subtypes are open strings — a reader that meets an unknown
 * subtype treats the event as a plain timeline item.
 */

import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** One Studio event's stable identity, minted by the store on append. */
export type StudioEventId = Branded<'StudioEventId'>

/**
 * Brand a string as a {@link StudioEventId}.
 * @param value - the raw id.
 * @returns the branded id.
 */
export const StudioEventId = (value: string): StudioEventId => value as StudioEventId

/** One project-owned task's stable identity, chosen by the assigning author. */
export type StudioTaskId = Branded<'StudioTaskId'>

/**
 * Brand a string as a {@link StudioTaskId}.
 * @param value - the raw id.
 * @returns the branded id.
 */
export const StudioTaskId = (value: string): StudioTaskId => value as StudioTaskId

/** Every event kind the timeline accepts; the wire refuses anything else. */
export const STUDIO_EVENT_KINDS = [
  'message', 'assignment', 'task-update', 'request', 'decision',
  'handoff', 'delivery', 'synthesis', 'system',
] as const

/** One of {@link STUDIO_EVENT_KINDS}. */
export type StudioEventKind = typeof STUDIO_EVENT_KINDS[number]

/** Links from an event back to its evidence. */
export interface StudioEventSource {
  /** The session id of the thread the event summarises or answers. */
  thread?: string | undefined
  /** An earlier Studio event this one resolves or revises. */
  event?: string | undefined
}

/** What a producer submits; the store adds identity, order and time. */
export interface StudioEventInput {
  /** The project folder the timeline belongs to, resolved by the route. */
  project: string
  /** The authoring participant: a session id, or `user`. */
  author: string
  kind: StudioEventKind
  /** Open refinement of the kind (`new-task`, `blocked`, `needs-input`, …). */
  subtype?: string | undefined
  /** The addressed participant, or the owner an assignment/request names. */
  target?: string | undefined
  /** The task the event belongs to. */
  taskId?: string | undefined
  /** The event's text: a message body, a task goal, a request question. */
  body?: string | undefined
  source?: StudioEventSource | undefined
  /**
   * The producer's logical message id. Appending the same id to the same
   * project again returns the recorded event instead of a duplicate, so a
   * retried delivery cannot bind twice.
   */
  messageId?: string | undefined
  /** Who may read the event. The MVP records every event Studio-wide. */
  visibility?: 'studio' | undefined
}

/** One durable timeline record. */
export interface StudioEvent extends StudioEventInput {
  id: StudioEventId
  /** Per-project monotonic order, 1-based, no gaps. */
  seq: number
  /** ISO-8601 append instant. */
  at: string
  visibility: 'studio'
}

/** Wire schema for one submitted event; the route parses, the service trusts. */
export const studioEventInputSchema = z.object({
  project: z.string().min(1),
  author: z.string().min(1).max(128),
  kind: z.enum(STUDIO_EVENT_KINDS),
  subtype: z.string().min(1).max(64).optional(),
  target: z.string().min(1).max(128).optional(),
  taskId: z.string().min(1).max(128).optional(),
  body: z.string().max(4000).optional(),
  source: z.object({
    thread: z.string().min(1).max(128).optional(),
    event: z.string().min(1).max(128).optional(),
  }).strict().optional(),
  messageId: z.string().min(1).max(128).optional(),
  visibility: z.literal('studio').optional(),
}).strict()

/** Schema of one stored line: the input plus the store-assigned fields. */
export const studioEventSchema = studioEventInputSchema.extend({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  at: z.string().min(1),
  visibility: z.literal('studio'),
})

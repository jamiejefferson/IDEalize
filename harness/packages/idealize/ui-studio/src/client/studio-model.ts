/**
 * The Studio routes' payloads as this pane reads them. Restated from
 * `@idealize/studio`'s wire vocabulary (the client bundle resolves no host
 * package), so a divergence fails here at the JSON boundary rather than
 * silently: every field is re-checked by the tests against a real fold.
 * @module @idealize/ui-studio/client/studio-model
 */

import type { StudioKey } from './locales.ts'

/** A task's execution lane, as the fold serves it. */
export type TaskExecutionState = 'queued' | 'working' | 'waiting' | 'paused' | 'done' | 'failed' | 'cancelled'

/** What another participant must do about a task. */
export type TaskAttention = 'none' | 'needs-input' | 'needs-action' | 'blocked' | 'completion' | 'failure' | 'handoff-ready'

/** One addressed message's delivery state. */
export type DeliveryState = 'queued' | 'delivered' | 'acknowledged' | 'expired'

/** Whether a live root agent currently runs the participant's session. */
export type StudioPresence = 'reachable' | 'unreachable'

/** The open ownership transfer on a task, while one is offered. */
export interface HandoffRow {
  event: string
  from: string
  to: string
  state: 'offered' | 'needs-clarification'
}

/** One project-owned task as `GET /idealize/studio/state` serves it. */
export interface TaskRow {
  id: string
  goal: string
  owner: string
  state: TaskExecutionState
  attention: TaskAttention
  attentionOwner?: string
  requestEvent?: string
  handoff?: HandoffRow
  acknowledgedBy?: string
  acknowledgedAt?: string
  created: string
  createdSeq: number
  updated: string
}

/** One participant's work view. */
export interface AgentViewRow {
  active?: string
  queued: string[]
  displayed?: string
  unresolved: string[]
}

/** The lead's latest published synthesis. */
export interface SynthesisRow {
  event: string
  author: string
  at: string
  body: string
  stale: boolean
}

/** The `GET /idealize/studio/state` payload. */
export interface StateResponse {
  tasks: TaskRow[]
  agents: Record<string, AgentViewRow>
  deliveries: Record<string, DeliveryState>
  synthesis?: SynthesisRow
  presence: Record<string, StudioPresence>
}

/** One timeline record as `GET /idealize/studio/timeline` serves it. */
export interface EventRow {
  id: string
  seq: number
  at: string
  project: string
  author: string
  kind: string
  subtype?: string
  target?: string
  taskId?: string
  body?: string
  source?: { thread?: string; event?: string }
}

/** The `GET /idealize/studio/timeline` payload. */
export interface TimelineResponse {
  events: EventRow[]
  lastSeq: number
}

/** One project's slice of `GET /idealize/studio/overview`. */
export interface ProjectView {
  project: string
  lastSeq: number
  state: StateResponse
  recent: EventRow[]
}

/** The `GET /idealize/studio/overview` payload: every stored project, path order. */
export interface OverviewResponse {
  projects: ProjectView[]
}

/** The pane's bound translate over the `idealize-studio` dictionary. */
export type StudioTranslate = (key: StudioKey, params?: Record<string, string | number>) => string

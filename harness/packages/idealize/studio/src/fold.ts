/**
 * The deterministic project-state view: a pure fold of one timeline into
 * tasks and per-agent work. Unmentioned structured updates change this view
 * and invoke nobody — the fold is how routine status stays cheap.
 *
 * Kinds the fold reads: `assignment`, `task-update`, `request`, `handoff`,
 * `synthesis`, `system`. `message`, `decision` and `delivery` are timeline
 * items (decisions and deliveries still mark the synthesis stale); an
 * unknown subtype under a read kind touches `updated` and nothing else.
 */

import type { StudioEvent, StudioEventId } from './events.ts'

/** What one task is doing. */
export type TaskExecutionState = 'queued' | 'working' | 'waiting' | 'paused' | 'done' | 'failed' | 'cancelled'

/** What another participant must do about it. */
export type TaskAttention = 'none' | 'needs-input' | 'needs-action' | 'blocked' | 'completion' | 'failure' | 'handoff-ready'

/** One addressed message's delivery state, from the system delivery records. */
export type DeliveryState = 'queued' | 'delivered' | 'acknowledged' | 'expired'

/** Kinds whose arrival after a synthesis marks it stale; messages and system records do not. */
const STALING_KINDS: readonly string[] = ['assignment', 'task-update', 'request', 'decision', 'handoff', 'delivery']

/** Execution states that close a task. */
const TERMINAL: readonly TaskExecutionState[] = ['done', 'failed', 'cancelled']

/** Attention a task keeps after closing, until its acknowledgement event. */
const TERMINAL_ATTENTION: readonly TaskAttention[] = ['completion', 'failure']

/** The open ownership transfer, while one is offered. */
export interface StudioHandoff {
  /** The offering event; acceptance and rejection name it in `source.event`. */
  event: StudioEventId
  /** The offering sender, who owns the work until acceptance. */
  from: string
  /** The invited recipient; only its events move the transfer. */
  to: string
  /** `needs-clarification` puts the ball back with the sender. */
  state: 'offered' | 'needs-clarification'
}

/** One project-owned task as the fold sees it. */
export interface StudioTask {
  id: string
  /** The assignment's body; empty when the assignment carried none. */
  goal: string
  owner: string
  /** The assignment's author: who asked for the work. */
  requester: string
  state: TaskExecutionState
  attention: TaskAttention
  /** Who must answer the open request; absent for an unassigned blocker. */
  attentionOwner?: string | undefined
  /** The event whose resolution clears the open request. */
  requestEvent?: StudioEventId | undefined
  /** The open ownership transfer, until accepted, rejected or cancelled. */
  handoff?: StudioHandoff | undefined
  /** Who acknowledged the terminal attention, once someone has. */
  acknowledgedBy?: string | undefined
  /** ISO-8601 instant of that acknowledgement. */
  acknowledgedAt?: string | undefined
  /** ISO-8601 instant of the creating assignment. */
  created: string
  /** The creating assignment's seq: the queue-promotion order. */
  createdSeq: number
  /** ISO-8601 instant of the last event that touched the task. */
  updated: string
}

/** One agent's work, derived from the tasks it owns. */
export interface StudioAgentView {
  /** The one task in `working`/`waiting`/`paused`; earliest-created when the log claims several. */
  active?: string | undefined
  /** Queued task ids, earliest created first. */
  queued: string[]
  /** The chip's routing target: the active task, else the first queued. */
  displayed?: string | undefined
  /** Tasks holding any unresolved attention, earliest created first. */
  unresolved: string[]
}

/** The coordinator's latest published project view, and whether events have moved past it. */
export interface StudioSynthesis {
  /** The publishing event. */
  event: StudioEventId
  author: string
  /** ISO-8601 publish instant. */
  at: string
  body: string
  /** True once any later state-changing event arrives (see STALING_KINDS). */
  stale: boolean
}

/** The folded project state. */
export interface StudioState {
  /** Every task, in creation order. */
  tasks: StudioTask[]
  /** Per-owner work views, keyed by participant. */
  agents: Record<string, StudioAgentView>
  /** Delivery state per addressed message event id; latest record wins. */
  deliveries: Record<string, DeliveryState>
  /** The latest published synthesis, absent until the coordinator publishes one. */
  synthesis?: StudioSynthesis | undefined
}

function touch(task: StudioTask, event: StudioEvent): void {
  task.updated = event.at
}

/**
 * Clear a non-terminal open request. Terminal attention survives everything
 * but its acknowledgement, and an open handoff moves only on handoff events.
 */
function clearOpenRequest(task: StudioTask): void {
  if (TERMINAL_ATTENTION.includes(task.attention) || task.attention === 'handoff-ready') return
  task.attention = 'none'
  task.attentionOwner = undefined
  task.requestEvent = undefined
}

/** Close the open transfer; the offer's attention goes with it. */
function clearHandoff(task: StudioTask): void {
  task.handoff = undefined
  if (task.attention === 'handoff-ready') {
    task.attention = 'none'
    task.attentionOwner = undefined
  }
}

/** The transfer state machine: only the named recipient moves an offer, and acceptance transfers ownership. */
function applyHandoff(tasks: Map<string, StudioTask>, event: StudioEvent): void {
  const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
  if (task === undefined) return
  switch (event.subtype) {
    case 'offered':
      if (TERMINAL.includes(task.state) || event.target === undefined) return
      task.handoff = { event: event.id, from: event.author, to: event.target, state: 'offered' }
      task.attention = 'handoff-ready'
      task.attentionOwner = event.target
      break
    case 'needs-clarification':
      if (task.handoff === undefined || event.author !== task.handoff.to) return
      task.handoff.state = 'needs-clarification'
      task.attentionOwner = task.handoff.from
      break
    case 'accepted':
      if (task.handoff === undefined || event.author !== task.handoff.to) return
      task.owner = task.handoff.to
      clearHandoff(task)
      break
    case 'rejected':
      if (task.handoff === undefined || event.author !== task.handoff.to) return
      clearHandoff(task)
      break
    case 'cancelled':
      // Who may cancel is enforced at the recording operation; the fold obeys.
      if (task.handoff === undefined) return
      clearHandoff(task)
      break
    default:
      // Unknown subtype: a timeline item; `updated` moves below.
      break
  }
  touch(task, event)
}

function applyAssignment(tasks: Map<string, StudioTask>, event: StudioEvent): void {
  if (event.taskId === undefined) return
  const existing = tasks.get(event.taskId)
  if (event.subtype === 'reassign') {
    if (existing === undefined || event.target === undefined) return
    existing.owner = event.target
    touch(existing, event)
    return
  }
  if (existing !== undefined) return
  tasks.set(event.taskId, {
    id: event.taskId,
    goal: event.body ?? '',
    owner: event.target ?? event.author,
    requester: event.author,
    state: 'queued',
    attention: 'none',
    created: event.at,
    createdSeq: event.seq,
    updated: event.at,
  })
}

function applyTaskUpdate(tasks: Map<string, StudioTask>, event: StudioEvent): void {
  const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
  if (task === undefined) return
  const terminal = TERMINAL.includes(task.state)
  switch (event.subtype) {
    case 'working':
    case 'resumed':
    case 'progress':
    case 'summary':
      if (terminal) return
      task.state = 'working'
      clearOpenRequest(task)
      break
    case 'paused':
      if (terminal) return
      task.state = 'paused'
      break
    case 'blocked':
      if (terminal) return
      task.state = 'waiting'
      task.attention = 'blocked'
      task.attentionOwner = event.target
      task.requestEvent = event.id
      break
    case 'done':
      task.state = 'done'
      task.attention = 'completion'
      task.attentionOwner = event.target
      task.requestEvent = undefined
      task.handoff = undefined
      break
    case 'failed':
      task.state = 'failed'
      task.attention = 'failure'
      task.attentionOwner = event.target
      task.requestEvent = undefined
      task.handoff = undefined
      break
    case 'cancelled':
      task.state = 'cancelled'
      task.handoff = undefined
      if (task.attention === 'handoff-ready') task.attention = 'none'
      clearOpenRequest(task)
      break
    default:
      // Unknown subtype: a timeline item; `updated` moves below.
      break
  }
  touch(task, event)
}

function applyRequest(tasks: Map<string, StudioTask>, event: StudioEvent): void {
  const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
  if (task === undefined) return
  if (event.subtype !== 'needs-input' && event.subtype !== 'needs-action') return
  if (TERMINAL.includes(task.state)) return
  task.state = 'waiting'
  task.attention = event.subtype
  task.attentionOwner = event.target
  task.requestEvent = event.id
  touch(task, event)
}

function applySystem(tasks: Map<string, StudioTask>, deliveries: Record<string, DeliveryState>, event: StudioEvent): void {
  switch (event.subtype) {
    case 'resolve-request': {
      const source = event.source?.event
      if (source === undefined) return
      for (const task of tasks.values()) {
        if (task.requestEvent !== source) continue
        if (!TERMINAL.includes(task.state)) task.state = 'working'
        clearOpenRequest(task)
        touch(task, event)
      }
      return
    }
    case 'delivery-queued':
    case 'delivery-delivered':
    case 'delivery-acknowledged':
    case 'delivery-expired': {
      const source = event.source?.event
      if (source === undefined) return
      deliveries[source] = event.subtype.slice('delivery-'.length) as DeliveryState
      return
    }
    case 'acknowledge-delivery':
    case 'acknowledge-failure': {
      const task = event.taskId === undefined ? undefined : tasks.get(event.taskId)
      if (task === undefined) return
      const expected: TaskAttention = event.subtype === 'acknowledge-delivery' ? 'completion' : 'failure'
      if (task.attention !== expected) return
      task.attention = 'none'
      task.attentionOwner = undefined
      task.acknowledgedBy = event.author
      task.acknowledgedAt = event.at
      touch(task, event)
      return
    }
    default:
      return
  }
}

/**
 * Fold one timeline into the deterministic project state.
 * @param events - the project's events, oldest first.
 * @returns tasks in creation order plus per-owner work views.
 */
export function foldStudioState(events: readonly StudioEvent[]): StudioState {
  const tasks = new Map<string, StudioTask>()
  const deliveries: Record<string, DeliveryState> = {}
  let synthesis: StudioSynthesis | undefined
  for (const event of events) {
    if (event.kind === 'synthesis') {
      synthesis = { event: event.id, author: event.author, at: event.at, body: event.body ?? '', stale: false }
    } else if (synthesis !== undefined && !synthesis.stale && STALING_KINDS.includes(event.kind)) {
      synthesis.stale = true
    }
    switch (event.kind) {
      case 'assignment':
        applyAssignment(tasks, event)
        break
      case 'task-update':
        applyTaskUpdate(tasks, event)
        break
      case 'request':
        applyRequest(tasks, event)
        break
      case 'system':
        applySystem(tasks, deliveries, event)
        break
      case 'handoff':
        applyHandoff(tasks, event)
        break
      case 'synthesis':
        // Read above the switch: publishing resets the staleness watch.
        break
      case 'message':
      case 'decision':
      case 'delivery':
        // Timeline items: no state machine reads them yet (module JSDoc).
        break
      default:
        event.kind satisfies never
    }
  }
  const ordered = [...tasks.values()].sort((left, right) => left.createdSeq - right.createdSeq)
  const agents: Record<string, StudioAgentView> = {}
  for (const task of ordered) {
    const view = agents[task.owner] ??= { queued: [], unresolved: [] }
    if (['working', 'waiting', 'paused'].includes(task.state) && view.active === undefined) view.active = task.id
    if (task.state === 'queued') view.queued.push(task.id)
    if (task.attention !== 'none') view.unresolved.push(task.id)
  }
  for (const view of Object.values(agents)) view.displayed = view.active ?? view.queued[0]
  return { tasks: ordered, agents, deliveries, ...synthesis === undefined ? {} : { synthesis } }
}

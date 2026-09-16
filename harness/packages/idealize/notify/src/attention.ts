/**
 * The MVP notification policy: which Studio events interrupt the person with
 * an operating-system alert, and what that alert says. Pure — the host half
 * wires it, the browser half raises it, and neither decides here.
 *
 * The product spec's MVP table has three columns. The Askbar column is the
 * chip's own fold (`@idealize/askbar`'s `chipStateOf` reads the same task
 * attention) and the Studio column is the timeline record itself, which
 * `@idealize/studio` owns; the column nobody owned is the alert, so that is
 * what this module decides. Every row of the table is a {@link PolicyRow},
 * recorded on the ledger so a raised alert names the rule that raised it.
 * @module @idealize/notify/attention
 */

/** The participant id the person holds on a Studio timeline. */
export const USER_PARTICIPANT = 'user'

/** Longest alert body; a longer one is cut and ellipsed. */
const BODY_LIMIT = 160

/** Which row of the spec's MVP table an event matched. */
export type PolicyRow =
  | 'progress'
  | 'mention'
  | 'needs-input'
  | 'needs-action'
  | 'blocked-other'
  | 'blocked-user'
  | 'done'
  | 'failed'
  | 'other'

/** Whether one event interrupts the person, and under which row. */
export interface AlertDecision {
  /** The matched row of the MVP table. */
  row: PolicyRow
  /** True when the row's operating-system column is on for this event. */
  alert: boolean
}

/** The event fields the policy reads; the timeline record carries more. */
export interface PolicyEvent {
  kind: string
  subtype?: string | undefined
  /** The addressed participant, or the owner the event names. */
  target?: string | undefined
  author: string
  body?: string | undefined
}

/** The folded task fields the policy reads, when the event names a task. */
export interface PolicyTask {
  /** Who asked for the work: the assignment's author. */
  requester: string
  goal: string
}

/** Rows whose alert fires only when the event names the person. */
const decideRequest = (subtype: string | undefined, forUser: boolean): AlertDecision => {
  if (subtype !== 'needs-input' && subtype !== 'needs-action') return { row: 'other', alert: false }
  return { row: subtype, alert: forUser }
}

/** Task-update rows: routine progress stays quiet, blockers follow their owner, failure follows who asked. */
const decideTaskUpdate = (
  subtype: string | undefined,
  forUser: boolean,
  task: PolicyTask | undefined,
): AlertDecision => {
  switch (subtype) {
    case 'queued':
    case 'working':
    case 'resumed':
    case 'progress':
      return { row: 'progress', alert: false }
    case 'blocked':
      return forUser ? { row: 'blocked-user', alert: true } : { row: 'blocked-other', alert: false }
    case 'done':
      return { row: 'done', alert: false }
    case 'failed':
      // "On when requested work stopped": the person asked for this task.
      return { row: 'failed', alert: task?.requester === USER_PARTICIPANT }
    default:
      return { row: 'other', alert: false }
  }
}

/**
 * Decide one event against the MVP table.
 * @param event - the recorded Studio event.
 * @param task - the folded task the event names, when it names one.
 * @returns the matched row and whether it raises an operating-system alert.
 */
export function notificationPolicyFor(event: PolicyEvent, task?: PolicyTask): AlertDecision {
  const forUser = event.target === USER_PARTICIPANT
  switch (event.kind) {
    case 'message':
      return { row: forUser ? 'mention' : 'other', alert: forUser }
    case 'request':
      return decideRequest(event.subtype, forUser)
    case 'task-update':
      return decideTaskUpdate(event.subtype, forUser, task)
    case 'assignment':
      return { row: 'progress', alert: false }
    default:
      return { row: 'other', alert: false }
  }
}

/** One alert's words. */
export interface AttentionNotice {
  title: string
  body: string
}

/** Each alerting row's title, over the event's author. */
const TITLES: Record<PolicyRow, (author: string) => string> = {
  mention: author => `${author} mentioned you`,
  'needs-input': author => `${author} needs your input`,
  'needs-action': author => `${author} needs you to act`,
  'blocked-user': author => `${author} is blocked on you`,
  failed: author => `${author} could not finish`,
  // Rows that raise no alert never reach the notice; they answer for the type.
  progress: author => author,
  'blocked-other': author => author,
  done: author => author,
  other: author => author,
}

/**
 * The words one alert carries.
 * @param row - the matched policy row.
 * @param event - the recorded Studio event.
 * @param task - the folded task the event names, when it names one.
 * @returns the alert's title and body; the body falls back to the task's goal.
 */
export function attentionNotice(row: PolicyRow, event: PolicyEvent, task?: PolicyTask): AttentionNotice {
  const text = event.body !== undefined && event.body !== '' ? event.body : task?.goal ?? ''
  const body = text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT - 1).trimEnd()}…` : text
  return { title: TITLES[row](event.author), body }
}

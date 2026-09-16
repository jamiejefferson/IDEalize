/**
 * Every line the bot sends. Kept in one module so the wording is reviewed in
 * one place and the routers stay free of copy.
 * @module @idealize/telegram/format
 */

import { basename } from 'node:path'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { STUDIO_PROJECT, type StudioChatPost, type StudioOverviewProject, type TaskExecutionState } from '@idealize/studio'
import type { PairingClaim } from './pairing.ts'
import { nameOf, type Keyboard, type RosterRow } from './ports.ts'

/** The reply to `/help`, `/start` and any unknown command. */
export const HELP_TEXT = [
  'Send a message and the Studio coordinator gets it, as if you typed it in the Studio chat. Start with @name to reach one agent directly.',
  '/status shows what is running, what is waiting for you, and the open tasks.',
  '/agents lists every agent.',
  '/stop name stops a running agent. It keeps its queued messages.',
].join('\n\n')

/** Replies to `/pair <code>`, by outcome. */
export const PAIR_REPLIES: Readonly<Record<PairingClaim, string>> = {
  paired: 'Paired. This chat now directs IDEalize while the app is open. Send /help to see what it can do.',
  'no-code': 'No pairing code is waiting. Open Settings in IDEalize and choose Pair to get one.',
  expired: 'That code has expired. Choose Pair in IDEalize Settings for a new one.',
  wrong: 'That code does not match the one IDEalize is showing.',
}

/** Lines the update router sends. */
export const INBOUND_TEXT = {
  stale: 'IDEalize was closed when you sent this, so nothing happened. Send it again.',
  noStudio: 'The Studio is not running in this app, so the message has nowhere to go.',
  stopWho: 'Say which agent to stop, for example /stop Ada.',
  notRunning: (name: string): string => `${name} is not running.`,
  confirmStop: (name: string): string => `Stop ${name}? It keeps its queued messages.`,
  stopButton: 'Stop',
  keepButton: 'Keep running',
  stopped: (name: string): string => `Stopped ${name}.`,
  keptRunning: 'Left running.',
} as const

/** Button labels and toasts for approvals and questions. */
export const ANSWER_TEXT = {
  allow: 'Allow once',
  deny: 'Deny',
  allowed: 'Allowed',
  denied: 'Denied',
  already: 'Already answered in the app.',
  gone: 'No longer waiting.',
  typeIt: 'Type your answer as a message.',
  answered: 'Answered.',
  cancelled: 'Withdrawn before anyone answered.',
  other: 'Other (type it)',
  done: 'Done',
} as const

const OPEN_STATE_WORDS: Readonly<Partial<Record<TaskExecutionState, string>>> = {
  queued: 'queued',
  working: 'working',
  waiting: 'waiting',
  paused: 'paused',
}

/**
 * The name a person knows a project by.
 * @param project - the timeline key.
 * @returns `Studio` for the Studio's own timeline, else the folder name.
 */
export function projectName(project: string): string {
  return project === STUDIO_PROJECT ? 'Studio' : basename(project)
}

/**
 * The approval request message.
 * @param name - who asks.
 * @param toolName - the tool it wants to run.
 * @param reason - why the tool needs approval, when the ask gives one.
 * @returns the message text.
 */
export function approvalText(name: string, toolName: string, reason?: string): string {
  return reason === undefined || reason === '' ? `${name} wants to run ${toolName}.` : `${name} wants to run ${toolName}.\n${reason}`
}

/**
 * The approval message once settled.
 * @param name - who asked.
 * @param toolName - the tool.
 * @param outcome - how it settled.
 * @returns the replacement text.
 */
export function approvalOutcomeText(name: string, toolName: string, outcome: string): string {
  if (outcome === 'allowed-once') return `Allowed: ${name} runs ${toolName}.`
  if (outcome === 'rejected') return `Denied: ${name} does not run ${toolName}.`
  return `Withdrawn: ${name} no longer needs ${toolName}.`
}

/**
 * One question's message.
 * @param name - who asks.
 * @param item - the question.
 * @param index - its position, from 0.
 * @param total - how many questions the request holds.
 * @returns the message text.
 */
export function questionText(name: string, item: AskUserQuestionItem, index: number, total: number): string {
  const options = item.options ?? []
  const lines = [
    `${name} asks${total > 1 ? ` (${index + 1} of ${total})` : ''}:`,
    ...item.header === undefined ? [] : [item.header],
    item.question,
    ...item.detail === undefined ? [] : [item.detail],
    ...options.filter(option => option.description !== undefined).map(option => `• ${option.label}: ${option.description as string}`),
  ]
  if (options.length === 0) lines.push('Reply with your answer.')
  else if (item.multiSelect === true) lines.push('Tick every answer that applies, then choose Done.')
  return lines.join('\n')
}

/**
 * One question's buttons: one row per option, then Other, then Done on a
 * multi-select question. A question with no options has no buttons; the
 * next message answers it.
 * @param short - the relay's id for the request.
 * @param item - the question.
 * @param selected - options already ticked.
 * @returns the keyboard rows.
 */
export function questionKeyboard(short: string, item: AskUserQuestionItem, selected: readonly string[]): Keyboard {
  const options = item.options ?? []
  if (options.length === 0) return []
  return [
    ...options.map((option, index) => [{ text: `${selected.includes(option.label) ? '✓ ' : ''}${option.label}`, data: `q:${short}:${index}` }]),
    [
      { text: ANSWER_TEXT.other, data: `q:${short}:other` },
      ...item.multiSelect === true ? [{ text: ANSWER_TEXT.done, data: `q:${short}:done` }] : [],
    ],
  ]
}

/**
 * The reply to `/status`.
 * @param overview - every project's folded state.
 * @param roster - every agent.
 * @param waiting - approvals and questions on the phone.
 * @returns the message text.
 */
export function statusText(overview: readonly StudioOverviewProject[], roster: readonly RosterRow[], waiting: number): string {
  const running = roster.filter(row => row.running)
  const lines = [running.length === 0 ? 'Nothing is running.' : `Running: ${running.map(row => nameOf(roster, row.id)).join(', ')}.`]
  if (waiting > 0) lines.push(`Waiting for you: ${waiting} ${waiting === 1 ? 'approval or question' : 'approvals or questions'}.`)
  const open = overview.flatMap(project => project.state.tasks
    .filter(task => OPEN_STATE_WORDS[task.state] !== undefined)
    .map(task => `• ${task.goal === '' ? 'Untitled task' : task.goal} (${nameOf(roster, task.owner)}, ${projectName(project.project)}): ${OPEN_STATE_WORDS[task.state] as string}${task.attention === 'none' ? '' : `, ${task.attention.replace('-', ' ')}`}`))
  lines.push(open.length === 0 ? 'No open tasks.' : ['Open tasks:', ...open].join('\n'))
  return lines.join('\n\n')
}

/**
 * The reply to `/agents`.
 * @param roster - every agent.
 * @returns the message text.
 */
export function agentsText(roster: readonly RosterRow[]): string {
  if (roster.length === 0) return 'No agents yet.'
  return roster
    .map(row => `• ${nameOf(roster, row.id)}${row.name !== undefined && row.label !== row.name ? ` (${row.label})` : ''}: ${row.running ? 'running' : 'idle'}`)
    .join('\n')
}

/**
 * What to tell the person after a message is posted to the Studio. A plain
 * delivery to the coordinator needs no reply, because its answer follows.
 * @param post - where the post landed.
 * @param roster - every agent, for names.
 * @returns the reply, or undefined when none is needed.
 */
export function chatPostReply(post: StudioChatPost, roster: readonly RosterRow[]): string | undefined {
  switch (post.kind) {
    case 'delivered': {
      const queued = post.delivery === 'queued'
      if (post.project === STUDIO_PROJECT) return queued ? 'Queued. The Studio coordinator reads it when it is free.' : undefined
      const name = nameOf(roster, post.target)
      return queued ? `Queued for ${name}. Their chat is closed, so it waits until it opens.` : `Sent to ${name}.`
    }
    case 'no-coordinator':
      return `The Studio coordinator could not start, so the message was not sent. ${post.reason}`
    case 'unresolved':
      return post.names.length === 0
        ? `Nobody called @${post.token} is here.`
        : `Nobody called @${post.token} is here. Try one of: ${post.names.join(', ')}.`
  }
}

/**
 * A coordinator post.
 * @param name - the author.
 * @param body - the post.
 * @returns the message text.
 */
export function studioPostText(name: string, body: string): string {
  return `${name}: ${body}`
}

/**
 * A task ending on a project timeline.
 * @param words - how the Studio says the task ended.
 * @param project - the timeline key.
 * @param goal - the task's goal, when known.
 * @param outcome - the outcome the agent gave.
 * @returns the message text.
 */
export function taskEndingText(words: string, project: string, goal: string | undefined, outcome: string): string {
  const head = `${words}${goal === undefined || goal === '' ? '' : `: ${goal}`} (${projectName(project)})`
  return outcome === '' ? head : `${head}\n${outcome}`
}

/**
 * A Studio attention alert.
 * @param title - the alert title.
 * @param body - the alert detail.
 * @returns the message text.
 */
export function alertText(title: string, body: string): string {
  return body === '' ? title : `${title}\n${body}`
}

/**
 * An agent error.
 * @param name - the agent, when the error names a session.
 * @param detail - the error message.
 * @returns the message text.
 */
export function errorText(name: string | undefined, detail: string): string {
  const head = `${name ?? 'An agent'} hit an error.`
  return detail === '' ? head : `${head}\n${detail}`
}

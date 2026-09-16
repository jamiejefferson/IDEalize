/**
 * The command-surface wire: request and response fields, the rung ladder,
 * the body caps, and the generated status line. Mirrors V0's IPCProtocol so
 * the agent guides written against `idealize <command>` keep working.
 */

/** Every command the surface accepts; deferred V0 commands are absent on purpose. */
export type CommCommand =
  | 'ping'
  | 'list'
  | 'notify'
  | 'send'
  | 'inbox'
  | 'peek'
  | 'rung'
  | 'board'
  | 'spawn'
  | 'post'
  | 'chat'
  | 'transcript'
  | 'setStatus'
  | 'focus'
  | 'reveal'
  | 'task'
  | 'progress'
  | 'blocked'
  | 'need'
  | 'done'
  | 'studio'
  | 'handoff'
  | 'accept'
  | 'reject'
  | 'decide'
  | 'synthesis'

/** Every command the wire accepts; `parseRequest` refuses anything else. */
export const COMM_COMMANDS: readonly CommCommand[] = [
  'ping', 'list', 'notify', 'send', 'inbox', 'peek', 'rung', 'board',
  'spawn', 'post', 'chat', 'transcript', 'setStatus', 'focus', 'reveal',
  'task', 'progress', 'blocked', 'need', 'done', 'studio', 'handoff', 'accept', 'reject', 'decide', 'synthesis',
]

/** One request, JSON over `POST /idealize/comm`. Field names match V0's IPCRequest. */
export interface CommRequest {
  command: CommCommand
  /** The calling session's id, from the shell's `DSH_SESSION_ID` (else `IDEALIZE_SESSION_ID`). */
  from?: string
  target?: string
  body?: string
  title?: string
  sound?: boolean
  open?: boolean
  limit?: number
  name?: string
  path?: string
  model?: string
  piece?: string
  rung?: string
  blocker?: string
  /** spawn: start (or surface) the project's coordinator instead of a worker. */
  coordinator?: boolean
  /**
   * spawn: start (or surface) the one Studio coordinator instead of a worker.
   * It belongs to no project, so `path` is ignored and none is required.
   */
  studio?: boolean
  /** progress/blocked/need/done: the Studio task the report belongs to. */
  task?: string
  /** blocked/need: who owes the response; absent leaves a blocker unassigned, and `need` defaults to the user. */
  owner?: string
  /** need: ask for an approval or external operation rather than information. */
  action?: boolean
}

/** One mailbox message. */
export interface CommMessage {
  from: string
  fromLabel?: string
  body: string
  /** ISO-8601 instant. */
  timestamp: string
  piece?: string
  rung?: string
  blocker?: string
}

/** Where one piece of work stands, as last reported by its chat. */
export interface CommRung {
  piece: string
  rung: string
  blocker: string
  note?: string
  session: string
  sessionLabel?: string
  projectPath?: string
  /** ISO-8601 instant. */
  updated: string
}

/** One Q/A pair of a chat's transcript. */
export interface CommExchange {
  index: number
  question: string
  answer?: string
}

/** One session as `list` reports it. */
export interface CommSessionInfo {
  id: string
  /** The chat's agent name, once assigned. */
  name?: string
  /** The task: the brief-derived or user-given title, or the role label. */
  title: string
  projectPath?: string
  status?: string
  unread: number
  /** The chat's comm role; `chat` for an ordinary chat with none. */
  role: 'project-agent' | 'studio-agent' | 'chat'
  /** True while an agent runs a turn; an idle live chat and a stored one both read false. */
  running: boolean
  /** True while an agent holds the session in this app run; false for a stored session only persistence knows. */
  live: boolean
}

/** One Studio task as `studio` reports it: the fold's row plus roster labels. */
export interface StudioTaskRow {
  id: string
  goal: string
  owner: string
  /** The owner's agent name (or title), when the roster knows the session. */
  ownerLabel?: string
  state: string
  attention: string
  attentionOwner?: string
  attentionOwnerLabel?: string
  /** ISO-8601 instant of the last event that touched the task. */
  updated: string
}

/** The response envelope; `ok: false` carries `error`. */
export interface CommResponse {
  ok: boolean
  error?: string
  info?: string
  warning?: string
  sessions?: CommSessionInfo[]
  messages?: CommMessage[]
  exchanges?: CommExchange[]
  rungs?: CommRung[]
  tasks?: StudioTaskRow[]
  /** studio: the latest published synthesis, when one exists. */
  synthesis?: { body: string; stale: boolean; at: string }
}

/** Body and note caps plus the rung grammar (V0's `Wire`). */
export const Wire = {
  maxBodyCharacters: 800,
  maxNoteCharacters: 160,
  truncationNote: '…[truncated — the wire carries rungs, not stories]',
  rungs: ['being-made', 'preview', 'saved', 'checked', 'combined', 'live', 'confirmed', 'closed'] as readonly string[],
  blockers: ['none', 'stuck', 'waiting-on-coordinator', 'waiting-on-user'] as readonly string[],

  /** Flatten a note to one line and cut it at the note cap on a word boundary. */
  clampNote(note: string): string {
    const flat = note.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '').join(' ')
    if (flat.length <= Wire.maxNoteCharacters) return flat
    const cut = flat.slice(0, Wire.maxNoteCharacters)
    const space = cut.lastIndexOf(' ')
    return `${space > 0 ? cut.slice(0, space) : cut}…`
  },

  /** Cut a message body at the body cap, appending the truncation note. */
  clamp(body: string): { text: string; truncated: boolean } {
    if (body.length <= Wire.maxBodyCharacters) return { text: body, truncated: false }
    return { text: `${body.slice(0, Wire.maxBodyCharacters)}\n${Wire.truncationNote}`, truncated: true }
  },

  /** Lower-case, trimmed, spaces to hyphens: the rung and blocker spelling. */
  normalise(word: string): string {
    return word.trim().toLowerCase().replaceAll(' ', '-')
  },

  /** The one status line every chat reports with, generated so the grammar cannot drift. */
  statusLine(input: { project?: string; piece: string; rung: string; blocker: string; session?: string; note?: string }): string {
    let line = ''
    if (input.project !== undefined && input.project !== '') line += `[${input.project}] `
    line += `${input.piece} → ${input.rung}`
    if (input.session !== undefined && input.session !== '') line += ` (${input.session})`
    line += ` — blocker: ${input.blocker}`
    if (input.note !== undefined && input.note !== '') line += ` — ${input.note}`
    return line
  },
} as const

/** Told to the sender: the next message only gets shorter if its author hears this. */
export const TRUNCATION_WARNING = `Message trimmed at ${Wire.maxBodyCharacters} characters. The wire carries rungs, `
  + 'blockers and questions — one line each. Use `idealize rung` for status, and point '
  + 'at the board instead of retelling it.'

const NAME_LIMIT = 32

/**
 * A chat name read off a task brief: the first non-empty line, stripped of
 * heading or list decoration, cut at the first sentence end when what is left
 * still says something, capped at 32 characters on a word boundary, and
 * sentence-cased unless the word is deliberately styled ("iOS").
 * @param task - the brief.
 * @returns the name, or undefined for a blank brief.
 */
export function chatNameFromTask(task: string): string | undefined {
  let s = task.split(/\r?\n/).map(line => line.trim()).find(line => line !== '')
  if (s === undefined) return undefined
  s = s.replace(/^[#*_\-–—•>·. \t]+/, '').replace(/[#*_\-–—•>·. \t]+$/, '')
  const stop = s.search(/[.!?;:]/)
  if (stop >= 0) {
    const head = s.slice(0, stop).trim()
    if (head.length >= 12) s = head
  }
  if (s === '') return undefined
  if (s.length > NAME_LIMIT) {
    let cut = s.slice(0, NAME_LIMIT)
    const space = cut.lastIndexOf(' ')
    if (space >= 14) cut = cut.slice(0, space)
    s = `${cut.trim()}…`
  }
  const first = s.charAt(0)
  const second = s.charAt(1)
  if (first !== first.toUpperCase() && second === second.toLowerCase()) {
    s = first.toUpperCase() + s.slice(1)
  }
  return s
}

/**
 * Format a mailbox timestamp as the CLI prints it.
 * @param iso - the message's ISO timestamp.
 * @returns `HH:mm:ss` in local time.
 */
export function clockTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

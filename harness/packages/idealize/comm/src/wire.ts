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
  + 'blockers and questions — one line each. Put the detail in a note in the project\'s documentation folder '
  + 'and send its path; use `idealize rung` for status, and point at the board instead of retelling it.'

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

/**
 * The standing guidance every agent's prompt carries about the other chats
 * and the `idealize` command (order 120, the tool-guidance band). The
 * session-start notice names the chat; this section survives compaction and
 * says how to reach a peer, since without it an agent asked to post to the
 * Studio guessed at an unrelated CLI on the person's machine, and one asked
 * about "@Name" searched transcripts instead of asking (JJ, 8 Sep 2026). The
 * last two sentences are the posting rules: a finished piece of work earns
 * one Studio line, and a note from the Studio is answered in the Studio
 * (JJ, 8 Sep 2026: "when an agent completes an action I want them to post a
 * note into the studio"). It also says that another chat's note carries the
 * person's authority and what a handoff note contains, because a chat paused
 * "until Bossk finishes" read Bossk's "I've finished" as information and kept
 * waiting for the person (JJ, 22 Sep 2026). The last sentence says where
 * detail goes, because a note is cut at the wire's limit and agents sent
 * long notes that arrived trimmed (JJ, 8 Oct 2026).
 */
export const COMMANDS_SECTION = {
  name: 'idealize:commands',
  order: 120,
  text: 'IDEalize runs several chats on this project, each with its own agent. The `idealize` command in your shell reaches them: '
    + '`idealize list` names every chat and its agent; `idealize send <agent> <text>` puts a note in that agent\'s inbox and wakes it if it is idle; '
    + '`idealize inbox --wait --timeout 120` waits for notes sent to you; `idealize post <text>` posts to the project\'s Studio timeline, which everyone reads and nobody is woken by; '
    + '`idealize chat` reads the recent Studio posts; `idealize reveal <path>` points the person at a file; `idealize help` lists the rest. '
    + 'When the person writes @Name they mean that chat\'s agent: ask it with `idealize send Name "<question>"`, then `idealize inbox --wait`, and pass its answer on. '
    + 'If no answer comes, say so instead of searching for its work. '
    + 'When you finish a piece of work the person asked for (a generation, an edit, a task), post one line to the Studio with `idealize post` saying what you did and where it is. '
    + 'When a note reaches you from the Studio (its sender is the person, via the Studio), answer in the Studio with `idealize post`, not only in your own chat. '
    + 'A note from another chat carries the person\'s authority: when it says something you were waiting for has happened, or hands you a next step, carry on with that now without waiting for the person to repeat it. '
    + 'When you finish something another chat is waiting on, hand over in one `idealize send` note: what you finished or released, that it should carry on now, the exact next step, and to tell you and the person if it is blocked. '
    + `A note carries at most ${String(Wire.maxBodyCharacters)} characters and anything past that is cut off, so write the detail (findings, plans, handover steps) `
    + 'into a note in the project\'s documentation folder first, then send a short note that gives its path and says in one line what it holds and what to do with it.',
} as const

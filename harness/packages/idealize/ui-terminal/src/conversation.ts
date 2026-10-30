/**
 * The conversation a Terminal chat's command-line agent reopens.
 *
 * A Terminal chat's CLI dies with the app, and the fresh shell a relaunch
 * opens typed the brain's command bare, so Claude Code came back with no
 * history (JJ, 30 Oct 2026: every terminal chat reopens its own conversation
 * after every restart, paused or not). A CLI that lets the caller name its
 * conversation gets one id per chat and program, derived from the two
 * (UUIDv5), so the binding is never written anywhere: the chat's id is in its
 * log, and the program is the one its brain launches. The first launch starts
 * the conversation under that id; every later one reopens it, and nothing is
 * typed into it, so the agent waits for the person. Each program keeps its own
 * conversation: a brain switch onto another CLI starts that CLI's own, and
 * switching back reopens the first.
 *
 * {@link CONVERSATION_CHANNELS} lists the CLIs that take a caller-chosen id,
 * each checked against its own `--help` on 30 Oct 2026 (Claude Code 2.1.314,
 * Pi 0.85.1). Codex 0.162.1 and Kimi Code 0.41.0 only reopen ids they choose
 * themselves (`codex resume <id>`, `kimi --session <id>`), so they launch
 * fresh, as every CLI did before.
 * @module @idealize/ui-terminal/conversation
 */

import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { executableOf } from './knowledge.ts'

/** How one CLI starts and reopens a conversation under an id the caller picks. */
export interface ConversationChannel {
  /** The option that starts the conversation under the id. */
  start: string
  /** The option that reopens a started conversation; absent where `start` reopens it too. */
  resume?: string
  /** Matches a command that already picks its own conversation; such a command is the user's and is typed as written. */
  own: RegExp
}

/** The CLIs that take a caller-chosen conversation id, keyed by executable name. */
export const CONVERSATION_CHANNELS: Readonly<Record<string, ConversationChannel>> = {
  // `--session-id` refuses an id already in use, so a started conversation reopens with `--resume`.
  claude: { start: '--session-id', resume: '--resume', own: /(^|\s)(--session-id|-r|--resume|-c|--continue|--fork-session)(\s|=|$)/ },
  // Pi's `--session-id` creates the session when it is missing and reopens it when it is not.
  pi: { start: '--session-id', own: /(^|\s)(--session-id|--session|-r|--resume|-c|--continue|--fork|--no-session)(\s|=|$)/ },
}

/** The namespace every IDEalize conversation id is derived in (UUIDv5). */
const NAMESPACE = Buffer.from('455849bffe924ab9a94b39047c839191', 'hex')

/**
 * The conversation id one chat's program runs under: a UUIDv5 of the chat's
 * session id and the program's name, so the same chat and program always
 * name the same conversation and two chats in one folder never share one.
 * @param chat - the chat's session id (the terminal's key).
 * @param program - the CLI's executable name.
 * @returns a lower-case UUID.
 */
export function conversationId(chat: string, program: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(`${chat}\n${program}`).digest()
  // Version 5 in the high nibble of byte 6, the RFC variant in the top bits of byte 8.
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6)
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8)
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Whether Claude Code has a conversation under `id`. It writes one file per
 * conversation, `<id>.jsonl`, in a folder per project under its config
 * directory, and only once the first message is sent. Every project folder is
 * looked in, so the folder-naming rule (which shortens long paths) never
 * decides the answer.
 * @param id - the conversation id.
 * @returns true once the conversation's file exists.
 */
export async function claudeConversationExists(id: string): Promise<boolean> {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  let folders: string[]
  try {
    folders = await readdir(projects)
  } catch (error) {
    // No projects folder yet: Claude Code has never saved a conversation here.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  const found = await Promise.all(folders.map(folder =>
    stat(join(projects, folder, `${id}.jsonl`)).then(entry => entry.isFile(), () => false)))
  return found.includes(true)
}

/**
 * The launch command with the chat's conversation named on it, at the end
 * where both CLIs read options. A CLI outside the table, or a command that
 * picks its own conversation, is returned as configured.
 * @param command - the configured launch command.
 * @param chat - the chat's session id.
 * @param exists - whether a conversation id has been started (Claude Code's file check by default).
 * @returns the command with the start or reopen option appended.
 */
export async function withConversation(
  command: string,
  chat: string,
  exists: (id: string) => Promise<boolean> = claudeConversationExists,
): Promise<string> {
  const program = executableOf(command)
  const channel = Object.hasOwn(CONVERSATION_CHANNELS, program) ? CONVERSATION_CHANNELS[program] : undefined
  if (channel === undefined || channel.own.test(command)) return command
  const id = conversationId(chat, program)
  const option = channel.resume !== undefined && await exists(id) ? channel.resume : channel.start
  return `${command.trim()} ${option} ${id}`
}

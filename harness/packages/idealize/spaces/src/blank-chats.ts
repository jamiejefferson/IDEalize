/**
 * The one-time clean-up of blank chats. A new chat writes a log as soon as its
 * preset is chosen, whether or not anyone ever types in it, and nothing removed
 * them: on one Mac, 177 of 269 chats, every one re-read on every session list.
 *
 * Blank does not mean empty of work. A Terminal chat's prompts go straight to
 * its command-line agent, so its log stays blank for life, and any chat can show
 * its Terminal face without recording a space. So a chat moves only when
 * everything agrees it was never used, and anything unrecognised keeps it. It
 * moves to a dated folder inside the sessions folder, whole, and nothing is
 * erased: moving the folder back restores it.
 * @module @idealize/spaces/blank-chats
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { deriveSpace } from './space-table.ts'

const DAY_MS = 86_400_000

/** A log bigger than this holds more than a chat's opening records. */
const MAX_BLANK_LOG_BYTES = 1024 * 1024

/**
 * Everything a chat records before anyone types in it, read from a real new
 * chat's log. Any other event keeps the chat, so a kind of event added later
 * errs towards keeping. The inbox event has its own test below.
 */
const BEFORE_FIRST_PROMPT: ReadonlySet<string> = new Set([
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
  'idealize/agent-name',
  'agent-preset/selected',
  'idealize/space',
  'idealize/brain',
])

/**
 * The first day every new chat in another space recorded that space (the spaces
 * arrived on 26 August 2026). A log from before then that records no space could
 * be a Terminal chat, so it stays.
 */
const SPACES_RECORDED_FROM = Date.UTC(2026, 7, 27)

/** The one inbox event a new chat has: the notice telling it its name. A prompt or a note from another chat keeps it. */
function isNameNotice(event: SessionEvent): boolean {
  const data = event.data as { target?: unknown; removedCount?: unknown; inserted?: unknown }
  if (data.target !== 'next-step' || (data.removedCount ?? 0) !== 0 || !Array.isArray(data.inserted)) return false
  return data.inserted.every((item: { source?: { kind?: unknown; plugin?: unknown; summary?: unknown } }) =>
    item.source?.kind === 'plugin' && item.source.plugin === 'idealize-comm' && item.source.summary === 'Agent name')
}

function isOpeningRecord(event: SessionEvent): boolean {
  return event.type === 'agent/inbox/spliced' ? isNameNotice(event) : BEFORE_FIRST_PROMPT.has(event.type)
}

/** What the clean-up asks of the session store. */
export interface BlankChatStore {
  list(): Promise<readonly SessionHeader[]>
  readFrom(id: SessionId, fromSeq: number): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>
  locate(meta: SessionHeader): { path: string } | undefined
}

/**
 * Whether a log says this chat was never used.
 * @param session - the header and events.
 * @param now - the current time.
 * @returns true only for a top-level Chat-space chat over a day old holding nothing but opening records.
 */
export function logSaysBlank(session: { header: SessionHeader; events: readonly SessionEvent[] }, now: number): boolean {
  const { header, events } = session
  if (now - header.createdAt < DAY_MS) return false
  if (header.parentSession !== undefined || (header.delegationDepth ?? 0) !== 0 || header.origin !== undefined) return false
  if (!events.every(isOpeningRecord)) return false
  const spaces = events.filter(event => event.type === 'idealize/space').map(event => (event.data as { space?: unknown }).space)
  if (spaces.some(space => space !== 'chat')) return false
  if (spaces.length === 0 && header.createdAt < SPACES_RECORDED_FROM) return false
  // A media preset marks a Gallery, Sound Stage or Video chat, whatever else it says.
  const presets = [
    header.agentPreset,
    ...events.filter(event => event.type === 'agent-preset/selected').map(event => (event.data as { agentPreset?: string }).agentPreset),
  ]
  return presets.every(agentPreset => deriveSpace({ space: undefined, agentPreset }) === 'chat')
}

/**
 * The conversation id a chat's Terminal runs a program under. This must stay
 * equal to `conversationId` in `@idealize/ui-terminal`; a test holds them
 * together, and this package cannot import that one.
 */
export function terminalConversationId(chat: string, program: string): string {
  const namespace = Buffer.from('455849bffe924ab9a94b39047c839191', 'hex')
  const hash = createHash('sha1').update(namespace).update(`${chat}\n${program}`).digest()
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6)
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8)
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Every file name one level inside each folder of `root`; nothing when `root` is absent. */
async function namesOneLevelDown(root: string): Promise<Set<string>> {
  const names = new Set<string>()
  let folders: string[]
  try {
    folders = await readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return names
    throw error
  }
  for (const folder of folders) {
    const inside = await readdir(join(root, folder)).catch(() => [] as string[])
    for (const name of inside) names.add(name)
  }
  return names
}

/**
 * Whether anything outside the log shows this chat has been used in a Terminal:
 * a conversation of Claude Code's or Pi's under the chat's id, or a knowledge file for a Terminal still open.
 */
function usedInTerminal(id: string, seen: { claude: Set<string>; pi: Set<string> }, knowledge: Set<string>): boolean {
  if (seen.claude.has(`${terminalConversationId(id, 'claude')}.jsonl`)) return true
  const pi = terminalConversationId(id, 'pi')
  for (const name of seen.pi) if (name.includes(pi)) return true
  return knowledge.has(`${id.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.md`)
}

/**
 * Move every blank chat aside, once. A marker file records the run; a run that
 * cannot look everywhere it should moves nothing and writes no marker.
 * @param options.store - the session store.
 * @param options.isLive - whether a chat is open in this run.
 * @param options.home - the app's data folder.
 * @param options.userHome - where Claude Code and Pi keep their conversations.
 * @param options.now - the current time.
 * @param options.log - where to say what happened.
 * @returns the chat ids moved, or undefined when this already ran.
 */
export async function setAsideBlankChats(options: {
  store: BlankChatStore
  isLive: (id: SessionId) => boolean
  home: string
  userHome?: string
  claudeDir?: string
  now: number
  log: (message: string) => void
}): Promise<string[] | undefined> {
  const marker = join(options.home, 'idealize', 'blank-chats-set-aside.json')
  if (await stat(marker).then(() => true, () => false)) return undefined

  const userHome = options.userHome ?? homedir()
  const seen = {
    claude: await namesOneLevelDown(join(options.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(userHome, '.claude'), 'projects')),
    pi: await namesOneLevelDown(join(userHome, '.pi', 'agent', 'sessions')),
  }
  const knowledge = new Set(await readdir(join(options.home, 'idealize', 'terminal-knowledge')).catch(() => [] as string[]))
  const headers = await options.store.list()
  const parents = new Set(headers.flatMap(header => header.parentSession === undefined ? [] : [String(header.parentSession)]))

  const day = new Date(options.now).toISOString().slice(0, 10)
  const moved: string[] = []
  for (const header of headers) {
    try {
      const path = options.store.locate(header)?.path
      if (path === undefined || options.isLive(header.id) || parents.has(String(header.id))) continue
      const log = await stat(path)
      if (log.size > MAX_BLANK_LOG_BYTES || options.now - log.mtimeMs < DAY_MS) continue
      const dir = dirname(path)
      // Anything beside the log is something a blank chat would not have.
      if ((await readdir(dir)).length !== 1) continue
      const { events } = await options.store.readFrom(header.id, 0)
      if (!logSaysBlank({ header, events }, options.now)) continue
      if (usedInTerminal(String(header.id), seen, knowledge)) continue
      const project = dirname(dir)
      const to = join(dirname(project), `.blank-chats-${day}`, basename(project), basename(dir))
      await mkdir(dirname(to), { recursive: true, mode: 0o700 })
      // Checked again last: opening a chat happens outside this loop.
      if (options.isLive(header.id)) continue
      await rename(dir, to)
      moved.push(String(header.id))
    } catch (error) {
      // A chat that cannot be judged or moved stays where it is.
      options.log(`idealize-spaces: left chat ${String(header.id)} in place: ${String(error)}`)
    }
  }
  await mkdir(dirname(marker), { recursive: true, mode: 0o700 })
  await writeFile(marker, JSON.stringify({ at: options.now, folder: `.blank-chats-${day}`, moved }, null, 2), { encoding: 'utf8', mode: 0o600 })
  if (moved.length > 0) options.log(`idealize-spaces: moved ${String(moved.length)} blank chats to .blank-chats-${day} in the sessions folder`)
  return moved
}

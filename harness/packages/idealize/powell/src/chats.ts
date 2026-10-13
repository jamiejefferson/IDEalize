/**
 * Which IDEalize chat Powell hands a project's work to, and which projects
 * are open in IDEalize right now. Pure, so both rest on the roster alone.
 *
 * Powell used to find the chat itself by grepping `idealize list` for the
 * project's name, and on 13 Oct 2026 it sent JJ's DocLeaf notes to the first
 * match: a chat closed since 8 Oct, where nobody saw them. The host now names
 * the chat in Powell's live context, so the model never guesses.
 * @module @idealize/powell/chats
 */

/** One chat from the `idealize` roster, as Powell reads it. */
export interface ChatRow {
  id: string
  name?: string
  label: string
  /** The chat's working folder. */
  cwd?: string
  /** `chat`, `project-agent` (a project's coordinator) or `studio-agent`. */
  role: string
  running: boolean
  /** Whether the chat is open in IDEalize (its agent is live). */
  open: boolean
  /** When the chat last did anything, in ms; 0 when unknown. */
  lastActive: number
}

/** The chat a project's requests go to, and why that one. */
export interface ProjectChat {
  chat: ChatRow
  /** `coordinator` when it is the project's coordinator, else `open chat`. */
  kind: 'coordinator' | 'open chat'
}

/**
 * Whether a chat works inside one of a project's folders.
 * @param cwd - the chat's working folder.
 * @param folders - the project's working folder and notes folder.
 * @returns true when the chat sits in or under one of them.
 */
export function inProject(cwd: string | undefined, folders: readonly (string | undefined)[]): boolean {
  if (cwd === undefined || cwd === '') return false
  const here = trimSlash(cwd)
  return folders.some((folder) => {
    if (folder === undefined || folder === '') return false
    const root = trimSlash(folder)
    return here === root || here.startsWith(`${root}/`)
  })
}

/**
 * The chat Powell sends a project's requests to: the project's coordinator
 * when it is open, else the project's most recently active open chat.
 * Closed chats never qualify, because a message there waits unseen.
 * @param chats - the roster.
 * @param folders - the project's working folder and notes folder.
 * @param self - Powell's own session id, never chosen.
 * @returns the chat, or undefined when the project has no open chat.
 */
export function projectChat(chats: readonly ChatRow[], folders: readonly (string | undefined)[], self?: string): ProjectChat | undefined {
  const open = chats
    .filter(chat => chat.open && chat.id !== self && chat.role !== 'studio-agent' && inProject(chat.cwd, folders))
    .sort((a, b) => b.lastActive - a.lastActive)
  const coordinator = open.find(chat => chat.role === 'project-agent')
  if (coordinator !== undefined) return { chat: coordinator, kind: 'coordinator' }
  const first = open[0]
  return first === undefined ? undefined : { chat: first, kind: 'open chat' }
}

/**
 * The projects open in IDEalize: every registered project with at least one
 * open chat, the most recently active first.
 * @param chats - the roster.
 * @param projects - IDEalize's registered projects (sidebar order).
 * @param self - Powell's own session id, whose home folder is no project.
 * @returns the open projects.
 */
export function openProjects(
  chats: readonly ChatRow[],
  projects: readonly { name: string; path: string }[],
  self?: string,
): { name: string; path: string }[] {
  const latest = new Map<string, number>()
  for (const project of projects) {
    for (const chat of chats) {
      if (!chat.open || chat.id === self || chat.role === 'studio-agent' || !inProject(chat.cwd, [project.path])) continue
      latest.set(project.path, Math.max(latest.get(project.path) ?? 0, chat.lastActive))
    }
  }
  return projects
    .filter(project => latest.has(project.path))
    .sort((a, b) => (latest.get(b.path) ?? 0) - (latest.get(a.path) ?? 0))
}

/**
 * The context lines that tell Powell where a project's requests go.
 * @param target - the project's chat, when one is open.
 * @param folder - the folder a coordinator would start in.
 * @returns the lines, each starting with two spaces.
 */
export function chatLines(target: ProjectChat | undefined, folder: string | undefined): string[] {
  if (target === undefined) {
    if (folder === undefined || folder === '') return ['  - Project chat: none open in IDEalize.']
    return [
      '  - Project chat: none open in IDEalize. Before handing over work, start the project\'s coordinator with',
      `    \`idealize spawn --coordinator --path "${folder}"\` and send to the id it prints.`,
    ]
  }
  const who = target.chat.name ?? target.chat.label
  const what = target.kind === 'coordinator' ? 'the project\'s coordinator' : 'the project\'s most recent open chat'
  return [`  - Project chat: ${who} (${target.chat.id}), ${what}, open in IDEalize. Hand this project's work there with \`idealize send ${target.chat.id} "<request>"\`.`]
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

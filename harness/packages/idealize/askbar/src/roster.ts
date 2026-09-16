/**
 * Pure roster assembly: join comm's chat listing, the project board's
 * blockers and the Studio fold into the bar's chip rows, for one project
 * ({@link assembleChips}) or for every project the listing names
 * ({@link assembleGroups}). IO-free so the join is testable without a
 * composed host.
 * @module @idealize/askbar/src/roster
 */

import type { StudioState } from '@idealize/studio'
import { chipStateOf, type ChipBlocker } from './chip-state.ts'
import { projectDisplayName } from './project-name.ts'
import type { AskbarChip, AskbarRosterGroup } from './types.ts'

/** comm's `list` row, structurally (no package dependency on comm). */
export interface CommListRow {
  /** The chat's session id. */
  id: string
  /** The drawn agent name, when one exists. */
  name?: string | undefined
  /** The chat's title. */
  title: string
  /** The chat's project folder, when it has one. */
  projectPath?: string | undefined
  /** The free-text status label, when set. */
  status?: string | undefined
  /** Unread mailbox messages. */
  unread: number
  /** The chat's comm role. */
  role: 'project-agent' | 'studio-agent' | 'chat'
  /** Whether the agent runs a turn right now. */
  running: boolean
  /** Whether an agent holds the session in this app run. */
  live: boolean
}

/** comm's board row, structurally: one piece's rung state. */
export interface CommBoardRow {
  /** The session that owns the rung. */
  session: string
  /** The rung's blocker. */
  blocker: ChipBlocker
}

/**
 * The comm rows a roster covers: the requested sessions in their requested
 * order (a session comm does not list — the Studio chat, a session comm has
 * not seen — contributes no chip), else every row of the project folder.
 */
function rowsOf(project: string, sessions: readonly CommListRow[], only: readonly string[] | undefined): CommListRow[] {
  if (only === undefined) return sessions.filter(row => row.projectPath === project)
  const byId = new Map(sessions.map(row => [row.id, row]))
  return only.flatMap((id) => {
    const row = byId.get(id)
    return row === undefined ? [] : [row]
  })
}

/**
 * Join the sources into chip rows for one project.
 * @param project - the resolved project folder.
 * @param sessions - comm's global listing.
 * @param board - the project board's rung rows.
 * @param studio - the Studio fold, or undefined when no Studio plugin is composed.
 * @param only - the sessions to cover, in order (the bar sends the sidebar's rows); absent covers every comm chat
 * whose `projectPath` is the project.
 * @param workingTerminals - session ids whose terminal CLI is working; a terminal agent runs no harness
 * agent, so `running` alone would read every busy shell as idle.
 * @returns one chip per covered chat.
 */
export function assembleChips(
  project: string,
  sessions: readonly CommListRow[],
  board: readonly CommBoardRow[],
  studio: StudioState | undefined,
  only?: readonly string[],
  workingTerminals: ReadonlySet<string> = new Set(),
): AskbarChip[] {
  return rowsOf(project, sessions, only)
    .map((row) => {
      const blockers = board.filter(rung => rung.session === row.id).map(rung => rung.blocker)
      const running = row.running || workingTerminals.has(row.id)
      const displayedId = studio?.agents[row.id]?.displayed
      const task = displayedId === undefined ? undefined : studio?.tasks.find(candidate => candidate.id === displayedId)
      return {
        id: row.id,
        name: row.name ?? row.title,
        title: row.title,
        role: row.role,
        running,
        unread: row.unread,
        state: chipStateOf({
          running,
          live: row.live,
          blockers,
          execution: task?.state,
          attention: task?.attention,
        }),
        task: task?.goal ?? null,
        status: row.status ?? null,
      }
    })
}

/**
 * Join the sources into one group per project among the requested rows, in
 * the order the rows name them: the first row of each project opens its
 * group, so the rail's groups follow the sidebar's project order and hold the
 * sidebar's rows and no other. A row comm does not list contributes nothing.
 * @param only - the sidebar's rows, in order.
 * @param sessions - comm's global listing.
 * @param board - every project's rung rows (comm's board with no path).
 * @param folds - each project's Studio fold, keyed by project folder.
 * @param workingTerminals - session ids whose terminal CLI is working.
 * @returns one group per project the rows name, in first-named order.
 */
export function assembleGroupsOf(
  only: readonly string[],
  sessions: readonly CommListRow[],
  board: readonly CommBoardRow[],
  folds: ReadonlyMap<string, StudioState>,
  workingTerminals: ReadonlySet<string> = new Set(),
): AskbarRosterGroup[] {
  const byId = new Map(sessions.map(row => [row.id, row]))
  const idsByProject = new Map<string, string[]>()
  for (const id of only) {
    const project = byId.get(id)?.projectPath
    if (project === undefined || project === '') continue
    const ids = idsByProject.get(project)
    if (ids === undefined) idsByProject.set(project, [id])
    else ids.push(id)
  }
  return [...idsByProject].map(([project, ids]) => ({
    project,
    name: projectDisplayName(project),
    chips: assembleChips(project, sessions, board, folds.get(project), ids, workingTerminals),
  }))
}

/**
 * Join the sources into one group per project the listing names. The sidebar
 * rail renders every project's agents at once, so this covers each project
 * with its own board rows and its own fold rather than the active one alone.
 * @param sessions - comm's global listing.
 * @param board - every project's rung rows (comm's board with no path).
 * @param folds - each project's Studio fold, keyed by project folder.
 * @param workingTerminals - session ids whose terminal CLI is working.
 * @returns one group per project holding at least one chat, in project-path order.
 */
export function assembleGroups(
  sessions: readonly CommListRow[],
  board: readonly CommBoardRow[],
  folds: ReadonlyMap<string, StudioState>,
  workingTerminals: ReadonlySet<string> = new Set(),
): AskbarRosterGroup[] {
  const projects = [...new Set(sessions
    .map(row => row.projectPath)
    .filter((path): path is string => path !== undefined && path !== ''))].sort()
  // Every project here came from a row's own `projectPath`, so each covers at
  // least the row that named it.
  return projects.map(project => ({
    project,
    name: projectDisplayName(project),
    chips: assembleChips(project, sessions, board, folds.get(project), undefined, workingTerminals),
  }))
}

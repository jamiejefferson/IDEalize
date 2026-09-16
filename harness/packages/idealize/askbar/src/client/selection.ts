/**
 * Which chats the bar shows: the main sidebar's rows for the current project,
 * read from the same two client stores the sidebar reads. Pure, so the rule
 * is testable without a composed runtime.
 * @module @idealize/askbar/src/client/selection
 */

/** The session list fields the selection reads (the client runtime's `SessionListState`, structurally). */
export interface SelectionSessions {
  /** The current session, when one is selected. */
  current: string | undefined
  /** Host-list order. */
  ids: readonly string[]
  /** One row per session. */
  byId: Readonly<Record<string, SelectionSessionRow | undefined>>
}

/** The per-session fields the selection reads (`SessionSummary`, structurally). */
export interface SelectionSessionRow {
  /** The session's project folder, when it has one. */
  cwd?: string | undefined
  /** Subagent children never list. */
  origin?: 'subagent' | undefined
  /** An empty log. A blank chat is the sidebar's provisional New Session row; a blank terminal is a shell the sidebar lists. */
  blank: boolean
  /** The host projections the sidebar reads (a merge-extensible map; this package reads the `space` key alone). */
  projectionValues?: Readonly<Record<string, unknown>> | undefined
  /** Last activity, for the most-recent fallback. */
  updatedAt: number
}

/** The workspace list fields the selection reads (`WorkspaceListState`, structurally). */
export interface SelectionWorkspaces {
  /** Every workspace in display order. */
  items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[]
  /** The registry-global archive set. */
  archivedSessionIds: readonly string[]
}

/**
 * The sidebar's persisted view (ui-workspace's view store): the order per
 * account and the activity it last saw, a workspace's rows under its id and
 * the rows outside every workspace under {@link LOOSE_ROWS_KEY}. Read by
 * {@link readSidebarOrder}; an account without an entry keeps its stored order
 * (a workspace) or newest-first order (the loose rows), as the sidebar does.
 */
export interface SidebarOrder {
  /** `manual` keeps the persisted order; `updated` (the default) promotes rows touched since the last sync. */
  orderBy?: 'manual' | 'updated' | undefined
  /** The persisted row order per account. */
  sessionOrderByAccount?: Readonly<Record<string, readonly string[] | undefined>> | undefined
  /** Per account, each row's `updatedAt` when the sidebar last synced the order. */
  sessionUpdatedAtByAccount?: Readonly<Record<string, Readonly<Record<string, number | undefined>> | undefined>> | undefined
}

/** The {@link SidebarOrder} account of the rows outside every workspace (ui-workspace's `UNGROUPED_KEY`). */
export const LOOSE_ROWS_KEY = ''

/** The rows a group shows before its "Show n more" control (ui-workspace's `COLLAPSED_SESSION_LIMIT`). */
export const GROUP_ROW_LIMIT = 5

/** The bar's read key: the project folder and the sessions it shows, in sidebar order. */
export interface RosterSelection {
  /** The project folder, or '' when no project exists yet. */
  project: string
  /** The visible sessions of that project, in the sidebar's order. */
  sessionIds: readonly string[]
}

/** The bar's explicit empty state. */
export const NO_SELECTION: RosterSelection = { project: '', sessionIds: [] }

/**
 * The sidebar's visibility rule for one row (ui-workspace `sessionVisible`):
 * no subagent children, no archived sessions, no provisional New Session row
 * unless it is the current chat, and no Studio chat, which the sidebar shows
 * as its pinned card and the rail as its own entry. A blank terminal stays:
 * the sidebar lists it under its agent's name, and comm names it, so the bar
 * addresses it like any other chat.
 */
function visible(
  row: SelectionSessionRow | undefined,
  archived: ReadonlySet<string>,
  id: string,
  current: string | undefined,
): row is SelectionSessionRow {
  if (row === undefined || row.origin === 'subagent' || archived.has(id)) return false
  const space = spaceOf(row)
  if (space === 'studio') return false
  return !row.blank || space === 'terminal' || id === current
}

/**
 * The space projection of a row, when the host has published one. The key is
 * declared by `@idealize/spaces`, which this package does not import, so the
 * value is read as the map's `unknown`.
 */
function spaceOf(row: SelectionSessionRow): string | undefined {
  const space = row.projectionValues?.['space']
  return typeof space === 'object' && space !== null && typeof (space as { space?: unknown }).space === 'string' ? (space as { space: string }).space : undefined
}

/**
 * Pick the project the bar follows and its visible sessions.
 *
 * The project is the current session's workspace; without a current session,
 * the workspace of the most recently touched session; without any, the first
 * workspace. A current session outside every workspace (the sidebar's
 * Ungrouped bucket) shows the ungrouped sessions sharing its folder.
 * @param sessions - the client runtime's session list snapshot.
 * @param workspaces - the client runtime's workspace list snapshot.
 * @returns the project and its sessions, or {@link NO_SELECTION} when no project exists yet.
 */
export function selectRoster(sessions: SelectionSessions, workspaces: SelectionWorkspaces): RosterSelection {
  const archived = new Set(workspaces.archivedSessionIds)
  const workspaceOf = (id: string) => workspaces.items.find(item => item.sessionIds.includes(id))
  const members = (item: { path: string; sessionIds: readonly string[] }): RosterSelection => ({
    project: item.path,
    sessionIds: item.sessionIds.filter(id => visible(sessions.byId[id], archived, id, sessions.current)),
  })
  /** The visible rows in host-list order, each with its id. */
  const rows = sessions.ids.flatMap((id) => {
    const row = sessions.byId[id]
    return visible(row, archived, id, sessions.current) ? [{ id, row }] : []
  })

  const current = sessions.current
  if (current !== undefined) {
    const home = workspaceOf(current)
    if (home !== undefined) return members(home)
    const cwd = sessions.byId[current]?.cwd
    if (cwd !== undefined) {
      const accounted = new Set(workspaces.items.flatMap(item => item.sessionIds))
      return {
        project: cwd,
        sessionIds: rows.filter(({ id, row }) => !accounted.has(id) && row.cwd === cwd).map(({ id }) => id),
      }
    }
  }

  const accountedRows = rows.flatMap(({ id, row }) => {
    const home = workspaceOf(id)
    return home === undefined ? [] : [{ row, home }]
  })
  const latest = accountedRows.sort((a, b) => b.row.updatedAt - a.row.updatedAt)[0]
  if (latest !== undefined) return members(latest.home)
  const first = workspaces.items[0]
  return first === undefined ? NO_SELECTION : members(first)
}

/**
 * Every row the expanded sidebar shows, in its order: each project's first
 * {@link GROUP_ROW_LIMIT} rows in the order the sidebar renders for that
 * project, then the first {@link GROUP_ROW_LIMIT} rows outside every project.
 * The rendered order is the persisted one with the sidebar's own promotion
 * applied: under `updated` ordering a row touched since the sidebar last
 * synced moves to the front, newest first, which is what the sidebar does the
 * moment it mounts. The project is the one {@link selectRoster} would follow,
 * which the panel and the Studio request still name as context.
 *
 * Both rails read this, so the collapsed sidebar, the floating bar and the
 * expanded sidebar show one set of agents (JJ, 13 Sep 2026: "the agents that
 * show in the three sidebar states are all still different").
 * @param sessions - the client runtime's session list snapshot.
 * @param workspaces - the client runtime's workspace list snapshot.
 * @param view - the sidebar's persisted view.
 * @returns the current project with the rows the sidebar shows, or {@link NO_SELECTION} when no project exists yet.
 */
export function selectEverything(sessions: SelectionSessions, workspaces: SelectionWorkspaces, view: SidebarOrder = {}): RosterSelection {
  const own = selectRoster(sessions, workspaces)
  if (own === NO_SELECTION) return NO_SELECTION
  const archived = new Set(workspaces.archivedSessionIds)
  const shown = (id: string) => visible(sessions.byId[id], archived, id, sessions.current)
  const accounted = new Set<string>()
  const sessionIds: string[] = []
  for (const item of workspaces.items) {
    for (const id of item.sessionIds) accounted.add(id)
    sessionIds.push(...rendered(item.sessionIds.filter(shown), item.workspaceId, sessions, view).slice(0, GROUP_ROW_LIMIT))
  }
  const loose = sessions.ids.filter(id => !accounted.has(id) && shown(id))
  sessionIds.push(...rendered(loose, LOOSE_ROWS_KEY, sessions, view).slice(0, GROUP_ROW_LIMIT))
  return { project: own.project, sessionIds }
}

/**
 * One account's rows as the sidebar renders them (ui-workspace
 * `reconciledSessionOrder` then `nextSessionOrderAccount`): the persisted
 * order first and the rest in account order; under `updated` ordering the
 * rows touched since the last sync lead, newest first, and an account never
 * synced is wholly newest first.
 */
function rendered(ids: readonly string[], account: string, sessions: SelectionSessions, view: SidebarOrder): readonly string[] {
  const stored = view.sessionOrderByAccount?.[account]
  const order = ordered(ids, stored)
  if ((view.orderBy ?? 'updated') !== 'updated') return order
  if (stored === undefined) return newestFirst(ids, sessions)
  const seen = view.sessionUpdatedAtByAccount?.[account] ?? {}
  const promoted = newestFirst(ids.filter((id) => {
    const at = seen[id]
    return at === undefined || (sessions.byId[id]?.updatedAt ?? Number.NEGATIVE_INFINITY) > at
  }), sessions)
  if (promoted.length === 0) return order
  const lead = new Set(promoted)
  return [...promoted, ...order.filter(id => !lead.has(id))]
}

/** The sidebar's reconciliation of an account with its persisted order: persisted ids first, then the rest in account order. */
function ordered(ids: readonly string[], stored: readonly string[] | undefined): readonly string[] {
  if (stored === undefined) return ids
  const members = new Set(ids)
  const included = new Set<string>()
  const result: string[] = []
  for (const id of stored) {
    if (!members.has(id) || included.has(id)) continue
    result.push(id)
    included.add(id)
  }
  return [...result, ...ids.filter(id => !included.has(id))]
}

/** Newest update first with the id as the tie-break (ui-workspace `compareSessionRecency`). */
function newestFirst(ids: readonly string[], sessions: SelectionSessions): readonly string[] {
  const at = (id: string) => sessions.byId[id]?.updatedAt ?? Number.NEGATIVE_INFINITY
  return [...ids].sort((a, b) => at(a) !== at(b) ? at(b) - at(a) : a < b ? -1 : 1)
}

/**
 * Whether two selections read the same roster.
 * @param a - one selection.
 * @param b - the other.
 * @returns true when the project and the session list match.
 */
export function sameSelection(a: RosterSelection, b: RosterSelection): boolean {
  return a.project === b.project
    && a.sessionIds.length === b.sessionIds.length
    && a.sessionIds.every((id, index) => id === b.sessionIds[index])
}

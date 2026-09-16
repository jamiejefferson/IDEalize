// The bar's selection: the sidebar's rows for the current project — workspace
// membership in stored order, archived, subagent and blank rows dropped — the
// current session's workspace first, then the most recently touched, then the
// first workspace, and the ungrouped fallback for a stray current session.
import { describe, expect, it } from 'vitest'
import { GROUP_ROW_LIMIT, LOOSE_ROWS_KEY, NO_SELECTION, sameSelection, selectEverything, selectRoster, type SelectionSessions, type SelectionWorkspaces } from '../src/client/selection.ts'

const SESSIONS: SelectionSessions = {
  current: undefined,
  ids: ['s-blank', 's-fox', 's-juno', 's-nova', 's-old', 's-child', 's-rye', 's-stray-a', 's-stray-b'],
  byId: {
    's-blank': { cwd: '/work/demo', blank: true, updatedAt: 90 },
    's-fox': { cwd: '/work/demo', blank: true, projectionValues: { space: { space: 'terminal' } }, updatedAt: 45 },
    's-juno': { cwd: '/work/demo', blank: false, updatedAt: 50 },
    's-nova': { cwd: '/work/demo', blank: false, updatedAt: 40 },
    's-old': { cwd: '/work/demo', blank: false, updatedAt: 10 },
    's-child': { cwd: '/work/demo', origin: 'subagent', blank: false, updatedAt: 60 },
    's-rye': { cwd: '/work/other', blank: false, updatedAt: 70 },
    's-stray-a': { cwd: '/tmp/loose', blank: false, updatedAt: 5 },
    's-stray-b': { cwd: '/tmp/loose', blank: false, updatedAt: 4 },
    's-studio': { cwd: '/work/demo', blank: false, projectionValues: { space: { space: 'studio' } }, updatedAt: 3 },
  },
}

const WORKSPACES: SelectionWorkspaces = {
  items: [
    { workspaceId: 'ws-demo', path: '/work/demo', sessionIds: ['s-nova', 's-juno', 's-fox', 's-old', 's-child', 's-blank', 's-gone', 's-studio'] },
    { workspaceId: 'ws-other', path: '/work/other', sessionIds: ['s-rye'] },
  ],
  archivedSessionIds: ['s-old'],
}

describe('selectRoster', () => {
  it('lists the current session’s workspace in its stored order, without archived, subagent, blank or unknown rows', () => {
    expect(selectRoster({ ...SESSIONS, current: 's-juno' }, WORKSPACES)).toEqual({ project: '/work/demo', sessionIds: ['s-nova', 's-juno', 's-fox'] })
  })

  it('follows the current session to its workspace', () => {
    expect(selectRoster({ ...SESSIONS, current: 's-rye' }, WORKSPACES)).toEqual({ project: '/work/other', sessionIds: ['s-rye'] })
    // The current blank row selects its workspace and lists, as the sidebar's New Session row does.
    expect(selectRoster({ ...SESSIONS, current: 's-blank' }, WORKSPACES)).toEqual({ project: '/work/demo', sessionIds: ['s-nova', 's-juno', 's-fox', 's-blank'] })
  })

  it('falls back to the most recently touched accounted session without a current one', () => {
    expect(selectRoster(SESSIONS, WORKSPACES).project).toBe('/work/other')
    // An archived or subagent recency never wins; a current id the list does not know reads as none.
    expect(selectRoster({ ...SESSIONS, current: 's-unknown' }, WORKSPACES).project).toBe('/work/other')
  })

  it('shows the ungrouped sessions sharing a stray current session’s folder', () => {
    expect(selectRoster({ ...SESSIONS, current: 's-stray-b' }, WORKSPACES)).toEqual({ project: '/tmp/loose', sessionIds: ['s-stray-a', 's-stray-b'] })
  })

  it('falls back to the first workspace, then to the explicit empty state', () => {
    const quiet: SelectionSessions = { current: undefined, ids: [], byId: {} }
    expect(selectRoster(quiet, WORKSPACES)).toEqual({ project: '/work/demo', sessionIds: [] })
    expect(selectRoster(quiet, { items: [], archivedSessionIds: [] })).toBe(NO_SELECTION)
    // A stray current session without a folder falls through the same way.
    expect(selectRoster({ current: 's-x', ids: ['s-x'], byId: { 's-x': { blank: false, updatedAt: 1 } } }, { items: [], archivedSessionIds: [] })).toBe(NO_SELECTION)
  })
})

describe('selectEverything', () => {
  it('lists every project’s rows newest first before the sidebar persists an order, then the loose rows, under the current project', () => {
    // demo's rows, other's row, then the two loose chats; the Studio chat is
    // the pinned card's, never a row, and the blank rows are not current.
    expect(selectEverything({ ...SESSIONS, current: 's-rye' }, WORKSPACES)).toEqual({
      project: '/work/other',
      sessionIds: ['s-juno', 's-fox', 's-nova', 's-rye', 's-stray-a', 's-stray-b'],
    })
  })

  it('keeps the persisted order under manual ordering, unlisted rows after it in account order', () => {
    const view = { orderBy: 'manual' as const, sessionOrderByAccount: { 'ws-demo': ['s-juno', 's-gone', 's-fox', 's-fox'], [LOOSE_ROWS_KEY]: ['s-stray-b'] } }
    expect(selectEverything({ ...SESSIONS, current: 's-rye' }, WORKSPACES, view).sessionIds)
      .toEqual(['s-juno', 's-fox', 's-nova', 's-rye', 's-stray-b', 's-stray-a'])
  })

  it('promotes the rows touched since the sidebar last synced, newest first, under updated ordering', () => {
    const view = {
      orderBy: 'updated' as const,
      sessionOrderByAccount: { 'ws-demo': ['s-nova', 's-juno', 's-fox'], [LOOSE_ROWS_KEY]: ['s-stray-b', 's-stray-a'] },
      // nova and fox were touched since the sync (fox is unknown to it); juno was not.
      sessionUpdatedAtByAccount: { 'ws-demo': { 's-nova': 30, 's-juno': 50 }, [LOOSE_ROWS_KEY]: { 's-stray-a': 5, 's-stray-b': 4 } },
    }
    expect(selectEverything({ ...SESSIONS, current: 's-rye' }, WORKSPACES, view).sessionIds)
      .toEqual(['s-fox', 's-nova', 's-juno', 's-rye', 's-stray-b', 's-stray-a'])
  })

  it('shows a group’s first rows only, as the sidebar does before Show more', () => {
    const ids = Array.from({ length: GROUP_ROW_LIMIT + 2 }, (_, i) => `s-${i}`)
    const sessions: SelectionSessions = {
      current: undefined,
      ids,
      byId: Object.fromEntries(ids.map((id, i) => [id, { cwd: '/work/many', blank: false, updatedAt: 100 - i }])),
    }
    const workspaces: SelectionWorkspaces = { items: [{ workspaceId: 'ws-many', path: '/work/many', sessionIds: ids }], archivedSessionIds: [] }
    expect(selectEverything(sessions, workspaces).sessionIds).toEqual(ids.slice(0, GROUP_ROW_LIMIT))
  })

  it('lists the current blank chat as the sidebar’s New Session row', () => {
    expect(selectEverything({ ...SESSIONS, current: 's-blank' }, WORKSPACES).sessionIds).toContain('s-blank')
    expect(selectEverything({ ...SESSIONS, current: 's-rye' }, WORKSPACES).sessionIds).not.toContain('s-blank')
  })

  it('reads the same rows whichever chat is current, so two windows agree', () => {
    const fromDemo = selectEverything({ ...SESSIONS, current: 's-juno' }, WORKSPACES)
    const fromOther = selectEverything({ ...SESSIONS, current: 's-rye' }, WORKSPACES)
    expect(fromDemo.sessionIds).toEqual(fromOther.sessionIds)
    expect(fromDemo.project).toBe('/work/demo')
    expect(fromOther.project).toBe('/work/other')
  })

  it('is the explicit empty state when no project exists yet', () => {
    expect(selectEverything({ current: undefined, ids: [], byId: {} }, { items: [], archivedSessionIds: [] })).toBe(NO_SELECTION)
  })
})

describe('sameSelection', () => {
  it('compares the project and the ordered rows', () => {
    expect(sameSelection({ project: '/a', sessionIds: ['1', '2'] }, { project: '/a', sessionIds: ['1', '2'] })).toBe(true)
    expect(sameSelection({ project: '/a', sessionIds: ['1', '2'] }, { project: '/a', sessionIds: ['2', '1'] })).toBe(false)
    expect(sameSelection({ project: '/a', sessionIds: [] }, { project: '/b', sessionIds: [] })).toBe(false)
    expect(sameSelection({ project: '/a', sessionIds: ['1'] }, { project: '/a', sessionIds: ['1', '2'] })).toBe(false)
  })
})

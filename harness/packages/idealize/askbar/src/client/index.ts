/**
 * @idealize/askbar — browser half: one rail, two homes. In the desktop
 * shell's Askbar window (the `dsh-desktop-mode=askbar` marker) the floating
 * home takes the root slot at priority -1 (single slots render their
 * lowest-priority registrant, the same shadowing the fork uses elsewhere), so
 * the bar replaces the whole app frame. In every other window the in-window
 * home registers into the main sidebar's `sidebar.rail` seat, which the shell
 * renders while the column is collapsed, so the collapsed sidebar and the
 * floating bar show the same rail. Both homes read one store: it polls the
 * roster route for every row the expanded sidebar lists, grouped by project
 * in the sidebar's order, hurries on host-bridge SSE events, and follows the
 * session and workspace stores live. One set of agents in all three states
 * (JJ, 13 Sep 2026): the expanded sidebar is the reference, and a rail in
 * either home shows exactly its rows.
 * @module @idealize/askbar/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the `ctx.locale` service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the `sidebar.rail` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { startAskbarStore, type AskbarStore, type AskbarStoreOptions, type AskbarView } from './askbar-store.ts'
import { AskbarRoot, type AskbarRootInjected } from './AskbarRoot.tsx'
import { en, NS, zh } from './locales.ts'
import { selectEverything } from './selection.ts'
import { readCurrentSession, readSidebarOrder } from './sidebar-order.ts'
import { SidebarRail, type SidebarRailInjected } from './SidebarRail.tsx'
import { requestStudio } from './studio-request.ts'

export { STATE_LABEL_KEYS } from './Chip.tsx'
export { AskbarRoot } from './AskbarRoot.tsx'
export type { AskbarRootInjected, AskbarRootProps } from './AskbarRoot.tsx'
export { OWL_SRC, Rail } from './Rail.tsx'
export type { RailHome, RailProps } from './Rail.tsx'
export { SidebarRail } from './SidebarRail.tsx'
export type { SidebarRailInjected, SidebarRailProps } from './SidebarRail.tsx'
export { LOOSE_ROWS_KEY, NO_SELECTION, sameSelection, selectEverything, selectRoster } from './selection.ts'
export { CURRENT_SESSION_KEY, readCurrentSession, readSidebarOrder, SIDEBAR_VIEW_KEY } from './sidebar-order.ts'
export type { RosterSelection, SelectionSessionRow, SelectionSessions, SelectionWorkspaces } from './selection.ts'
export { OPEN_STUDIO_EVENT, onStudioRequest, requestStudio } from './studio-request.ts'
export type { AskbarKey } from './locales.ts'

/** Services the bar reads. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * The keybind catalogue (restated; `@idealize/ui-tour` owns it). The rail is
 * the list the shortcut walks, so the rail registers what walking it does;
 * without the tour plugin the rail simply carries no shortcut.
 */
interface KeybindsLike {
  register(binding: {
    id: string
    group: string
    label: string
    chords: readonly { key: string; modifiers: readonly ('ctrl' | 'alt' | 'shift' | 'meta')[] }[]
    run: () => void
    order?: number
  }): () => void
}

/**
 * Register the rail: the floating home when this renderer is the Askbar
 * window, the sidebar home otherwise.
 * @param ctx - browser Cordis context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-askbar: dictionaries')

  // The main window's persisted selection wins over this page's own, so the
  // floating bar lists the New Session row the sidebar lists.
  const current = () => {
    const sessions = ctx.sessions.list.getSnapshot()
    const current = readCurrentSession() ?? sessions.current
    return selectEverything({ ...sessions, current }, ctx.workspaces.list.getSnapshot(), readSidebarOrder())
  }

  /**
   * Start the store on the sidebar's rows and keep it on them until stopped.
   * The read asks for every project grouped, so the rail carries the same
   * rows the expanded sidebar does; the current project rides along as the
   * panel's and the Studio request's context. The floating bar is its own
   * page, so the sidebar's order reaches it through the storage event the
   * main window's writes raise.
   * @param options - what the reads ask for beyond the selection.
   */
  const follow = (options: AskbarStoreOptions = { allProjects: true }): { store: AskbarStore; stop: () => void } => {
    const { store, select, stop } = startAskbarStore(current(), options)
    const onChange = (): void => { select(current()) }
    const unsubscribeSessions = ctx.sessions.list.subscribe(onChange)
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(onChange)
    const page = typeof window === 'undefined' ? undefined : window
    page?.addEventListener('storage', onChange)
    return {
      store,
      stop: () => {
        unsubscribeSessions()
        unsubscribeWorkspaces()
        page?.removeEventListener('storage', onChange)
        stop()
      },
    }
  }

  const mode = new URLSearchParams(window.location.search).get('dsh-desktop-mode')
  if (mode === 'askbar') {
    // The bar owns the whole window: no app scrollbars, no default margin.
    ctx.effect(() => {
      document.body.dataset.dshDesktopMode = 'askbar'
      const priorOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        delete document.body.dataset.dshDesktopMode
        document.body.style.overflow = priorOverflow
      }
    }, 'idealize-askbar: window markers')

    ctx.effect(() => {
      const followed = follow()
      const dispose = ctx.slots.register({
        name: 'root',
        priority: -1,
        locale: NS,
        inject: (): AskbarRootInjected => ({ store: followed.store }),
      }, AskbarRoot)
      return () => {
        dispose()
        followed.stop()
      }
    }, 'idealize-askbar: root surface')
    return
  }

  // The store runs only while the sidebar declares the seat, so a composition
  // without a sidebar never polls the roster.
  ctx.slots.inject('sidebar.rail', () => {
    // The same read the floating bar makes: the expanded sidebar's rows,
    // every project grouped. An earlier grouped read named no rows, so the
    // host listed every chat comm had ever seen in each folder (JJ, 13 Sep
    // 2026: "shows many non live agents"); the rows ride along now, so the
    // rail shows the sidebar's list and nothing else.
    const followed = follow()
    const dispose = ctx.slots.register({
      name: 'sidebar.rail',
      locale: NS,
      inject: (): SidebarRailInjected => ({
        store: followed.store,
        openSession: (sessionId) => { ctx.sessions.open(sessionId as SessionId) },
        openStudio: requestStudio,
      }),
    }, SidebarRail)
    const stopKeys = walkKeybinds(() => followed.store.getSnapshot())
    return () => {
      stopKeys()
      dispose()
      followed.stop()
    }
  })

  /**
   * Register the shortcuts that walk the rail (JJ, 10 Sep 2026). ⌥⌘↑ / ⌥⌘↓
   * work while the composer has focus; ⇧↑ / ⇧↓ do the same anywhere else,
   * because inside a text field those two extend a selection.
   * @param snapshot - reads the rail's current rows.
   * @returns the disposer for both rows.
   */
  function walkKeybinds(snapshot: () => AskbarView): () => void {
    const keybinds = (ctx as unknown as { get(name: string): unknown }).get('keybinds') as KeybindsLike | undefined
    if (typeof keybinds?.register !== 'function') return () => undefined
    const t = ctx.locale.bind(NS)
    // Where the walk last left the list. The open chat is the better answer
    // when the list still holds it, but opening a blank chat can leave the
    // runtime on a session the roster does not name — the reuse scan mints a
    // fresh one — and without this the next press would restart at the top.
    let cursor: number | null = null
    const step = (delta: number): void => {
      const roster = snapshot().roster
      if (roster === null) return
      const rows = roster.groups === undefined ? roster.chips : roster.groups.flatMap(group => group.chips)
      if (rows.length === 0) return
      const current = ctx.sessions.list.getSnapshot().current
      const at = rows.findIndex(row => row.id === current)
      const from = at === -1 ? cursor : at
      // With neither the open chat nor a remembered place in the list, down
      // takes the first row and up the last.
      const next = from === null
        ? (delta > 0 ? 0 : rows.length - 1)
        : (from + delta + rows.length) % rows.length
      cursor = next
      ctx.sessions.open(rows[next]?.id as SessionId)
    }
    const disposers = [
      keybinds.register({
        id: 'idealize.agentNext',
        group: 'group.chats',
        label: t('keys.nextAgent'),
        order: 10,
        chords: [
          { key: 'ArrowDown', modifiers: ['alt', 'meta'] },
          { key: 'ArrowDown', modifiers: ['shift'] },
        ],
        run: () => { step(1) },
      }),
      keybinds.register({
        id: 'idealize.agentPrevious',
        group: 'group.chats',
        label: t('keys.previousAgent'),
        order: 11,
        chords: [
          { key: 'ArrowUp', modifiers: ['alt', 'meta'] },
          { key: 'ArrowUp', modifiers: ['shift'] },
        ],
        run: () => { step(-1) },
      }),
    ]
    return () => { for (const stop of disposers) stop() }
  }
}

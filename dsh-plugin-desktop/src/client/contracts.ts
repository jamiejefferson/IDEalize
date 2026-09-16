// Type-only: keep the augmented modules part of every program that pulls
// these contracts in — the node test face compiles no other client file
// that would import them, and an augmentation of an unseen module fails.
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Sidebar geometry passed by the desktop root slot. */
export interface DesktopSidebarOwnerProps {
  /** Whether the sidebar is showing its compact rail. */
  collapsed: boolean
  /** Current rendered sidebar width. */
  width: number
}

/** Public panel transitions consumed by conversation, sidebar, and pane plugins. */
export interface DesktopLayoutService {
  /** Toggle the sidebar between wide and compact presentation. */
  toggleSidebar(): void
  /** Open the current session's details panel. */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Open the drawer column hosting the vendored rail panes. */
  openDrawer(): void
  /** Close the drawer column. */
  closeDrawer(): void
  /** Open the deck (document viewer) column. */
  openDeck(): void
  /** Close the deck column. */
  closeDeck(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desktop-owned layout service in the desktop-owned shells. */
    layout: DesktopLayoutService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Upstream sidebar hosted by the desktop frames. */
    'sidebar': { kind: 'single'; scope: 'root'; owner: DesktopSidebarOwnerProps }
    /** Unchanged upstream conversation surface. */
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: Record<never, never> }
    /** Unchanged upstream details surface. */
    'details': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
    /** Frame-wide additive overlays. */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /** Full-width announcement strip above the columns (occupied by @idealize/notify). */
    'shell.banner': { kind: 'list'; scope: 'root' }
    /** The rail panes' docked column (occupied by @idealize/ui-bar's DrawerPanel). */
    'shell.drawer': { kind: 'single'; scope: 'root' }
    /** The document viewer column (occupied by @idealize/ui-bar's DeckPanel). */
    'shell.deck': { kind: 'single'; scope: 'root' }
  }
}

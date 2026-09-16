/**
 * Sidebar slot contract: the registrant-side props composition for the
 * layout-owned `sidebar` slot, plus the holes this shell declares. The shell
 * owns column geometry (fold state machine, brand row, New Session);
 * everything between the section header and the list bottom is the
 * `sidebar.workspaces` registrant's (ui-workspace) — or, while the column is
 * collapsed and the seat is occupied, the `sidebar.rail` registrant's — and
 * the foot is the `sidebar.settings` registrant's (ui-settings), followed by
 * optional footer actions in `sidebar.footer.action`.
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidebar' entry) into every
// program that sees this contract, so PropsRuntime<'sidebar'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The workspace/session browsing region: section header, search, the
     * grouped/flat session list, and every workspace dialog. Declared by this
     * package's 'sidebar' entry (declaring is claiming); ui-workspace
     * registers the browser.
     */
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    /**
     * The settings seat at the sidebar foot. Declared by this package's
     * 'sidebar' entry; ui-settings registers its trigger row + modal panel.
     * The sidebar passes only its column state — it holds no settings state.
     */
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    /**
     * Optional actions beside Settings at the sidebar foot. Declared by this
     * package's 'sidebar' entry; each action receives only the column state.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
    /**
     * Optional window-level controls in the sidebar header, on the
     * collapse toggle's row, left of it. Declared by this package's 'sidebar'
     * entry; each control receives only the column state.
     */
    'sidebar.header.action': { kind: 'list'; scope: 'root'; owner: SidebarHeaderActionOwnerProps }
    /**
     * The collapsed column's browsing region: what the 56px rail shows between
     * the New chat control and the foot. Declared by this package's 'sidebar'
     * entry. The shell renders the registrant only while the column is
     * collapsed and the seat is occupied, and renders `sidebar.workspaces`
     * otherwise, so a composition without a registrant keeps the browser's
     * own icon column. IDEalize's `@idealize/askbar` seats its agent rail here
     * (JJ, 8 Sep 2026: one rail, two homes).
     */
    'sidebar.rail': { kind: 'single'; scope: 'root'; owner: SidebarRailOwnerProps }
  }
}

/**
 * Owner share of the collapsed rail seat. The occupant renders only while the
 * column is collapsed, so no width flag rides along.
 */
export interface SidebarRailOwnerProps {
  /** Expand the column (a control that stands for the wide browser requests it). */
  expandSidebar: () => void
}

/**
 * Owner share of the browser hole — the only facts crossing the shell/region
 * boundary. Business data and actions arrive through the region's own inject.
 */
export interface SidebarSectionOwnerProps {
  /** Shell fold-state output: wide renders the full browser, rail the icon column. */
  wide: boolean
  /** Rail icons request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of the sidebar settings seat: the column display state the
 * occupant's trigger row must render against (wide row vs rail icon).
 */
export interface SidebarSettingsOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of an action rendered beside Settings at the sidebar foot. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of a control rendered in the sidebar header's control stack. */
export interface SidebarHeaderActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The shell keeps only its own controls: starting a Session from
 * the New Session button, toggling the column, and knowing whether the
 * collapsed rail seat is occupied.
 */
export type SidebarRootInjected = {
  /**
   * Start a New Session: with a workspace, reuse-or-create its blank session
   * and open it; without one, inherit the current Session Workspace, then the
   * recent Workspace, or clear into the New Session pure view when none exist.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
  /**
   * Whether `sidebar.rail` has a live registrant, read from the slot registry
   * and re-rendering on registration changes. Occupied, the collapsed column
   * renders the rail seat in place of `sidebar.workspaces`.
   * @returns true while a registrant is seated.
   */
  useRailOccupied: () => boolean
}

/**
 * Full component props: layout owner state/actions plus the declared holes'
 * render shares, this package's injected callbacks, and the standard locale
 * seat. No store is registered.
 */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action' | 'sidebar.header.action' | 'sidebar.rail'>
  & SidebarRootInjected & PropsLocale<'sidebar'>

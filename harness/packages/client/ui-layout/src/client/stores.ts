/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampWidth, DECK_DEFAULT, DECK_MAX, DECK_MIN, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
type LayoutState = { sidebar: number; details: number; deck: number; drawer: number; narrow: boolean; narrowExpanded: boolean }

/** localStorage key holding the drawer's last dragged width (px). */
export const DRAWER_WIDTH_KEY = 'dsh.layout.drawer'

/**
 * The drawer's remembered width: the last drag, clamped into the contract
 * range, or the default when nothing (or nonsense) is stored. Storage that
 * throws (private mode, blocked site data) reads as unset.
 * @returns the width to reopen the drawer at.
 */
export function rememberedDrawerWidth(): number {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(DRAWER_WIDTH_KEY)
  } catch {
    // localStorage access can throw when site data is blocked; treat as unset.
  }
  const px = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(px) && px > 0 ? clampWidth(px, DRAWER_MIN, DRAWER_MAX) : DRAWER_DEFAULT
}

/** Record the drawer's dragged width for the next open and the next load. */
function rememberDrawerWidth(px: number): void {
  try {
    localStorage.setItem(DRAWER_WIDTH_KEY, String(px))
  } catch {
    // localStorage writes can throw when site data is blocked or full; the in-memory width still applies.
  }
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  openDrawer: (draft: LayoutState) => void
  closeDrawer: (draft: LayoutState) => void
  setDrawer: (draft: LayoutState, px: number) => void
  openDeck: (draft: LayoutState) => void
  closeDeck: (draft: LayoutState) => void
  setDeck: (draft: LayoutState, px: number) => void
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default; the drawer alone remembers its last drag (localStorage,
 * {@link DRAWER_WIDTH_KEY}) because the rail reopens it constantly. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({ sidebar: SIDEBAR_DEFAULT, details: 0, deck: 0, drawer: 0, narrow: false, narrowExpanded: false }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      // The drawer is the one panel whose width outlives a close: the rail
      // reopens it many times a session, so it comes back at the last drag.
      openDrawer: (d) => { if (d.drawer === 0) d.drawer = rememberedDrawerWidth() },
      closeDrawer: (d) => { d.drawer = 0 },
      setDrawer: (d, px: number) => {
        d.drawer = clampWidth(px, DRAWER_MIN, DRAWER_MAX)
        rememberDrawerWidth(d.drawer)
      },
      openDeck: (d) => { if (d.deck === 0) d.deck = DECK_DEFAULT },
      closeDeck: (d) => { d.deck = 0 },
      setDeck: (d, px: number) => { d.deck = clampWidth(px, DECK_MIN, DECK_MAX) },
    },
  })
  return handle
}

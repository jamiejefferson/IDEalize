/**
 * Pure concession-chain column solver for the three-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * details, then auto-closing it, then dropping the sidebar to its compact
 * rail while an open deck/drawer presses (both derived — preferred width
 * preferences are never rewritten, so widening the window or closing the
 * panel restores them). Without an open deck/drawer the sidebar never
 * concedes, and center absorbs any remaining deficit as the last resort.
 * Inputs are the layout store's plain width preferences (0 = closed); a
 * closed sidebar resolves to the fixed SIDEBAR_COLLAPSED control rail while
 * closed details resolve to zero width. The SIDEBAR_AUTO_COLLAPSE breakpoint
 * is consumed by AppFrame, which decides the effective sidebar preference
 * before solving; the solver itself stays breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; details: number; deck: number; drawer: number }

// Contract-frozen geometry: the three-column concession chain's fixed points.
/**
 * Center column floor; only the final fallback may go below it. 480 keeps
 * the composer usable; at the desktop app's default 1280-wide window the
 * drawer drags between its 320 floor and 696 (the sidebar concedes to its
 * rail once 280 + drawer + 480 no longer fit beside the 48px tool rail).
 */
export const CENTER_MIN = 480
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/**
 * Closed-sidebar rail. IDEalize fork (JJ, 13 Sep 2026): 108px, not the 56px
 * an icon column needs, because the rail carries `@idealize/askbar`'s agent
 * chips and must read the same as the floating bar ("the two bars should both
 * be the same"). `ASKBAR_WIDTH` in dsh-plugin-desktop holds the same number.
 */
export const SIDEBAR_COLLAPSED = 108
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360
/** Drawer concession floor. */
export const DRAWER_MIN = 320
/** Drawer drag clamp ceiling. */
export const DRAWER_MAX = 720
/** Drawer width when opened. */
export const DRAWER_DEFAULT = 420
/** Deck (document panel) concession floor. */
export const DECK_MIN = 360
/** Deck drag clamp ceiling. */
export const DECK_MAX = 960
/** Deck width when opened. */
export const DECK_DEFAULT = 560

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the three column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @param drawer - drawer width preference in px (0 = closed).
 * @param deck - deck (document panel) width preference in px (0 = closed).
 * @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number, drawer = 0, deck = 0): Columns {
  // The sidebar starts at its preference (or the rail); it concedes only at
  // step 4, to the rail, and only under an open deck/drawer.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)
  const w0 = drawer === 0 ? 0 : clampWidth(drawer, DRAWER_MIN, DRAWER_MAX)
  const k0 = deck === 0 ? 0 : clampWidth(deck, DECK_MIN, DECK_MAX)

  // Step 1: everything fits at preferred widths.
  if (s + d0 + k0 + w0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: viewport - s - d0 - k0 - w0, details: d0, deck: k0, drawer: w0 }
  }

  // Step 2: shrink details toward its minimum.
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - k0 - w0 - CENTER_MIN)
  if (s + d1 + k0 + w0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: CENTER_MIN, details: d1, deck: k0, drawer: w0 }
  }

  // Step 3: auto-close details (derived — preferences untouched); the
  // explicitly opened panels outrank the transient inspector.
  if (s + k0 + w0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: viewport - s - k0 - w0, details: 0, deck: k0, drawer: w0 }
  }

  // Step 4: the sidebar concedes to its compact rail while an open
  // deck/drawer plus the center floor no longer fit beside it. Derived, like
  // the details auto-close: the preference survives, so closing the panel or
  // re-widening restores the full sidebar. Without this step the packaged
  // app's default 1280 window froze a drawer drag 52px past its default
  // width (JJ, review round 3).
  const s1 = k0 + w0 > 0 ? Math.min(s, SIDEBAR_COLLAPSED) : s
  if (s1 + k0 + w0 + CENTER_MIN <= viewport) {
    return { sidebar: s1, center: viewport - s1 - k0 - w0, details: 0, deck: k0, drawer: w0 }
  }

  // Step 5: shrink the deck toward its floor (the wide document panel gives
  // way before the narrow tool drawer does).
  const k1 = k0 === 0 ? 0 : Math.min(k0, Math.max(DECK_MIN, viewport - s1 - w0 - CENTER_MIN))
  if (s1 + k1 + w0 + CENTER_MIN <= viewport) {
    return { sidebar: s1, center: CENTER_MIN, details: 0, deck: k1, drawer: w0 }
  }

  // Step 6: shrink the drawer toward its floor; both explicit panels stay
  // visible even when center must absorb the remaining deficit (an open
  // panel that vanished would read as a dead control).
  const w1 = w0 === 0 ? 0 : Math.min(w0, Math.max(DRAWER_MIN, viewport - s1 - k1 - CENTER_MIN))
  return { sidebar: s1, center: Math.max(0, viewport - s1 - k1 - w1), details: 0, deck: k1, drawer: w1 }
}

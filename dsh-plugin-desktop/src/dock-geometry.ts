/** Shapes and timing the floating window shares with the runtime. Powell's window owns the placement itself. */

/** Screen edge the floating window docks against. */
export type AskbarSide = 'left' | 'right'

/** Where the user last left the window: a window origin on one display, keyed by Electron's display id. */
export interface AskbarPosition {
  displayId: number
  x: number
  y: number
}

/** Integer screen rectangle (Electron's `Rectangle`). */
export interface DockRectangle {
  x: number
  y: number
  width: number
  height: number
}

/** One attached display as placement reads it (Electron's `Display`, structurally). */
export interface DockDisplay {
  id: number
  workArea: DockRectangle
}

/** The collapse/expand transform's animation budget, in milliseconds (design spec proposal, tuned at A1 sign-off). */
export const ASKBAR_TRANSFORM_MS = 200

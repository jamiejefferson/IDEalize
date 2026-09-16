/**
 * The Askbar window (Askbar/Studio plan, slice A1): a frameless, always-on-top
 * 108px column docked to a screen edge, alive for the whole application
 * lifetime and independent of the main window — the design spec's "one app,
 * two projections". It renders the same loopback client with
 * `dsh-desktop-mode=askbar`, where `@idealize/askbar` owns the root surface.
 * The bar stays hidden until the user collapses to it (JJ, 2 Sep 2026: the
 * bar and the main window are never both on screen); `show()` waits for the
 * page to load so a collapse never reveals a blank column.
 *
 * The bar is movable (JJ, 8 Sep 2026): the renderer marks its background a
 * drag region, and the position the user leaves it at is remembered per
 * display (`askbarPosition`). A show places the bar before it paints: the
 * stored position when its display is still attached, else the docked column
 * (`askbarSide`) on the display under the cursor.
 *
 * On macOS the bar is an NSPanel (`type: 'panel'`), a non-activating utility
 * window. Stage Manager manages every ordinary window: it scaled the bar,
 * shoved it clear of its strip, and when the main window hid it left the
 * app on an empty stage, a black screen with the bar alone on it (JJ, 13 Sep
 * 2026: "minimode completely blanks the rest of the screen and is positioned
 * incorrectly"). A panel is outside Stage Manager's reach, sits where it is
 * placed, and does not keep the app active, so hiding the main window hands
 * the screen back to whatever was under it while the bar floats above.
 */

import { app, BrowserWindow, nativeImage, screen } from 'electron'

/** Screen edge the Askbar docks against. */
export type AskbarSide = 'left' | 'right'

/** Where the user last left the bar: a window origin on one display, keyed by Electron's display id. */
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

/**
 * The bar column's width. The design spec drew 72px; at that width the
 * portraits were 40px under a 7px caption and one live agent could not be
 * told from another (JJ, 11 Sep 2026: "the bar itself needs to be made 50%
 * wider and the content clearer"). `@idealize/askbar`'s sheet holds the same
 * number for the surface it paints inside the window.
 */
export const ASKBAR_WIDTH = 108

/** The collapse/expand transform's animation budget, in milliseconds (design spec proposal, tuned at A1 sign-off). */
export const ASKBAR_TRANSFORM_MS = 200

/** Continuous `move` events (Windows and Linux fire one per pixel) settle into one save after this many milliseconds. */
export const ASKBAR_MOVE_SETTLE_MS = 250

/**
 * Compute the bar's docked column for one display work area.
 * @param workArea - display work area (excludes menu bar, dock, taskbar).
 * @param side - edge to dock against (the `askbarSide` setting).
 * @returns a full-height {@link ASKBAR_WIDTH} column on the chosen edge.
 */
export function askbarBounds(workArea: DockRectangle, side: AskbarSide): DockRectangle {
  const width = Math.min(workArea.width, ASKBAR_WIDTH)
  const x = side === 'left' ? workArea.x : workArea.x + workArea.width - width
  return { x, y: workArea.y, width, height: workArea.height }
}

/**
 * Where the bar goes at show: the stored position when its display is still
 * attached, clamped into that display's work area at full height; otherwise
 * the docked column on the display under the cursor.
 * @param stored - the remembered position, when one exists.
 * @param displays - every attached display.
 * @param cursorDisplay - the display under the cursor (the docking fallback).
 * @param side - the docking edge for the fallback.
 * @returns the bounds to apply before the window shows.
 */
export function askbarPlacement(
  stored: AskbarPosition | undefined,
  displays: readonly DockDisplay[],
  cursorDisplay: DockDisplay,
  side: AskbarSide,
): DockRectangle {
  const display = stored === undefined ? undefined : displays.find(candidate => candidate.id === stored.displayId)
  if (stored === undefined || display === undefined) return askbarBounds(cursorDisplay.workArea, side)
  const area = display.workArea
  const width = Math.min(area.width, ASKBAR_WIDTH)
  // The column runs the work area's full height, so only x is free; a drag off the bottom comes back to the top.
  const x = Math.min(Math.max(stored.x, area.x), area.x + area.width - width)
  return { x, y: area.y, width, height: area.height }
}

export interface AskbarWindowOptions {
  /** Renderer URL carrying `dsh-desktop-mode=askbar`. */
  readonly url: string
  /** Application icon path (the shell spec's icon). */
  readonly iconPath: string
  /** Preload script shared with the main window. */
  readonly preloadPath: string
  /** Live Askbar dock-side preference (the `askbarSide` desktop setting). */
  readonly readSide: () => AskbarSide
  /** The remembered drag position (the `askbarPosition` desktop setting), when one exists. */
  readonly readPosition: () => AskbarPosition | undefined
  /** Persist the position a drag left the bar at. */
  readonly savePosition: (position: AskbarPosition) => Promise<void>
  readonly isQuitting: () => boolean
  readonly logError: (message: string) => void
}

/** Own the Askbar BrowserWindow: creation, placement, visibility, teardown. */
export class AskbarWindow {
  private window: BrowserWindow | undefined
  private released = false
  /** The page has reached `ready-to-show`; a show can paint content. */
  private loaded = false
  /** A `show()` arrived before the page loaded; honoured at `ready-to-show`. */
  private showPending = false
  /** The bounds the last `place()` applied; a move landing there is ours, not a drag. */
  private lastPlaced: DockRectangle | undefined
  /** Pending settle of a continuous `move` stream into one save. */
  private moveSettle: ReturnType<typeof setTimeout> | undefined
  /** When this class last set the bounds itself; a move landing soon after is the OS adjusting that, not a drag. */
  private placedAt = 0
  /** The column's bounds before {@link widen} grew the window; restored when the room is given back. */
  private rest: DockRectangle | undefined

  constructor(private readonly options: AskbarWindowOptions) {}

  /** Create and place the bar, hidden; safe to call once per generation. */
  mount(): void {
    if (this.released || this.window !== undefined) {
      throw new Error('dsh-plugin-desktop: the Askbar window is already mounted or released')
    }
    const icon = nativeImage.createFromPath(this.options.iconPath)
    // Created WITH its position: macOS cascades any window first shown
    // without an explicit one, overriding a later setBounds (proof run:
    // the bar left x=0 for the frontmost window's x at show).
    const initial = this.target()
    const window = new BrowserWindow({
      // An NSPanel on macOS: outside Stage Manager, and never the reason the
      // app stays active once the main window hides (see the module doc).
      ...process.platform === 'darwin' ? { type: 'panel' } : {},
      x: initial.x,
      y: initial.y,
      width: initial.width,
      height: initial.height,
      frame: false,
      // The window grows to hold a panel beside the column (widen); what it
      // does not paint stays see-through rather than a blank sheet.
      transparent: true,
      // No OS shadow: macOS computes one from the pixels a transparent window
      // painted and keeps it until told otherwise, so a panel sliding in left a
      // dark rim behind it where the shadow had been drawn a frame earlier
      // (JJ, 15 Sep 2026: "the weird misaligned border behind the minimode
      // slide-out"). The column has its border and the panel its own box-shadow.
      hasShadow: false,
      resizable: false,
      // Dragged by its background (the renderer's drag region); the landing spot is remembered below.
      movable: true,
      // Regular window minimize stays available (JJ, 1 Sep 2026: no auto-hide).
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      icon,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    this.window = window
    this.lastPlaced = initial
    this.placedAt = Date.now()
    window.setAlwaysOnTop(true, 'floating')
    // The bar stays with the user across Spaces and over full-screen apps
    // (design spec: "another app, full screen or not — the bar stays").
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    this.place()
    window.on('close', (event) => {
      if (this.options.isQuitting()) return
      event.preventDefault()
      window.hide()
    })
    // macOS cascades app windows at show even when constructed with an
    // explicit position (it lands on the frontmost window's corner); the
    // pre-show placement in show() is the rule, this re-placement the fallback.
    window.on('show', () => { this.place() })
    // macOS reports one `moved` at the end of a drag; Windows and Linux report
    // `move` continuously, settled here into one save.
    window.on('moved', () => { this.remember() })
    window.on('move', () => {
      clearTimeout(this.moveSettle)
      this.moveSettle = setTimeout(() => { this.remember() }, ASKBAR_MOVE_SETTLE_MS)
    })
    window.once('ready-to-show', () => {
      this.loaded = true
      if (this.showPending) {
        this.showPending = false
        this.place()
        window.show()
      }
    })
    window.loadURL(this.options.url).catch((cause: unknown) => {
      this.options.logError(`dsh-plugin-desktop: the Askbar window failed to load: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }

  /** The bounds a show applies: the remembered position, else the docked column under the cursor. */
  private target(): DockRectangle {
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const stored = this.options.readPosition()
    const displays = stored === undefined ? [] : screen.getAllDisplays()
    return askbarPlacement(stored, displays, cursor, this.options.readSide())
  }

  /** Apply the remembered position, or re-dock to the current side preference on the display under the cursor. */
  place(): void {
    const window = this.window
    if (window === undefined) return
    const bounds = this.target()
    this.lastPlaced = bounds
    this.placedAt = Date.now()
    this.rest = undefined
    window.setBounds(bounds)
  }

  /**
   * Persist where a drag left the bar. A move that only echoes our own
   * placement saves nothing; a move landing within the settle window of our
   * own placement is the OS adjusting it (a cascade at show), so the placement
   * is applied again and nothing is saved: what gets remembered is where the
   * user put the bar, never where the system put it.
   */
  private remember(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const bounds = window.getBounds()
    if (this.lastPlaced !== undefined && bounds.x === this.lastPlaced.x && bounds.y === this.lastPlaced.y) return
    if (this.lastPlaced !== undefined && Date.now() - this.placedAt < ASKBAR_MOVE_SETTLE_MS * 2) {
      window.setBounds(this.lastPlaced)
      return
    }
    this.lastPlaced = bounds
    const display = screen.getDisplayMatching(bounds)
    void this.options.savePosition({ displayId: display.id, x: bounds.x, y: bounds.y }).catch((cause: unknown) => {
      this.options.logError(`dsh-plugin-desktop: failed to remember the Askbar position: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }

  /** The bar's current bounds, for the main window's transform animation target. */
  bounds(): DockRectangle | undefined {
    return this.window?.getBounds()
  }

  /**
   * Make room beside the column for a panel, or give the room back.
   *
   * The bar's panels are 300px and the column is {@link ASKBAR_WIDTH}, so in
   * the window as it docks they were cut off at its edge (JJ, 13 Sep 2026:
   * "the pop-outs are cropped"). Growing the window keeps the column on its
   * screen edge — a right-docked bar moves its origin left by what it gains —
   * so the chips never move under the pointer that opened the panel. The
   * renderer pins the column to the same edge inside the wider window.
   * @param width - the window width to hold; anything at or below the column's own gives the room back.
   */
  widen(width: number): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const wanted = Math.max(ASKBAR_WIDTH, Math.round(width))
    const bounds = window.getBounds()
    if (bounds.width === wanted) return
    // Giving the room back restores the column exactly as it stood before it
    // grew, rather than deriving it from wherever the wider window ended up.
    if (wanted === ASKBAR_WIDTH && this.rest !== undefined) {
      const rest = this.rest
      this.rest = undefined
      this.apply(rest)
      return
    }
    if (this.rest === undefined) this.rest = bounds
    this.apply({
      x: this.options.readSide() === 'right' ? bounds.x + bounds.width - wanted : bounds.x,
      y: bounds.y,
      width: wanted,
      height: bounds.height,
    })
  }

  /** Set the bounds as ours: the move they raise is not a drag, and what the OS made of them is what we hold. */
  private apply(bounds: DockRectangle): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    this.lastPlaced = bounds
    this.placedAt = Date.now()
    window.setBounds(bounds)
    this.lastPlaced = window.getBounds()
  }

  /** Place, then show the bar now if its page has loaded, otherwise at `ready-to-show`. */
  show(): void {
    const window = this.window
    if (window === undefined) return
    if (!this.loaded) {
      this.showPending = true
      return
    }
    this.place()
    window.show()
  }

  /**
   * Give the bar's window the keyboard, or hand it back. The window is a
   * non-activating panel, so taking the keyboard leaves the app behind
   * frontmost (measured 14 Sep 2026: the window reported focused with the
   * app not frontmost, and unfocused after the blur).
   * @param focus - true to take the keyboard for the panel's ask field, false to give it back.
   */
  focus(focus: boolean): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || !window.isVisible()) return
    if (focus) window.focus()
    else window.blur()
  }

  /** Hide the bar and cancel a show still waiting on the page load; a panel's extra width is given back first, so the next show is the column. */
  hide(): void {
    this.showPending = false
    const rest = this.rest
    if (rest !== undefined) {
      this.rest = undefined
      this.apply(rest)
    }
    this.window?.hide()
  }

  /**
   * Hand activation to the app behind and keep the bar on screen. On macOS
   * an app whose last regular window hid stays active with nothing to show,
   * and Stage Manager then shows an empty stage (JJ, 13 Sep 2026: "minimode
   * ... blanks out the screen"). Hiding the app activates the next one, and
   * the bar comes back without activating this one. Other platforms have no
   * app-level hide and keep the window as it is.
   */
  yieldActivation(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || process.platform !== 'darwin') return
    app.hide()
    window.showInactive()
  }

  /** Whether the bar is on screen, or will be as soon as its page loads. */
  isShown(): boolean {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return false
    return this.showPending || window.isVisible()
  }

  /** Destroy the window; the owner drops the instance afterwards. */
  release(): void {
    this.released = true
    clearTimeout(this.moveSettle)
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }
}

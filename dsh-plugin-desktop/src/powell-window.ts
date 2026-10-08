/**
 * Powell's window (2.0.0): the desk-buddy owl that MiniMode collapses to.
 * It replaces the Askbar column (JJ, 2 Oct 2026: "Powell is the interface")
 * and keeps the column's foundations: an NSPanel on macOS so Stage Manager
 * leaves it alone, floating above other apps on every Space, hidden while
 * the main window is up.
 *
 * The window is a fixed transparent box sized for the owl plus its thought
 * pill and speech bubble. Everything outside the owl, pill and bubble must
 * let clicks reach the app underneath, so the window ignores the mouse
 * (forwarding moves) until the renderer reports the pointer is over
 * something of Powell's (`powell:hit`).
 *
 * Dragging is the main process's job: the renderer says a drag started, and
 * the window follows the cursor at display rate until the renderer says it
 * ended. One message each way keeps the owl glued to the pointer, which per-
 * move IPC cannot. Where the drag leaves Powell is remembered per display
 * (the `askbarPosition` setting, which the column used the same way).
 */

import { app, BrowserWindow, ipcMain, nativeImage, screen, type IpcMainEvent } from 'electron'
import type { AskbarPosition, DockDisplay, DockRectangle } from './askbar-window.ts'

/** The window box: wide enough for a two-line bubble, tall enough for the bubble above the owl. */
export const POWELL_WIDTH = 380
export const POWELL_HEIGHT = 360

/**
 * The owl's own footprint inside the box: the 92 x 102 owl, the status tag
 * under it and the stage's bottom padding. Only this has to stay on screen;
 * the rest of the box is transparent and may hang off a side or the bottom.
 */
export const OWL_WIDTH = 92
export const OWL_HEIGHT = 134

/** How far above the work area's bottom edge the owl sits by default. */
const BOTTOM_GAP = 8

/** Cursor-follow cadence while dragging, in milliseconds. */
const DRAG_TICK_MS = 8

/** How long a layout change may wait for the page to repaint before the window moves anyway. */
const LAYOUT_ACK_MS = 120

/** IPC channels the preload bridge uses (renderer → main, main → renderer). */
export const POWELL_CHANNELS = {
  hit: 'powell:hit',
  dragStart: 'powell:drag-start',
  dragEnd: 'powell:drag-end',
  focus: 'powell:focus',
  command: 'powell:command',
  layout: 'powell:layout',
  layoutApplied: 'powell:layout-applied',
} as const

/** A command the main process sends the owl (from a global key). */
export type PowellCommand = 'listen' | 'type'

/**
 * Where the owl sits inside its box. `owlX` is the owl's left edge from the
 * box's left edge. `flip` puts the owl at the top of the box with the bubble
 * below it, for an owl near the top of the screen, where macOS keeps a window
 * under the menu bar and there is no room for the bubble above.
 */
export interface PowellLayout {
  owlX: number
  flip: boolean
}

/** The window bounds and the owl's layout inside them. */
export interface PowellFrame {
  bounds: DockRectangle
  layout: PowellLayout
  /** The owl's top-left on screen. */
  owl: { x: number; y: number }
}

/** The layout a fresh page starts with: owl bottom centre. */
export const CENTRED_LAYOUT: PowellLayout = { owlX: (POWELL_WIDTH - OWL_WIDTH) / 2, flip: false }

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high))

/**
 * Frame an owl at a point. The owl stays wholly inside the work area and
 * nothing else limits it (JJ, 2 Oct 2026: "weird limits to where it can be
 * positioned"; the whole 380 x 360 box used to be kept on screen). The box
 * stays on screen sideways and the owl moves inside it, so the bubble is
 * never cut off at a side; near the top the bubble flips below the owl.
 * @param owl - where the owl's top-left should go.
 * @param area - the work area of its display.
 * @param keepBox - false while dragging: the box stays centred on the owl and
 *   may hang off a side, so the owl never shifts inside its box mid-drag.
 * @returns the window bounds, the layout and the clamped owl position.
 */
export function powellFrame(owl: { x: number; y: number }, area: DockRectangle, keepBox = true): PowellFrame {
  const ox = Math.round(clamp(owl.x, area.x, area.x + area.width - OWL_WIDTH))
  const oy = Math.round(clamp(owl.y, area.y, area.y + area.height - OWL_HEIGHT))
  const flip = oy - area.y < POWELL_HEIGHT - OWL_HEIGHT
  const centred = ox - CENTRED_LAYOUT.owlX
  const bx = keepBox ? Math.round(clamp(centred, area.x, area.x + area.width - POWELL_WIDTH)) : centred
  const by = flip ? oy : oy + OWL_HEIGHT - POWELL_HEIGHT
  return {
    bounds: { x: bx, y: by, width: POWELL_WIDTH, height: POWELL_HEIGHT },
    layout: { owlX: ox - bx, flip },
    owl: { x: ox, y: oy },
  }
}

/**
 * The stored position is the box origin the owl would have bottom-centred in
 * its box (the column's setting, unchanged in meaning), so positions saved
 * before the owl could reach the edges still land where they were.
 * @param owl - the owl's top-left.
 * @returns the position to store.
 */
export function storedOf(owl: { x: number; y: number }): { x: number; y: number } {
  return { x: owl.x - CENTRED_LAYOUT.owlX, y: owl.y - (POWELL_HEIGHT - OWL_HEIGHT) }
}

/**
 * Where Powell goes at show: the remembered spot when its display is still
 * attached, else bottom centre of the display under the cursor.
 * @param stored - the remembered origin, when one exists.
 * @param displays - every attached display.
 * @param cursorDisplay - the display under the cursor.
 * @returns the frame.
 */
export function powellPlacement(stored: AskbarPosition | undefined, displays: readonly DockDisplay[], cursorDisplay: DockDisplay): PowellFrame {
  const display = stored === undefined ? undefined : displays.find(candidate => candidate.id === stored.displayId)
  if (stored === undefined || display === undefined) {
    const area = cursorDisplay.workArea
    return powellFrame({ x: area.x + (area.width - OWL_WIDTH) / 2, y: area.y + area.height - OWL_HEIGHT - BOTTOM_GAP }, area)
  }
  return powellFrame({ x: stored.x + CENTRED_LAYOUT.owlX, y: stored.y + POWELL_HEIGHT - OWL_HEIGHT }, display.workArea)
}

export interface PowellWindowOptions {
  /** Renderer URL carrying `dsh-desktop-mode=askbar` (the floating window's marker, kept so its no-new-chat guards hold). */
  readonly url: string
  readonly iconPath: string
  readonly preloadPath: string
  readonly readPosition: () => AskbarPosition | undefined
  readonly savePosition: (position: AskbarPosition) => Promise<void>
  /** Double-click or the menu's Open IDEalize. */
  readonly openMain: () => void
  readonly isQuitting: () => boolean
  readonly logError: (message: string) => void
}

/** Own Powell's BrowserWindow: creation, placement, click-through, drag, teardown. */
export class PowellWindow {
  private window: BrowserWindow | undefined
  private released = false
  private loaded = false
  private showPending = false
  private dragTimer: ReturnType<typeof setInterval> | undefined
  /** The layout the page shows now. */
  private layout: PowellLayout = CENTRED_LAYOUT
  /** A layout change waiting on the page's repaint before the window moves. */
  private layoutWait: { resolve: () => void; timer: ReturnType<typeof setTimeout> } | undefined
  /** Powell came up because the main window was minimised, so restoring it puts Powell away again. */
  private shownForMinimise = false
  private readonly disposers: (() => void)[] = []

  constructor(private readonly options: PowellWindowOptions) {}

  mount(): void {
    if (this.released || this.window !== undefined) {
      throw new Error('dsh-plugin-desktop: the Powell window is already mounted or released')
    }
    const initial = this.target().bounds
    const window = new BrowserWindow({
      ...process.platform === 'darwin' ? { type: 'panel' } : {},
      x: initial.x,
      y: initial.y,
      width: initial.width,
      height: initial.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      icon: nativeImage.createFromPath(this.options.iconPath),
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    })
    this.window = window
    window.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    }
    window.setBounds(initial)
    // Clicks pass through until the pointer is over the owl, pill or bubble.
    window.setIgnoreMouseEvents(true, { forward: true })
    window.on('close', (event) => {
      if (this.options.isQuitting()) return
      event.preventDefault()
      window.hide()
    })
    // A fresh page starts centred; tell it the layout it is really in.
    window.webContents.on('did-finish-load', () => {
      window.webContents.send(POWELL_CHANNELS.layout, this.layout)
    })
    window.once('ready-to-show', () => {
      this.loaded = true
      if (this.showPending) {
        this.showPending = false
        void this.place().then(() => { window.showInactive() })
      }
    })
    this.listen()
    window.loadURL(this.options.url).catch((cause: unknown) => {
      this.options.logError(`dsh-plugin-desktop: the Powell window failed to load: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }

  /** Wire the renderer's messages; each is honoured only from this window. */
  private listen(): void {
    const mine = (event: IpcMainEvent): boolean => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents
    const onHit = (event: IpcMainEvent, over: unknown): void => {
      if (!mine(event)) return
      this.window?.setIgnoreMouseEvents(over !== true, { forward: true })
    }
    const onDragStart = (event: IpcMainEvent): void => {
      if (!mine(event)) return
      this.startDrag()
    }
    const onDragEnd = (event: IpcMainEvent): void => {
      if (!mine(event)) return
      this.endDrag()
    }
    const onFocus = (event: IpcMainEvent, focus: unknown): void => {
      if (!mine(event)) return
      this.focus(focus === true)
    }
    const onOpenMain = (event: IpcMainEvent): void => {
      if (!mine(event)) return
      this.options.openMain()
    }
    const onHide = (event: IpcMainEvent): void => {
      if (!mine(event)) return
      this.hide()
    }
    const onLayoutApplied = (event: IpcMainEvent): void => {
      if (!mine(event)) return
      this.layoutApplied()
    }
    ipcMain.on(POWELL_CHANNELS.hit, onHit)
    ipcMain.on(POWELL_CHANNELS.dragStart, onDragStart)
    ipcMain.on(POWELL_CHANNELS.dragEnd, onDragEnd)
    ipcMain.on(POWELL_CHANNELS.focus, onFocus)
    ipcMain.on('powell:open-main', onOpenMain)
    ipcMain.on('powell:hide', onHide)
    ipcMain.on(POWELL_CHANNELS.layoutApplied, onLayoutApplied)
    this.disposers.push(() => {
      ipcMain.off(POWELL_CHANNELS.layoutApplied, onLayoutApplied)
      ipcMain.off(POWELL_CHANNELS.hit, onHit)
      ipcMain.off(POWELL_CHANNELS.dragStart, onDragStart)
      ipcMain.off(POWELL_CHANNELS.dragEnd, onDragEnd)
      ipcMain.off(POWELL_CHANNELS.focus, onFocus)
      ipcMain.off('powell:open-main', onOpenMain)
      ipcMain.off('powell:hide', onHide)
    })
  }

  /** The owl's top-left on screen, from the window and the layout. */
  private owlOrigin(): { x: number; y: number } | undefined {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return undefined
    const [x = 0, y = 0] = window.getPosition()
    return { x: x + this.layout.owlX, y: y + (this.layout.flip ? 0 : POWELL_HEIGHT - OWL_HEIGHT) }
  }

  /**
   * Move the window to a frame. A changed layout goes to the page first and
   * the window moves once the page has repainted (or after a short wait), so
   * the owl never jumps a frame ahead of its box.
   * @param frame - where to go.
   * @param animate - glide on macOS.
   */
  private async applyFrame(frame: PowellFrame, animate = false): Promise<void> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (frame.layout.owlX !== this.layout.owlX || frame.layout.flip !== this.layout.flip) {
      this.layout = frame.layout
      const applied = new Promise<void>((resolve) => {
        this.layoutApplied()
        this.layoutWait = { resolve, timer: setTimeout(() => { this.layoutApplied() }, LAYOUT_ACK_MS) }
      })
      window.webContents.send(POWELL_CHANNELS.layout, frame.layout)
      await applied
      if (window.isDestroyed()) return
    }
    window.setBounds(frame.bounds, animate)
  }

  private layoutApplied(): void {
    const wait = this.layoutWait
    if (wait === undefined) return
    this.layoutWait = undefined
    clearTimeout(wait.timer)
    wait.resolve()
  }

  private startDrag(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    this.endDrag(false)
    const cursor = screen.getCursorScreenPoint()
    const owl = this.owlOrigin()
    if (owl === undefined) return
    // The grab point on the owl stays under the pointer.
    const grab = { x: cursor.x - owl.x, y: cursor.y - owl.y }
    // The pointer may leave the window mid-drag; it must keep receiving input.
    window.setIgnoreMouseEvents(false)
    let moving = false
    this.dragTimer = setInterval(() => {
      if (window.isDestroyed()) {
        this.endDrag(false)
        return
      }
      if (moving) return
      const point = screen.getCursorScreenPoint()
      const area = screen.getDisplayNearestPoint(point).workArea
      // Mid-drag the box stays centred on the owl and may hang off a side, so
      // only the flip near the top ever changes the layout.
      const frame = powellFrame({ x: point.x - grab.x, y: point.y - grab.y }, area, false)
      if (frame.layout.owlX === this.layout.owlX && frame.layout.flip === this.layout.flip) {
        window.setPosition(frame.bounds.x, frame.bounds.y, false)
        return
      }
      moving = true
      void this.applyFrame(frame).finally(() => { moving = false })
    }, DRAG_TICK_MS)
  }

  private endDrag(save = true): void {
    if (this.dragTimer === undefined) return
    clearInterval(this.dragTimer)
    this.dragTimer = undefined
    const window = this.window
    if (!save || window === undefined || window.isDestroyed()) return
    const owl = this.owlOrigin()
    if (owl === undefined) return
    const display = screen.getDisplayNearestPoint({ x: owl.x + OWL_WIDTH / 2, y: owl.y + OWL_HEIGHT / 2 })
    // The owl lands wholly on screen; its box comes back on screen sideways.
    const frame = powellFrame(owl, display.workArea)
    void this.applyFrame(frame)
    void this.options.savePosition({ displayId: display.id, ...storedOf(frame.owl) }).catch((cause: unknown) => {
      this.options.logError(`dsh-plugin-desktop: failed to remember where Powell was left: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }

  private target(): PowellFrame {
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const stored = this.options.readPosition()
    return powellPlacement(stored, stored === undefined ? [] : screen.getAllDisplays(), cursor)
  }

  /** Put Powell where it was left, or bottom centre. */
  async place(): Promise<void> {
    await this.applyFrame(this.target())
  }

  /** Where Powell is, for the collapse animation's target. */
  bounds(): DockRectangle | undefined {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return undefined
    // The main window glides to the owl itself, not the empty space around it.
    const owl = this.owlOrigin()
    if (owl === undefined) return undefined
    return { x: owl.x, y: owl.y, width: OWL_WIDTH, height: OWL_HEIGHT }
  }

  /** The Askbar's widen hook; Powell's box is fixed. */
  widen(_width: number): void {}

  show(): void {
    const window = this.window
    if (window === undefined) return
    this.shownForMinimise = false
    if (!this.loaded) {
      this.showPending = true
      return
    }
    // Shown at once where it was; a stale frame (a display change) corrects a beat later.
    window.showInactive()
    void this.place()
  }

  /**
   * The main window was minimised (true) or came back (false). Powell comes
   * up while the app is minimised (JJ, 2 Oct 2026: "it needs to work with
   * IDEalize being minimised") and goes away again on restore, unless the
   * person brought it up themselves.
   * @param minimised - whether the main window is now minimised.
   */
  mainMinimised(minimised: boolean): void {
    if (minimised) {
      if (this.isShown()) return
      this.show()
      this.shownForMinimise = true
      return
    }
    if (!this.shownForMinimise) return
    this.shownForMinimise = false
    this.hide()
  }

  /**
   * Take the keyboard for the thought pill, or give it back. A non-activating
   * panel takes key focus without bringing the app forward.
   * @param focus - true to take it.
   */
  focus(focus: boolean): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || !window.isVisible()) return
    if (focus) {
      window.setIgnoreMouseEvents(false)
      window.focus()
    } else {
      window.blur()
    }
  }

  hide(): void {
    this.showPending = false
    this.shownForMinimise = false
    this.endDrag(false)
    this.window?.hide()
  }

  /**
   * Hand activation to the app behind and keep Powell on screen (see
   * AskbarWindow.yieldActivation). Hiding the app takes every window with it,
   * the panel included, and a panel shown again while the app is hidden stays
   * off screen until the app is next activated (JJ, 2 Oct 2026: the owl
   * "appeared and then disappeared ... reappeared when the main idealize
   * window was in focus"). Unhiding on the next turn of the event loop brings
   * back only Powell, because the main window was already hidden, and leaves
   * the other app frontmost: measured on macOS 27, the owl is off screen for
   * about 8 ms, under one display frame.
   */
  yieldActivation(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || process.platform !== 'darwin') return
    app.hide()
    setImmediate(() => {
      if (window.isDestroyed() || this.released) return
      app.show()
      window.showInactive()
    })
  }

  isShown(): boolean {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return false
    return this.showPending || window.isVisible()
  }

  /**
   * Send the owl a command from a global key, showing it first when hidden.
   * @param command - what to do.
   */
  command(command: PowellCommand): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (!window.isVisible()) this.show()
    window.webContents.send(POWELL_CHANNELS.command, command)
  }

  release(): void {
    this.released = true
    this.layoutApplied()
    this.endDrag(false)
    for (const dispose of this.disposers.splice(0)) dispose()
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }
}

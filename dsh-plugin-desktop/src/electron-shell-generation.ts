import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron'
import { applicationMenuTemplate } from './application-menu.ts'
import { formatDesktopExitCode } from './desktop-logger.ts'
import type { ElectronPlatformStrategy } from './electron-platform.ts'
import type { DesktopLocale, DesktopShellSpec } from './runtime.ts'
import { prepareTrayIcon } from './tray-icons.ts'
import { desktopTrayLabel } from './tray-locale.ts'
import { desktopWindowOptions } from './window-options.ts'
import type { DockRectangle } from './askbar-window.ts'

/** Where the File and Help menus send a reader: the product's site. */
const WEBSITE_URL = 'https://idealize.projject.ai'
/** How far a new window opens from the one in front, so both title bars show. */
const NEW_WINDOW_OFFSET = 28

const MIN_ZOOM_LEVEL = -4
const MAX_ZOOM_LEVEL = 4

function clampedZoomLevel(level: number): number {
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level))
}

function isZoomShortcut(input: Electron.Input): 'in' | 'out' | 'reset' | undefined {
  if (input.type !== 'keyDown' || input.alt || (!input.control && !input.meta)) return undefined
  if (input.key === '+' || input.key === '=') return 'in'
  if (input.key === '-' || input.key === '_') return 'out'
  if (input.key === '0') return 'reset'
  return undefined
}

export interface ElectronShellGenerationOptions {
  readonly platform: ElectronPlatformStrategy
  readonly spec: DesktopShellSpec
  readonly locale: DesktopLocale
  readonly preloadPath: string
  readonly isQuitting: () => boolean
  readonly buildTrayTemplate: () => Electron.MenuItemConstructorOptions[]
  readonly stopRendererBootMonitoring: () => void
  readonly failRendererBoot: (error: string) => void
  readonly logError: (message: string) => void
}

/** Own one BrowserWindow and Tray generation, including every native listener. */
export class ElectronShellGeneration {
  private window: BrowserWindow | undefined
  /** Windows opened through New Window. They close for real; the first window hides. */
  private readonly extraWindows = new Set<BrowserWindow>()
  /** The extra windows a collapse hid, shown again by {@link expandRestored}. */
  private collapsedExtraWindows: BrowserWindow[] = []
  /** The frame the collapse transform left; consumed by {@link expandRestored}. */
  private preCollapseFrame: DockRectangle | undefined
  /** Whether the window was in macOS full screen when it collapsed; restored by {@link expandRestored}. */
  private preCollapseFullScreen = false
  private tray: Tray | undefined
  private mounted = false
  private released = false
  private cleanupListeners: (() => void) | undefined

  constructor(private readonly options: ElectronShellGenerationOptions) {}

  async mount(beforeInteractive?: () => void): Promise<void> {
    if (this.mounted || this.window !== undefined) {
      throw new Error('dsh-plugin-desktop: native shell generation is already mounted')
    }

    const { platform, spec } = this.options
    const icon = nativeImage.createFromPath(spec.iconPath)
    if (icon.isEmpty()) {
      throw new Error(`dsh-plugin-desktop: failed to load application icon ${spec.iconPath}`)
    }
    platform.configureApplication(icon)
    const origin = new URL(spec.url).origin
    if (spec.mode === 'advanced') nativeTheme.themeSource = spec.readThemeSource()
    const window = new BrowserWindow(desktopWindowOptions(spec, icon, platform.platform, this.options.preloadPath))
    window.accessibleTitle = spec.windowTitle
    platform.configureWindow(window)
    this.window = window

    const show = (): void => { this.show() }
    const close = (event: Electron.Event): void => {
      if (this.options.isQuitting()) return
      event.preventDefault()
      window.hide()
    }
    const rendererGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void => {
      const detail = `renderer process gone (reason: ${details.reason}, exitCode: ${formatDesktopExitCode(details.exitCode)})`
      this.options.logError(`dsh-plugin-desktop: ${detail}`)
      this.options.failRendererBoot(detail)
    }
    const loadFailed = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ): void => {
      this.options.logError(`dsh-plugin-desktop: renderer failed to load (${errorCode}: ${errorDescription})`)
      if (isMainFrame === true && errorCode !== -3) {
        this.options.failRendererBoot(
          `renderer main frame failed to load (${String(errorCode)}: ${errorDescription})`,
        )
      }
    }

    app.on('activate', show)
    window.on('close', close)
    const releaseGuards = this.guardWindow(window, origin)
    window.webContents.on('render-process-gone', rendererGone)
    window.webContents.on('did-fail-load', loadFailed)
    window.once('ready-to-show', show)
    let tray: Tray | undefined
    this.cleanupListeners = () => {
      app.off('activate', show)
      window.off('close', close)
      releaseGuards()
      window.off('ready-to-show', show)
      window.webContents.off('render-process-gone', rendererGone)
      window.webContents.off('did-fail-load', loadFailed)
      tray?.off('click', show)
    }

    try {
      await window.loadURL(spec.url)
      tray = new Tray(prepareTrayIcon(spec.trayIcons, platform.platform))
      this.tray = tray
      tray.setToolTip(spec.productName)
      this.refreshTrayMenu()
      tray.on('click', show)
      this.installApplicationMenu()
      beforeInteractive?.()
      this.mounted = true
    } catch (cause) {
      await this.release()
      throw cause
    }
  }

  /**
   * The rules every app window holds: a blank title, the zoom chords, no
   * navigation off the harness origin, and outside links handed to the OS.
   * @param window - the window to guard.
   * @param origin - the harness origin the window may stay on.
   * @returns the release for the listeners this added.
   */
  private guardWindow(window: BrowserWindow, origin: string): () => void {
    const preserveBlankTitle = (event: Electron.Event): void => { event.preventDefault() }
    const handleZoomShortcut = (event: Electron.Event, input: Electron.Input): void => {
      const action = isZoomShortcut(input)
      if (action === undefined) return
      event.preventDefault()
      if (action === 'reset') {
        window.webContents.setZoomLevel(0)
        return
      }
      const step = action === 'in' ? 1 : -1
      window.webContents.setZoomLevel(clampedZoomLevel(window.webContents.getZoomLevel() + step))
    }
    const navigate = (event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>): void => {
      if (!event.isMainFrame) return
      let targetOrigin: string | undefined
      try {
        targetOrigin = new URL(event.url).origin
      } catch {
        targetOrigin = undefined
      }
      if (targetOrigin !== origin) event.preventDefault()
    }
    const redirect = (
      event: Electron.Event,
      url: string,
      _isInPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return
      let targetOrigin: string | undefined
      try {
        targetOrigin = new URL(url).origin
      } catch {
        targetOrigin = undefined
      }
      if (targetOrigin !== origin) event.preventDefault()
    }
    window.on('page-title-updated', preserveBlankTitle)
    window.webContents.on('before-input-event', handleZoomShortcut)
    window.webContents.on('will-frame-navigate', navigate)
    window.webContents.on('will-redirect', redirect)
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
          void shell.openExternal(target.href).catch((cause: unknown) => {
            this.options.logError(`dsh-plugin-desktop: failed to open external link: ${cause instanceof Error ? cause.message : String(cause)}`)
          })
        }
      } catch {
        // A malformed target is rejected with the same deny result.
      }
      return { action: 'deny' }
    })
    return () => {
      window.off('page-title-updated', preserveBlankTitle)
      window.webContents.off('before-input-event', handleZoomShortcut)
      window.webContents.off('will-frame-navigate', navigate)
      window.webContents.off('will-redirect', redirect)
    }
  }

  /** The menu bar is a macOS surface; the other platforms' windows carry none. */
  private installApplicationMenu(): void {
    if (this.options.platform.platform !== 'darwin') return
    const { locale } = this.options
    Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate({
      fileLabel: desktopTrayLabel(locale, 'fileMenu'),
      newWindowLabel: desktopTrayLabel(locale, 'newWindow'),
      websiteLabel: desktopTrayLabel(locale, 'website'),
      openNewWindow: () => { this.openWindow() },
      openWebsite: () => {
        void shell.openExternal(WEBSITE_URL).catch((cause: unknown) => {
          this.options.logError(`dsh-plugin-desktop: failed to open the website: ${cause instanceof Error ? cause.message : String(cause)}`)
        })
      },
    })))
  }

  /**
   * Open another window on the same harness page. Each window is a second
   * view of one running app, as two browser tabs would be: chats, terminals
   * and layout come from the harness, so nothing is copied or restarted.
   * It opens stepped off the window in front and closes for real; the first
   * window stays the one the dock, the tray and the Askbar bring back.
   */
  openWindow(): void {
    const first = this.window
    if (!this.mounted || first === undefined || first.isDestroyed()) return
    const { platform, spec } = this.options
    const icon = nativeImage.createFromPath(spec.iconPath)
    const window = new BrowserWindow(desktopWindowOptions(spec, icon, platform.platform, this.options.preloadPath))
    window.accessibleTitle = spec.windowTitle
    platform.configureWindow(window)
    const front = BrowserWindow.getFocusedWindow() ?? first
    if (!front.isDestroyed() && front.isVisible() && !front.isFullScreen()) {
      const frame = front.getBounds()
      window.setBounds({ ...frame, x: frame.x + NEW_WINDOW_OFFSET, y: frame.y + NEW_WINDOW_OFFSET })
    }
    // The guards go with the window: by `closed` its webContents is destroyed
    // and touching it throws, which took the whole app down with the window.
    this.guardWindow(window, new URL(spec.url).origin)
    this.extraWindows.add(window)
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return
      window.show()
      window.focus()
    })
    window.once('closed', () => { this.extraWindows.delete(window) })
    void window.loadURL(spec.url).catch((cause: unknown) => {
      this.options.logError(`dsh-plugin-desktop: a new window failed to load: ${cause instanceof Error ? cause.message : String(cause)}`)
      if (!window.isDestroyed()) window.destroy()
    })
  }

  show(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  /** Whether the app window is on screen: the transform toggle's answer. */
  isWindowVisible(): boolean {
    const window = this.window
    if (window !== undefined && !window.isDestroyed() && window.isVisible()) return true
    return [...this.extraWindows].some(extra => !extra.isDestroyed() && extra.isVisible())
  }

  /**
   * The collapse transform: remember the frame, glide the window toward the
   * bar's column, then hide it. The window is hidden, never torn down, so
   * sessions, layout and drafts stay exactly as they are (Askbar design spec:
   * a transform is never a restart). macOS animates the glide; other
   * platforms move instantly and hide on the same timer.
   * @param target - the Askbar column to glide toward; undefined hides in place.
   * @param ms - the transform's animation budget.
   * @param afterHide - runs once the window has hidden.
   */
  collapseToward(target: DockRectangle | undefined, ms: number, afterHide?: () => void): void {
    const window = this.window
    // The windows New Window opened leave with the first one and come back
    // with it; only the first window glides.
    const extras = [...this.extraWindows].filter(extra => !extra.isDestroyed() && extra.isVisible())
    for (const extra of extras) {
      if (extra.isFullScreen()) extra.setFullScreen(false)
      extra.hide()
    }
    this.collapsedExtraWindows.push(...extras)
    if (window === undefined || window.isDestroyed() || !window.isVisible()) {
      if (extras.length > 0) afterHide?.()
      return
    }
    // A window hidden while in macOS full screen leaves its empty space on
    // screen: the bar over a black desktop (JJ, 16 Sep 2026: "minimode
    // launched on a full black screen"). Leave full screen first and glide
    // once the window is back in its frame.
    if (window.isFullScreen()) {
      this.preCollapseFullScreen = true
      window.once('leave-full-screen', () => { this.collapseToward(target, ms, afterHide) })
      window.setFullScreen(false)
      return
    }
    const frame = window.getBounds()
    this.preCollapseFrame = frame
    if (target !== undefined) {
      window.setBounds({ x: target.x, y: frame.y, width: Math.max(target.width, 240), height: frame.height }, true)
    }
    setTimeout(() => {
      if (window.isDestroyed()) return
      // The glide is a native animation on macOS and hiding a window while
      // one is in flight left it on screen at the animation's frame (seen
      // 13 Sep 2026 under Stage Manager: the page never reported hidden).
      // Setting the bounds plainly ends the animation before the hide.
      if (target !== undefined) window.setBounds(window.getBounds())
      window.hide()
      // Restored while hidden, so the next show lands where the user left.
      window.setBounds(frame)
      afterHide?.()
    }, ms)
  }

  /** The expand transform: show the window on its remembered frame. */
  expandRestored(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const frame = this.preCollapseFrame
    this.preCollapseFrame = undefined
    if (frame !== undefined && !window.isVisible()) window.setBounds(frame)
    const fullScreen = this.preCollapseFullScreen
    this.preCollapseFullScreen = false
    // The collapse handed activation to the app behind; the expand takes it back.
    app.focus({ steal: true })
    this.show()
    // Back into full screen only after the show, so the window returns to
    // its own space rather than reopening the empty one it left.
    if (fullScreen && !window.isDestroyed()) window.setFullScreen(true)
    // macOS re-cascades a window that was created without an explicit
    // position on every show, shoving it off the restored frame; pinning
    // the frame again after the show wins deterministically.
    if (frame !== undefined && !window.isDestroyed()) window.setBounds(frame)
    const extras = this.collapsedExtraWindows
    this.collapsedExtraWindows = []
    for (const extra of extras) if (!extra.isDestroyed()) extra.showInactive()
  }

  async showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
    const window = this.window
    return window === undefined || window.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
  }

  async showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const window = this.window
    return window === undefined || window.isDestroyed()
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options)
  }

  refreshTrayMenu(): void {
    if (this.tray === undefined) return
    this.tray.setContextMenu(Menu.buildFromTemplate(this.options.buildTrayTemplate()))
  }

  refreshThemeMaterial(): void {
    if (this.window !== undefined && !this.window.isDestroyed()) this.options.platform.refreshThemeMaterial(this.window)
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    this.options.stopRendererBootMonitoring()

    const window = this.window
    const tray = this.tray
    this.window = undefined
    this.tray = undefined
    for (const extra of this.extraWindows) if (!extra.isDestroyed()) extra.destroy()
    this.extraWindows.clear()
    this.collapsedExtraWindows = []
    if (window === undefined) return

    this.cleanupListeners?.()
    this.cleanupListeners = undefined
    tray?.destroy()
    if (!window.isDestroyed()) window.destroy()
  }
}

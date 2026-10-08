/**
 * The startup ident's window: a small frameless panel that plays the owl
 * ident from the moment Electron is ready until the first real IDEalize
 * window shows. Launch otherwise showed nothing for 6 s on warm data and
 * 37 s on a first run (JJ, 8 Oct 2026).
 *
 * The panel closes itself when any other window shows (the main window, the
 * startup recovery window or Powell), so no startup path has to remember it.
 * Startup failure paths call `close()` as well.
 */

import { app, BrowserWindow, screen } from 'electron'
import { STARTUP_IDENT_OWL } from './startup-ident-owl.ts'
import { STARTUP_IDENT_HEIGHT, STARTUP_IDENT_WIDTH, startupIdentHtml } from './startup-ident-page.ts'

/** A shown ident; `close()` is safe to call more than once. */
export interface StartupIdent {
  close(): void
}

/**
 * Open the ident panel.
 * @param version - the product version printed under the name.
 * @returns a handle that closes the panel.
 */
export function openStartupIdent(version: string): StartupIdent {
  // Centred by hand on the display under the pointer: macOS's own centring
  // puts a window about a sixth of the screen above the middle.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const window = new BrowserWindow({
    width: STARTUP_IDENT_WIDTH,
    height: STARTUP_IDENT_HEIGHT,
    x: Math.round(area.x + (area.width - STARTUP_IDENT_WIDTH) / 2),
    y: Math.round(area.y + (area.height - STARTUP_IDENT_HEIGHT) / 2),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Shown at once: the boot that follows keeps the main process busy for
    // seconds, so `ready-to-show` arrived 4.5 s late on a warm launch, while
    // the page itself paints from its own process without waiting.
    show: true,
    backgroundColor: '#000000',
    title: 'IDEalize',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  let closed = false
  const onOtherWindow = (_event: unknown, other: BrowserWindow): void => {
    if (other === window) return
    other.once('show', close)
  }
  function close(): void {
    if (closed) return
    closed = true
    app.off('browser-window-created', onOtherWindow)
    if (window.isDestroyed()) return
    // Electron quits when its last window closes, and nothing here overrides
    // that; as the only window (a failure path) the panel hides instead.
    if (BrowserWindow.getAllWindows().length > 1) window.destroy()
    else window.hide()
  }
  app.on('browser-window-created', onOtherWindow)
  // The page only plays its own animation; it never navigates or opens anything.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  window.on('closed', () => { closed = true; app.off('browser-window-created', onOtherWindow) })
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupIdentHtml(version, STARTUP_IDENT_OWL))}`)
  return { close }
}

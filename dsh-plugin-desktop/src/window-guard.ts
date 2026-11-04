/**
 * The navigation rules every app window holds: no page off the harness origin,
 * and outside links handed to the operating system. The app's windows carry the
 * launch cookie and the app's microphone grant, so a remote page must never run
 * inside one.
 */

import { type BrowserWindow, shell } from 'electron'

/** What the guard needs from the window's owner. */
export interface NavigationGuardOptions {
  /** Report a link the operating system refused. */
  readonly logError: (message: string) => void
  /** Guard a same-origin child window; defaults to these same rules. */
  readonly guardChild?: (child: BrowserWindow) => void
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/**
 * Hold one window to its origin.
 * @param window - the window to guard.
 * @param origin - the harness origin the window may stay on.
 * @param options - the error log and the child-window rule.
 * @returns the release for the listeners this added; the window-open handler
 * goes with the window.
 */
export function guardNavigation(window: BrowserWindow, origin: string, options: NavigationGuardOptions): () => void {
  const navigate = (event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>): void => {
    if (!event.isMainFrame) return
    if (originOf(event.url) !== origin) event.preventDefault()
  }
  const redirect = (event: Electron.Event, url: string, _isInPlace: boolean, isMainFrame: boolean): void => {
    if (!isMainFrame) return
    if (originOf(url) !== origin) event.preventDefault()
  }
  const guardChild = options.guardChild ?? ((child: BrowserWindow) => { guardNavigation(child, origin, options) })
  window.webContents.on('will-frame-navigate', navigate)
  window.webContents.on('will-redirect', redirect)
  // A page of the app's own (the subscriptions sign-in page) opens as an
  // app window, which carries the launch cookie the Host's gate demands; the
  // system browser holds no such cookie and would be refused.
  window.webContents.on('did-create-window', guardChild)
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.origin === origin) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 720,
            height: 760,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
          },
        }
      }
      if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
        void shell.openExternal(target.href).catch((cause: unknown) => {
          options.logError(`dsh-plugin-desktop: failed to open external link: ${cause instanceof Error ? cause.message : String(cause)}`)
        })
      }
    } catch {
      // A malformed target is rejected with the same deny result.
    }
    return { action: 'deny' }
  })
  return () => {
    window.webContents.off('did-create-window', guardChild)
    window.webContents.off('will-frame-navigate', navigate)
    window.webContents.off('will-redirect', redirect)
  }
}

/** Loopback Host endpoint carrying the renderer's restorable view state. */
export const DESKTOP_VIEW_STATE_PATH = '/_dsh/desktop/view-state'

/** Renderer state persisted across the restart that applies a shell-mode change. */
export interface DesktopViewState {
  /** Session the user was viewing; the next generation re-opens it. */
  sessionId: string
}

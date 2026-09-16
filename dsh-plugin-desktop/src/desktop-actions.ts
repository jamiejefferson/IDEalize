/** Narrow, generation-scoped native actions available to trusted Host plugins. */

import { type Context, Service } from '@deepseek-ai/cordis'

/** Native actions deliberately exposed without command, path, or restart arguments. */
export interface DesktopActions {
  /** Open the already-configured IDEalize terminal for the active profile. */
  openTerminal(): void
  /** Request one orderly Host-owned application restart. */
  requestRestart(): Promise<void>
  /** Move one absolute path to the OS trash (Electron `shell.trashItem`); the Host fences the path. */
  trashItem(path: string): Promise<void>
  /** Collapse to the Askbar: show the bar and hide the main window (never torn down). */
  collapseToBar(): void
  /** Expand from the Askbar: show the main window on its remembered frame. */
  expandFromBar(): void
  /**
   * Hold the Askbar window at a width, so a panel wider than the bar's column
   * is not cut off at the window edge. The column keeps its screen edge.
   * @param width - the window width to hold; the column's own width gives the room back.
   */
  setBarWidth(width: number): void
  /**
   * Give the Askbar window the keyboard for its panel, or hand it back to the
   * app behind. The window is a non-activating panel, so neither brings the
   * app forward.
   * @param focus - true to take the keyboard, false to give it back.
   */
  focusBar(focus: boolean): void
  /**
   * Raise one OS notification. Silently does nothing where the platform does
   * not support notifications or the user has denied them: a Host plugin
   * telling the user something is finished has no recovery to offer if the
   * notification centre refuses it.
   * @param notification - the notification's heading and message.
   */
  notify(notification: { title: string; body: string }): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Narrow native actions safe for optional Host-plugin integration. */
    desktopActions: DesktopActions
  }
}

/** Launcher-owned implementations behind the narrow service boundary. */
export interface DesktopActionsBootstrap {
  openTerminal(): void
  requestRestart(): void | Promise<void>
  trashItem(path: string): Promise<void>
  collapseToBar(): void
  expandFromBar(): void
  setBarWidth(width: number): void
  focusBar(focus: boolean): void
  notify(notification: { title: string; body: string }): void
}

/** Publish only terminal-open, restart, trash, bar (transform, width, keyboard) and notification operations for one Cordis generation. */
export class DesktopActionsService extends Service implements DesktopActions {
  private disposed = false
  private restartCompleted = false
  private restartOperation: Promise<void> | undefined

  constructor(ctx: Context, private readonly bootstrap: DesktopActionsBootstrap) {
    super(ctx, 'desktopActions')
    ctx.effect(
      () => () => { this.disposed = true },
      'dsh-plugin-desktop: desktop actions lifetime',
    )
  }

  openTerminal(): void {
    this.assertActive()
    this.bootstrap.openTerminal()
  }

  collapseToBar(): void {
    this.assertActive()
    this.bootstrap.collapseToBar()
  }

  notify(notification: { title: string; body: string }): void {
    this.assertActive()
    this.bootstrap.notify(notification)
  }

  expandFromBar(): void {
    this.assertActive()
    this.bootstrap.expandFromBar()
  }

  setBarWidth(width: number): void {
    this.assertActive()
    this.bootstrap.setBarWidth(width)
  }

  focusBar(focus: boolean): void {
    this.assertActive()
    this.bootstrap.focusBar(focus)
  }

  trashItem(path: string): Promise<void> {
    this.assertActive()
    return this.bootstrap.trashItem(path)
  }

  requestRestart(): Promise<void> {
    try {
      this.assertActive()
      if (this.restartCompleted) return Promise.resolve()
      if (this.restartOperation !== undefined) return this.restartOperation
      const operation = (async () => {
        this.assertActive()
        await this.bootstrap.requestRestart()
        this.restartCompleted = true
      })()
      this.restartOperation = operation
      void operation.catch(() => {
        if (this.restartOperation === operation) this.restartOperation = undefined
      })
      return operation
    } catch (cause) {
      return Promise.reject(cause)
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('dsh-plugin-desktop: desktopActions service disposed')
  }
}

export default DesktopActionsService

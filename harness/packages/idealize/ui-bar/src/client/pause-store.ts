/**
 * The window's read of the pause on every agent (feedback 495cec0a), behind
 * the sidebar's Pause control. The host owns the pause (`@idealize/comm`'s
 * `/idealize/pause`); this store reads it, re-reads it whenever the host
 * announces a change on the bridge feed (a press from the quit dialog lands
 * here too), and presses its three buttons.
 *
 * Resume names the Terminal chats it could not reach because their shell was
 * closed (the app restarted). The store opens each one's shell through the
 * terminal route, which launches its CLI on its conversation; the host types
 * the carry-on line once that CLI is at its prompt.
 * @module @idealize/ui-bar/client/pause-store
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { followBridgeFeed } from '@idealize/askbar/src/client/bridge-feed.ts'

/** The route the host serves the pause on. */
export const PAUSE_PATH = '/idealize/pause'

/** The terminal route that opens a chat's shell and launches its CLI. */
const TERMINAL_OPEN_PATH = '/idealize/terminal/open'

/** The size a shell opens at before any view shows it; the view refits it on attach. */
const BACKGROUND_SHELL = { cols: 120, rows: 32 }

/** Where every agent stands (restated from `@idealize/comm`'s wire body). */
export type PausePhase = 'running' | 'saving' | 'paused'

/** The pause as the host serves it. */
export interface PauseView {
  phase: PausePhase
  since?: string
  chats: { id: string; label: string; kind: 'chat' | 'terminal'; state: 'saving' | 'stopped' }[]
  /** Agents still writing their notes. */
  saving: number
  /** Agents working right now, counted while running. */
  working: number
}

/** A Terminal chat whose shell Resume asks the window to open. */
export interface ShellToOpen {
  sessionId: string
  cwd?: string
  activity?: string
}

/** The three presses. */
export type PauseAction = 'pause' | 'stop' | 'resume'

/** What the control renders from. */
export interface PauseState {
  /** The host's pause; null until the first read lands, or where no host serves it. */
  pause: PauseView | null
  /** A press is on its way. */
  busy: boolean
  /** The last press's failure, in the host's words. */
  error: string | null
}

/** How the store reaches the host; a test swaps it. */
export interface PauseTransport {
  read(): Promise<PauseView | null>
  press(action: PauseAction): Promise<PauseView & { open?: ShellToOpen[] }>
  openShell(shell: ShellToOpen): Promise<void>
}

/** The host's routes over fetch. */
export const httpPauseTransport: PauseTransport = {
  async read() {
    const response = await fetch(PAUSE_PATH)
    return response.ok ? await response.json() as PauseView : null
  },
  async press(action) {
    const response = await fetch(PAUSE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ action }),
    })
    const body = await response.json() as (PauseView & { open?: ShellToOpen[] }) | { error?: string }
    if (!response.ok || !('phase' in body)) throw new Error('error' in body && typeof body.error === 'string' ? body.error : `pause: ${String(response.status)}`)
    return body
  },
  async openShell(shell) {
    const response = await fetch(TERMINAL_OPEN_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({
        key: shell.sessionId,
        ...shell.cwd === undefined ? {} : { cwd: shell.cwd },
        ...shell.activity === undefined ? {} : { activity: shell.activity },
        ...BACKGROUND_SHELL,
      }),
    })
    if (!response.ok) throw new Error(`terminal open: ${String(response.status)}`)
  },
}

/** The pause store: one per window. */
export class PauseStore {
  readonly store: SnapshotStore<PauseState> = createSnapshotStore<PauseState>({ pause: null, busy: false, error: null })

  /** @param transport - how the store reaches the host. */
  constructor(private readonly transport: PauseTransport = httpPauseTransport) {}

  /** Read the pause from the host; a failed read keeps what the store holds. */
  async load(): Promise<void> {
    try {
      const pause = await this.transport.read()
      this.store.update((draft) => { draft.pause = pause })
    } catch {
      // The control keeps its last read; the next announcement retries.
    }
  }

  /**
   * Press one of the control's buttons, then open the shells Resume names.
   * @param action - pause, stop or resume.
   */
  async press(action: PauseAction): Promise<void> {
    if (this.store.getSnapshot().busy) return
    this.store.update((draft) => { draft.busy = true; draft.error = null })
    try {
      const { open = [], ...pause } = await this.transport.press(action)
      this.store.update((draft) => { draft.pause = pause })
      for (const shell of open) {
        await this.transport.openShell(shell).catch(() => {
          // The chat keeps its line owed; opening the chat later opens the shell and types it.
        })
      }
    } catch (error) {
      this.store.update((draft) => { draft.error = error instanceof Error ? error.message : String(error) })
    } finally {
      this.store.update((draft) => { draft.busy = false })
    }
  }

  /**
   * Read the pause now and again on every change the host announces.
   * @returns a function that stops following.
   */
  start(): () => void {
    let closed = false
    let close: (() => void) | undefined
    void this.load()
    void followBridgeFeed((frame) => {
      if (frame.kind === 'pause-changed') void this.load()
    }).then((attachment) => {
      if (closed) attachment?.close()
      else close = () => { attachment?.close() }
    })
    return () => {
      closed = true
      close?.()
    }
  }
}

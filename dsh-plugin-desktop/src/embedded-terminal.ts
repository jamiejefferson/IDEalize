/**
 * Embedded terminals for the in-chat Chat⇄Terminal toggle.
 *
 * The Electron main process owns the PTYs (node-pty); the web client draws
 * them with xterm.js through the `@idealize/ui-terminal` host routes, which
 * probe this service (`ctx.get('desktopTerminals')`) the same way the bar
 * probes `desktopActions`. Browsers without the desktop shell never see the
 * service, so they never see the toggle.
 *
 * One terminal per key (the chat's session id): reopening a chat's terminal
 * reattaches to the live shell and replays its recent output instead of
 * spawning again.
 */

import { type Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

/** The node-pty surface this service uses (kept narrow so tests fake it). */
export interface EmbeddedPtyProcess {
  readonly pid: number
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

/** node-pty's `spawn` shape (file, args, options). */
export type EmbeddedPtySpawn = (
  file: string,
  args: string[],
  options: {
    name: string
    cols: number
    rows: number
    cwd: string
    env: Record<string, string>
  },
) => EmbeddedPtyProcess

/** Events a subscriber receives from one embedded terminal. */
export type EmbeddedTerminalEvent =
  | { kind: 'data'; data: string }
  | { kind: 'exit'; exitCode: number }

/** One live (or exited) embedded terminal. */
export interface DesktopEmbeddedTerminal {
  /** Stable id handed to the client. */
  readonly id: string
  /** Reuse key (the chat's session id), when the opener supplied one. */
  readonly key: string | undefined
  /** Working directory the shell started in. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  /** Exit status once the shell has ended; undefined while it runs. */
  readonly exit: { exitCode: number } | undefined
  /** Recent output (capped), for redrawing the grid on reattach. */
  replay(): string
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Receive live output and the exit; returns the unsubscribe. */
  subscribe(listener: (event: EmbeddedTerminalEvent) => void): () => void
  /** End the shell and forget the terminal. */
  close(): void
}

/** Inputs for opening (or reattaching to) one embedded terminal. */
export interface OpenEmbeddedTerminalOptions {
  /** Reuse key: an open terminal with this key is returned instead of a new one. */
  key?: string
  cwd: string
  cols?: number
  rows?: number
}

/** The Host-facing service. */
export interface DesktopTerminals {
  open(options: OpenEmbeddedTerminalOptions): DesktopEmbeddedTerminal
  get(id: string): DesktopEmbeddedTerminal | undefined
  list(): readonly DesktopEmbeddedTerminal[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Embedded PTYs for the in-chat terminal; present only under the desktop shell. */
    desktopTerminals: DesktopTerminals
  }
}

/** Launcher-owned inputs. */
export interface DesktopTerminalsBootstrap {
  /** node-pty's spawn (or a fake in tests). */
  spawn: EmbeddedPtySpawn
  /** Host platform; selects the default shell. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Environment copied into each shell; defaults to `process.env`. */
  environment?: NodeJS.ProcessEnv
  /** Most terminals alive at once; opening past it throws. Defaults to 24. */
  limit?: number
}

/** Replay buffer cap per terminal (bytes of UTF-16 code units, roughly). */
export const REPLAY_CAP = 256 * 1024

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_LIMIT = 24

/**
 * The shell command and arguments for one platform.
 *
 * Windows gets Windows PowerShell 5.1, which every Windows 10 and 11 carries.
 * The harness types an agent's launch line into this shell
 * (`@idealize/ui-terminal`), and that line reads a file into an argument and
 * clears the prompt first; cmd.exe can do neither, so under it every Terminal
 * brain answered "'claude' is not recognized" (PC test drive of 1.0.3, 18 Sep
 * 2026). 5.1 rather than PowerShell 7 because the two pass quoted arguments
 * to a native program differently, and the launch line is written for one.
 * `RemoteSigned` holds for this process only: an npm-installed CLI is a local
 * `.ps1` shim, which the client default policy (Restricted) refuses to run.
 * cmd.exe remains the fallback for a machine without PowerShell.
 * @param platform - the host platform.
 * @param environment - the launcher's environment.
 * @param exists - whether a file exists; injected by tests.
 * @returns the shell to spawn.
 */
export function defaultShell(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): { file: string; args: string[] } {
  if (platform === 'win32') {
    const powershell = win32.join(environment.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (exists(powershell)) return { file: powershell, args: ['-NoLogo', '-ExecutionPolicy', 'RemoteSigned'] }
    return { file: environment.COMSPEC ?? 'cmd.exe', args: [] }
  }
  const shell = environment.SHELL ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // A login shell so the user's PATH and prompt are the ones their own
  // terminal app would show.
  return { file: shell, args: ['-l'] }
}

/**
 * The environment a shell receives: the launcher's, minus Electron's
 * Node-mode switch (which would turn every child `node` into Electron), plus
 * the terminal identity xterm.js renders.
 */
export function shellEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const copy: Record<string, string> = {}
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue
    if (key === 'ELECTRON_RUN_AS_NODE') continue
    copy[key] = value
  }
  copy.TERM = 'xterm-256color'
  copy.COLORTERM = 'truecolor'
  copy.TERM_PROGRAM = 'IDEalize'
  return copy
}

class EmbeddedTerminal implements DesktopEmbeddedTerminal {
  readonly id = randomUUID()
  cols: number
  rows: number
  exit: { exitCode: number } | undefined = undefined
  // Output is kept as the chunks it arrived in. Appending to one string and
  // slicing it back to the cap copied up to 256 KB on the main process for
  // every chunk once a terminal had produced that much.
  private chunks: string[] = []
  private buffered = 0
  private readonly listeners = new Set<(event: EmbeddedTerminalEvent) => void>()
  private readonly process: EmbeddedPtyProcess
  private readonly subscriptions: Array<{ dispose(): void }> = []

  constructor(
    readonly key: string | undefined,
    readonly cwd: string,
    cols: number,
    rows: number,
    spawn: EmbeddedPtySpawn,
    shell: { file: string; args: string[] },
    env: Record<string, string>,
    private readonly onClosed: (terminal: EmbeddedTerminal) => void,
  ) {
    this.cols = cols
    this.rows = rows
    this.process = spawn(shell.file, shell.args, { name: 'xterm-256color', cols, rows, cwd, env })
    this.subscriptions.push(
      this.process.onData((data) => {
        this.chunks.push(data)
        this.buffered += data.length
        // Drop whole chunks from the head while what is left still covers the cap.
        while (this.chunks.length > 1 && this.buffered - this.chunks[0]!.length >= REPLAY_CAP) {
          this.buffered -= this.chunks.shift()!.length
        }
        this.emit({ kind: 'data', data })
      }),
      this.process.onExit(({ exitCode }) => {
        this.exit = { exitCode }
        this.emit({ kind: 'exit', exitCode })
      }),
    )
  }

  replay(): string {
    const joined = this.chunks.join('')
    const replay = joined.length > REPLAY_CAP ? joined.slice(joined.length - REPLAY_CAP) : joined
    this.chunks = replay === '' ? [] : [replay]
    this.buffered = replay.length
    return replay
  }

  write(data: string): void {
    if (this.exit !== undefined) return
    this.process.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.exit !== undefined) return
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.process.resize(cols, rows)
  }

  subscribe(listener: (event: EmbeddedTerminalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    for (const subscription of this.subscriptions) subscription.dispose()
    this.subscriptions.length = 0
    if (this.exit === undefined) {
      try {
        this.process.kill()
      } catch {
        // The shell may already be gone; forgetting it is what matters.
      }
      this.exit = { exitCode: -1 }
      this.emit({ kind: 'exit', exitCode: -1 })
    }
    this.listeners.clear()
    this.onClosed(this)
  }

  private emit(event: EmbeddedTerminalEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}

/** Publish embedded terminals for one Cordis generation. */
export class DesktopTerminalsService extends Service implements DesktopTerminals {
  private readonly terminals = new Map<string, EmbeddedTerminal>()
  private disposed = false

  constructor(ctx: Context, private readonly bootstrap: DesktopTerminalsBootstrap) {
    super(ctx, 'desktopTerminals')
    ctx.effect(
      () => () => {
        this.disposed = true
        for (const terminal of [...this.terminals.values()]) terminal.close()
      },
      'dsh-plugin-desktop: embedded terminals lifetime',
    )
  }

  open(options: OpenEmbeddedTerminalOptions): DesktopEmbeddedTerminal {
    this.assertActive()
    if (options.key !== undefined) {
      const existing = this.byKey(options.key)
      if (existing !== undefined) return existing
    }
    const limit = this.bootstrap.limit ?? DEFAULT_LIMIT
    if (this.terminals.size >= limit) {
      throw new Error(`dsh-plugin-desktop: embedded terminal limit (${limit}) reached`)
    }
    const platform = this.bootstrap.platform ?? process.platform
    const environment = this.bootstrap.environment ?? process.env
    const terminal = new EmbeddedTerminal(
      options.key,
      options.cwd,
      options.cols ?? DEFAULT_COLS,
      options.rows ?? DEFAULT_ROWS,
      this.bootstrap.spawn,
      defaultShell(platform, environment),
      shellEnvironment(environment),
      (closed) => { this.terminals.delete(closed.id) },
    )
    this.terminals.set(terminal.id, terminal)
    return terminal
  }

  get(id: string): DesktopEmbeddedTerminal | undefined {
    return this.terminals.get(id)
  }

  list(): readonly DesktopEmbeddedTerminal[] {
    return [...this.terminals.values()]
  }

  private byKey(key: string): EmbeddedTerminal | undefined {
    for (const terminal of this.terminals.values()) {
      if (terminal.key === key && terminal.exit === undefined) return terminal
    }
    return undefined
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('dsh-plugin-desktop: desktopTerminals service disposed')
  }
}

export default DesktopTerminalsService

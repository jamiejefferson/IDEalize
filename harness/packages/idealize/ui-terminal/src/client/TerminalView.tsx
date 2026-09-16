/**
 * The terminal face of a chat: an xterm.js grid attached to the desktop
 * shell's PTY for this chat (keyed by session id, opened in the chat's
 * working directory). Output arrives over SSE, keystrokes and resizes go back
 * as POSTs. The xterm instance is cached per session, so flipping to chat and
 * back keeps the scrollback without a redraw. The appearance panel's terminal
 * paint (theme, font, line height, margins) arrives through
 * {@link applyTerminalPaint} and restyles every cached and future grid;
 * without it the grid sits on the page's alias tokens.
 */
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
// Type-only: the paint object the appearance service resolves (the client
// bundle purity gate forbids cross-plugin value imports).
import type { TerminalPaint } from '@idealize/appearance/client'
import { XTERM_CSS } from './xterm-css.ts'
import css from './TerminalView.module.css'

const STYLE_ID = 'idealize-xterm-css'

function ensureXtermStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = XTERM_CSS
  document.head.append(style)
}

/** The transport the view talks to (the host routes; swapped in tests). */
export interface TerminalTransport {
  open(input: {
    key: string
    cwd: string | undefined
    cols: number
    rows: number
    /** The chat's activity preset id; the host types that activity's launch command into a fresh shell. */
    activity: string | undefined
    /** A bare shell (the tool rail's Terminal pane): no launch command, and no chat recorded for the key. */
    plain?: boolean
  }): Promise<{ id: string }>
  stream(id: string, onEvent: (event: StreamEvent) => void, onError: () => void): () => void
  input(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  /**
   * End the shell so the next open starts a fresh one. Awaited, because the
   * host reattaches an open shell by key: reopening before the close lands
   * would hand back the very process the caller asked to replace.
   * @param id - the terminal id the open reported.
   * @returns once the host has ended the shell.
   */
  close(id: string): Promise<void>
}

/** Events the stream carries. */
export type StreamEvent =
  | { kind: 'replay'; data: string }
  | { kind: 'data'; data: string }
  | { kind: 'exit'; exitCode: number }

const AUTH_HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** The production transport over `/idealize/terminal/*`. */
export const httpTransport: TerminalTransport = {
  async open(input) {
    const response = await fetch('/idealize/terminal/open', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(`open failed (${response.status})`)
    return await response.json() as { id: string }
  },
  stream(id, onEvent, onError) {
    const source = new EventSource(`/idealize/terminal/stream?id=${encodeURIComponent(id)}`)
    source.onmessage = (message) => { onEvent(JSON.parse(message.data as string) as StreamEvent) }
    source.onerror = () => { onError() }
    return () => { source.close() }
  },
  input(id, data) {
    void fetch('/idealize/terminal/input', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ id, data }) })
      .catch(() => {})
  },
  resize(id, cols, rows) {
    void fetch('/idealize/terminal/resize', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ id, cols, rows }) })
      .catch(() => {})
  },
  async close(id) {
    await fetch('/idealize/terminal/close', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ id }) })
      .catch(() => undefined)
  },
}

/** One chat's live grid + connection, kept across view switches. */
interface Attachment {
  terminal: Terminal
  fit: FitAddon
  id: string | undefined
  detach: (() => void) | undefined
  exited: number | undefined
  /** Bytes the server already replayed; a reconnect skips that prefix. */
  replayed: number
  listeners: Set<() => void>
  /** The transport that opened the PTY (a paint-driven refit resizes through it). */
  transport: TerminalTransport | undefined
}

const attachments = new Map<string, Attachment>()

/**
 * The brain a restarted shell reopens on, keyed by session.
 *
 * A started chat's agent preset is fixed by the host, so the session summary
 * still reports the preset the chat began under after an in-session brain
 * switch. This map carries the chosen brain from {@link restartTerminal} to the
 * reopen that follows it, so the fresh shell types the new brain's launch
 * command rather than the one the chat started on.
 */
const restartBrains = new Map<string, string>()

/** Views waiting to be told their shell was replaced under them. */
const restartListeners = new Set<(sessionId: string) => void>()

/** Forget every cached grid (plugin unload). */
export function disposeTerminals(): void {
  for (const attachment of attachments.values()) {
    attachment.detach?.()
    attachment.terminal.dispose()
  }
  attachments.clear()
  restartBrains.clear()
}

/**
 * Restart one chat's shell on another brain: end the running shell, drop its
 * cached grid, and let the mounted view reopen on the new brain's launch
 * command. The scrollback and whatever the running agent held in context do
 * not survive, which is why every caller confirms with the user first.
 *
 * The close is awaited before the view is told: the host reattaches an open
 * shell by session key, so reopening any sooner would hand back the same
 * process.
 * @param sessionId - the chat whose shell restarts.
 * @param brainId - the agent preset id whose launch command the fresh shell gets.
 * @returns once the old shell is gone and the reopen has been asked for.
 */
export async function restartTerminal(sessionId: string, brainId: string): Promise<void> {
  restartBrains.set(sessionId, brainId)
  const attachment = attachments.get(sessionId)
  if (attachment !== undefined) {
    attachments.delete(sessionId)
    attachment.detach?.()
    attachment.terminal.dispose()
    const { id, transport } = attachment
    if (id !== undefined) await (transport ?? httpTransport).close(id)
  }
  for (const listener of [...restartListeners]) listener(sessionId)
}

/**
 * End one chat's shell for good: the chat was archived, so its process has no
 * row to come back to (JJ, 2 Sep 2026: archiving a Terminal chat is how it
 * closes). Nothing to do when the chat never opened a shell here.
 * @param sessionId - the archived chat.
 * @returns once the host has been asked to close the shell.
 */
export async function closeTerminal(sessionId: string): Promise<void> {
  const attachment = attachments.get(sessionId)
  if (attachment === undefined) return
  attachments.delete(sessionId)
  restartBrains.delete(sessionId)
  attachment.detach?.()
  attachment.terminal.dispose()
  const { id, transport } = attachment
  if (id !== undefined) await (transport ?? httpTransport).close(id)
}

function notify(attachment: Attachment): void {
  for (const listener of attachment.listeners) listener()
}

function createAttachment(): Attachment {
  const terminal = new Terminal({
    cursorBlink: true,
    // V0's bar cursor, in the theme's cursor colour; not a setting.
    cursorStyle: 'bar',
    allowProposedApi: true,
    fontFamily: paint?.fontFamily ?? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: paint?.fontSize ?? 13,
    lineHeight: paint?.lineHeight ?? 1.2,
    scrollback: 5000,
    theme: paint === undefined ? themeFromPage() : xtermTheme(paint),
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  return { terminal, fit, id: undefined, detach: undefined, exited: undefined, replayed: 0, listeners: new Set(), transport: undefined }
}

// ── appearance paint ─────────────────────────────────────────────────────

/**
 * xterm's fixed scrollbar width (`ViewportConstants.DEFAULT_SCROLL_BAR_WIDTH`),
 * which the fit addon subtracts from the host's width before counting columns.
 */
const XTERM_SCROLLBAR_WIDTH = 14

/**
 * The grid host's padding for one paint margin. The right side gives back the
 * scrollbar width the fit addon takes, so the columns reach the same distance
 * from both edges and xterm's overlay scrollbar rides inside the margin.
 * @param margin - the paint's margin in CSS px.
 * @returns the CSS padding shorthand.
 */
export function gridPadding(margin: number): string {
  return `${margin}px ${Math.max(0, margin - XTERM_SCROLLBAR_WIDTH)}px ${margin}px ${margin}px`
}

/**
 * The scrollbar gutter the nearest scrolling ancestor holds back, so the
 * terminal's ground can carry across it (`.root::after`).
 * @param from - the terminal root, the element whose ancestors are searched.
 * @returns the reserved width in CSS px; 0 when no ancestor scrolls.
 */
export function reservedGutter(from: HTMLElement): number {
  for (let el = from.parentElement; el !== null; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    return Math.max(0, el.offsetWidth - el.clientWidth)
  }
  return 0
}

let paint: TerminalPaint | undefined
const paintListeners = new Set<() => void>()

/**
 * The paint currently applied, or undefined while the grid sits on the
 * page's alias tokens.
 * @returns the active paint.
 */
export function currentTerminalPaint(): TerminalPaint | undefined {
  return paint
}

/**
 * xterm's theme object for one paint: the four surface colours plus the 16
 * ANSI slots by name.
 * @param next - the resolved paint.
 * @returns the xterm theme.
 */
export function xtermTheme(next: TerminalPaint): ITheme {
  // The themes carry all 16 slots; a shorter custom array falls back to ink.
  const slot = (index: number): string => next.ansi[index] ?? next.foreground
  return {
    background: next.background,
    foreground: next.foreground,
    cursor: next.cursor,
    selectionBackground: next.selection,
    black: slot(0),
    red: slot(1),
    green: slot(2),
    yellow: slot(3),
    blue: slot(4),
    magenta: slot(5),
    cyan: slot(6),
    white: slot(7),
    brightBlack: slot(8),
    brightRed: slot(9),
    brightGreen: slot(10),
    brightYellow: slot(11),
    brightBlue: slot(12),
    brightMagenta: slot(13),
    brightCyan: slot(14),
    brightWhite: slot(15),
  }
}

/** Restyle one grid from the active paint (page tokens when none). */
function styleTerminal(terminal: Terminal): void {
  if (paint === undefined) {
    terminal.options.theme = themeFromPage()
    return
  }
  terminal.options.theme = xtermTheme(paint)
  terminal.options.fontFamily = paint.fontFamily
  terminal.options.fontSize = paint.fontSize
  terminal.options.lineHeight = paint.lineHeight
}

/**
 * Apply the appearance panel's terminal paint to every cached grid and every
 * grid created after; a font change refits the grid and pushes the new
 * cols/rows to its PTY. Undefined returns to the page-token fallback.
 * @param next - the resolved paint, or undefined to clear.
 */
export function applyTerminalPaint(next: TerminalPaint | undefined): void {
  paint = next
  for (const attachment of attachments.values()) {
    styleTerminal(attachment.terminal)
    if (attachment.terminal.element !== undefined) {
      attachment.fit.fit()
      if (attachment.id !== undefined && attachment.exited === undefined) {
        attachment.transport?.resize(attachment.id, attachment.terminal.cols, attachment.terminal.rows)
      }
    }
    notify(attachment)
  }
  for (const listener of paintListeners) listener()
}

/**
 * A colour at an opacity, in the forms xterm's theme parser accepts:
 * `#RRGGBB` gains an alpha byte, `rgb(...)` becomes `rgba(...)`; any other
 * form (a `var()` the page has not resolved, an empty token) is returned as
 * given.
 * @param colour - a computed `#RRGGBB` or `rgb(r, g, b)` string.
 * @param alpha - opacity 0–1.
 * @returns the translucent colour.
 */
export function withAlpha(colour: string, alpha: number): string {
  const trimmed = colour.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return `${trimmed}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
  const rgb = /^rgb\(\s*([^)]*?)\s*\)$/i.exec(trimmed)
  if (rgb !== null) return `rgba(${rgb[1]}, ${alpha})`
  return trimmed
}

/**
 * Read the page's alias tokens so the grid sits on the shell's own paper; the
 * selection is the accent at 35%, so it follows the theme like the cursor.
 * The literal fallbacks only cover a page without the token sheets (tests).
 */
function themeFromPage(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback
  const cursor = read('--dsw-alias-brand-primary', '#5b8def')
  return {
    background: read('--dsw-alias-bg-layer-1', '#1c1c1e'),
    foreground: read('--dsw-alias-label-primary', '#e6e6e6'),
    cursor,
    selectionBackground: withAlpha(cursor, 0.35),
  }
}

async function connect(
  attachment: Attachment,
  transport: TerminalTransport,
  input: { key: string; cwd: string | undefined; activity: string | undefined; plain: boolean },
  onError: (message: string) => void,
): Promise<void> {
  const { terminal } = attachment
  attachment.transport = transport
  let id: string
  try {
    const opened = await transport.open({
      key: input.key, cwd: input.cwd, activity: input.activity, cols: terminal.cols, rows: terminal.rows,
      ...(input.plain ? { plain: true } : {}),
    })
    id = opened.id
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error))
    return
  }
  attachment.id = id
  attachment.exited = undefined
  transport.resize(id, terminal.cols, terminal.rows)
  const keys = terminal.onData((data) => { transport.input(id, data) })
  const detachStream = transport.stream(id, (event) => {
    if (event.kind === 'replay') {
      // A reconnect replays what this grid already holds; write only the tail.
      const fresh = event.data.slice(attachment.replayed)
      attachment.replayed = event.data.length
      if (fresh !== '') terminal.write(fresh)
      return
    }
    if (event.kind === 'data') {
      attachment.replayed = Math.min(attachment.replayed + event.data.length, 256 * 1024)
      terminal.write(event.data)
      return
    }
    attachment.exited = event.exitCode
    notify(attachment)
  }, () => {
    // EventSource retries on its own; nothing to do until the shell exits.
  })
  attachment.detach = () => {
    keys.dispose()
    detachStream()
    attachment.detach = undefined
  }
  notify(attachment)
}

/** Props the view ring gives the terminal entry. */
export interface TerminalViewProps {
  sessionId: string
  /** The chat's working directory (undefined falls back to home on the host). */
  cwd: string | undefined
  /** The chat's activity preset id (selects the fresh shell's launch command; undefined = the default). */
  activity?: string | undefined
  /**
   * A bare shell: the host types no launch command and records no chat for
   * the key. The tool rail's Terminal pane opens this way, so its key names
   * no chat and its output is nobody's run.
   */
  plain?: boolean
  transport?: TerminalTransport
  t: (key: 'terminal.connecting' | 'terminal.exited' | 'terminal.restart' | 'terminal.error') => string
}

/**
 * The terminal view.
 * @param props - session identity, directory, and copy.
 * @returns the grid.
 */
export function TerminalView({ sessionId, cwd, activity, plain = false, transport = httpTransport, t }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [, bump] = useState(0)
  // A brain switch replaces the shell out from under a mounted view; the
  // counter is what re-runs the attach effect, which reopens on the new brain.
  const [generation, setGeneration] = useState(0)

  // Margin and ground re-render when the appearance paint changes.
  useEffect(() => {
    const rerender = (): void => { bump(n => n + 1) }
    paintListeners.add(rerender)
    return () => { paintListeners.delete(rerender) }
  }, [])

  // The ground's reach across the scroller's reserved gutter. Measured rather
  // than assumed: the width is the platform's, and the gutter disappears
  // entirely in a shell whose view area does not scroll.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const measure = (): void => {
      root.style.setProperty('--idealize-terminal-bleed', `${String(reservedGutter(root))}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    const onRestart = (restarted: string): void => {
      if (restarted === sessionId) setGeneration(n => n + 1)
    }
    restartListeners.add(onRestart)
    return () => { restartListeners.delete(onRestart) }
  }, [sessionId])

  useEffect(() => {
    ensureXtermStyles()
    const host = hostRef.current
    if (host === null) return
    let attachment = attachments.get(sessionId)
    if (attachment === undefined) {
      attachment = createAttachment()
      attachments.set(sessionId, attachment)
    }
    const current = attachment
    const rerender = (): void => { bump(n => n + 1) }
    current.listeners.add(rerender)
    // xterm ignores a second open(); a cached grid moves its element by hand.
    if (current.terminal.element !== undefined) host.append(current.terminal.element)
    else current.terminal.open(host)
    current.fit.fit()
    current.terminal.focus()
    if (current.id === undefined) {
      // The switched-to brain wins over the chat's preset: a started chat keeps
      // the preset it began under, so the summary cannot report the new brain.
      const launchAs = restartBrains.get(sessionId) ?? activity
      void connect(current, transport, { key: sessionId, cwd, activity: launchAs, plain }, setError)
    }
    const observer = new ResizeObserver(() => {
      current.fit.fit()
      if (current.id !== undefined && current.exited === undefined) {
        transport.resize(current.id, current.terminal.cols, current.terminal.rows)
      }
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      current.listeners.delete(rerender)
      // The grid stays alive in the cache; only its DOM moves out with us.
      current.terminal.element?.remove()
    }
  }, [sessionId, cwd, plain, transport, generation])

  const attachment = attachments.get(sessionId)
  const exited = attachment?.exited

  const restart = (): void => {
    const stale = attachments.get(sessionId)
    stale?.detach?.()
    stale?.terminal.dispose()
    attachments.delete(sessionId)
    setError(undefined)
    bump(n => n + 1)
  }

  return (
    <div ref={rootRef} className={css.root} data-testid="idealize-terminal" style={paint === undefined ? undefined : { background: paint.background }}>
      <div ref={hostRef} className={css.grid} style={paint === undefined ? undefined : { padding: gridPadding(paint.margin) }} />
      {error !== undefined && (
        <div className={css.notice} role="alert">
          <span>{t('terminal.error')}: {error}</span>
          <button type="button" className={css.button} onClick={restart}>{t('terminal.restart')}</button>
        </div>
      )}
      {error === undefined && attachment?.id === undefined && (
        <div className={css.notice}>{t('terminal.connecting')}</div>
      )}
      {exited !== undefined && (
        <div className={css.notice} role="status">
          <span>{t('terminal.exited')} ({exited})</span>
          <button type="button" className={css.button} onClick={restart}>{t('terminal.restart')}</button>
        </div>
      )}
    </div>
  )
}

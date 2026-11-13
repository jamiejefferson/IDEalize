/**
 * @idealize/ui-terminal — Host half of the Chat⇄Terminal toggle.
 *
 * Serves the loopback routes the browser half drives its xterm.js grid with:
 * - `GET  /idealize/terminal/capabilities` — `{ embedded }`: whether the
 *   desktop shell's `desktopTerminals` service is composed here. Browsers
 *   without it get `false` and never see the toggle.
 * - `GET  /idealize/terminal/launches` — `{ default, byActivity }`: the launch
 *   commands this deployment is configured with. The composer's brain menu
 *   reads them to say, BEFORE the click, which brains restart the shell.
 * - `POST /idealize/terminal/open` — `{ key, cwd, cols, rows, activity, plain? }`
 *   → `{ id, launch? }`. One shell per key (the chat's session id); reopening
 *   reattaches. The directory is FENCED to home plus the workspace roots
 *   (symlinks resolved). A FRESH shell gets the launch command for the named
 *   activity typed at its first prompt (V0's TerminalSession.start()); a
 *   reattach — the replay buffer already holds output — never does. `launch`
 *   reports the command a fresh open scheduled. A Claude Code, Pi or Codex launch
 *   is typed with IDEalize's standing rules passed on its command line (see
 *   `knowledge.ts`), and a Claude Code or Pi launch names the chat's own
 *   conversation, so a relaunch after a restart reopens it (see
 *   `conversation.ts`); `launch` still reports the configured command, which is
 *   what a brain switch compares. `plain: true` opens a bare
 *   shell for the tool rail's Terminal pane: no launch command, and no chat
 *   recorded for the activity watcher, because the key is not a chat.
 * - `GET  /idealize/terminal/stream?id=` — SSE: a `replay` event carrying
 *   the recent output, then live `data` events and one `exit`.
 * - `POST /idealize/terminal/input` — `{ id, data }` keystrokes.
 * - `POST /idealize/terminal/resize` — `{ id, cols, rows }`.
 * - `POST /idealize/terminal/close` — `{ id }` ends the shell.
 *
 * Same loopback + `x-idealize-auth` fence as the other /idealize routes.
 * @module @idealize/ui-terminal
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { currentSessionKey } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { cliInstalled } from '@idealize/activity-pills'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { gatherKnowledge, promptChannel, withKnowledge, writeKnowledgeFile } from './knowledge.ts'
import { withConversation } from './conversation.ts'
import { LAUNCHES_PATH, launchCommandFor, type TerminalCliOption, type TerminalLaunches } from './launches.ts'
import { QUIET_MS, TerminalActivity } from './activity.ts'
import { programOf, TerminalNudges } from './nudge.ts'
import { takesTurnHooks, TerminalTurns, type TerminalTurn, withTurnHooks, writeTurnHooks } from './turns.ts'
import { TerminalDeliveries, type TerminalDelivery } from './delivery.ts'
import { PromptLines } from './client/prompt-line.ts'
import { resolveSessionTitleLlmConfig, suggestSessionTitle } from '@deepseek-ai/dsh-session-title-llm'

export { LAUNCHES_PATH, launchBrainOf, launchCommandFor } from './launches.ts'
export type { TerminalCliOption, TerminalLaunches } from './launches.ts'
export { gatherKnowledge, KNOWLEDGE_PREAMBLE, KNOWLEDGE_SERVICES, PROMPT_CHANNELS, promptChannel, withKnowledge, writeKnowledgeFile } from './knowledge.ts'
export type { PromptChannel } from './knowledge.ts'
export { claudeConversationExists, CONVERSATION_CHANNELS, conversationId, withConversation } from './conversation.ts'
export type { ConversationChannel } from './conversation.ts'
export { AGENT_PROGRAMS, isAgentProgram, programOf, showsChoice, TerminalNudges } from './nudge.ts'
export type { NudgeOutcome } from './nudge.ts'
export { takesTurnHooks, TerminalTurns, TURN_HOOKS, TURN_HOOKS_FILE, withTurnHooks, writeTurnHooks } from './turns.ts'
export type { TerminalTurn } from './turns.ts'
export { ANSWER_START_MS, TerminalDeliveries } from './delivery.ts'
export type { DeliveryHandle, TerminalDelivery } from './delivery.ts'

/** Stable Cordis plugin name. */
export const name = 'idealize-ui-terminal'

/** The chat-name rule (the profile's session-title-llm config), for terminal chats. */
const TERMINAL_TITLE_CONFIG = resolveSessionTitleLlmConfig({
  targetWords: 3,
  targetCjkCharacters: 8,
  maxCharacters: 32,
  maxInputBytes: 4096,
  maxOutputTokens: 64,
  timeoutMs: 30_000,
})

/** Plugin config. */
export interface Config {
  /**
   * The command typed into a fresh embedded shell once its first prompt
   * output arrives (V0's default launch command). Empty disables the
   * auto-launch.
   */
  launchCommand?: string
  /**
   * Per-activity launch command, keyed by the activity preset id the open
   * request names (the pill the chat launched on); an absent id falls back
   * to `launchCommand`.
   */
  launchByActivity?: Record<string, string>
  /**
   * Whether a Claude Code, Pi or Codex launch carries IDEalize's standing rules
   * (where documentation goes, and whatever else a composed service offers) on
   * its command line, and a Claude Code launch the hooks that report its turns
   * (`turns.ts`). On by default; off types the command as written.
   */
  appendKnowledge?: boolean
  /**
   * The command-line agents the Brains pane offers as launch choices, in
   * order. `command` `''` is a plain shell. The route probes each command's
   * executable through the login shell and serves the verdict alongside.
   */
  clis?: {
    /** Stable choice id the launch settings store. */
    id: string
    /** The row label the pickers show. */
    label: string
    /** What a fresh shell types; `''` is a plain shell. */
    command: string
  }[]
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  launchCommand: z.string().default('claude --dangerously-skip-permissions'),
  launchByActivity: z.dict(z.string()).default({}),
  appendKnowledge: z.boolean().default(true),
  clis: z.array(z.object({
    id: z.string().required(),
    label: z.string().required(),
    command: z.string(),
  })).default([
    { id: 'claude-code', label: 'Claude Code', command: 'claude --dangerously-skip-permissions' },
    { id: 'codex', label: 'Codex CLI', command: 'codex' },
    { id: 'gemini', label: 'Gemini CLI', command: 'gemini' },
    { id: 'kimi', label: 'Kimi CLI', command: 'kimi' },
    { id: 'pi', label: 'Pi', command: 'pi' },
    { id: 'herdr', label: 'Herdr', command: 'herdr' },
    { id: 'opencode', label: 'OpenCode', command: 'opencode' },
    { id: 'aider', label: 'Aider', command: 'aider' },
    { id: 'shell', label: 'Plain shell', command: '' },
  ]),
})

/** This plugin's settings section: the Brains pane's launch choices persist here over the composition value. */
const NS = settingsNamespace('idealize-ui-terminal')

/**
 * Whether a launch command turns its agent's permission prompts off, so the
 * agent edits files and runs commands without asking.
 * @param command - the launch command.
 * @returns true for the known no-prompt switches.
 */
export function skipsPrompts(command: string): boolean {
  return /(^|\s)(--dangerously-skip-permissions|--dangerously-bypass-approvals-and-sandbox|--yolo)(\s|$)/.test(command)
}

/** A launch command the write route accepts: one line, bounded, no control characters. */
const acceptableCommand = (command: unknown): command is string =>
  typeof command === 'string' && command.length <= 200 && !/[\x00-\x1f\x7f]/.test(command)

/** Events one embedded terminal emits (restated from the desktop plugin). */
export type EmbeddedTerminalEvent =
  | { kind: 'data'; data: string }
  | { kind: 'exit'; exitCode: number }

/** The desktop shell's embedded-terminal face (restated; dsh-plugin-desktop owns it). */
export interface DesktopTerminalLike {
  readonly id: string
  readonly cols: number
  readonly rows: number
  readonly exit: { exitCode: number } | undefined
  replay(): string
  write(data: string): void
  resize(cols: number, rows: number): void
  subscribe(listener: (event: EmbeddedTerminalEvent) => void): () => void
  close(): void
  /** The program in front of the shell (`claude`, `zsh`); absent on a desktop shell older than 8 Oct 2026. */
  foreground?(): string | undefined
}

/** What a terminal agent's run is reported to; probed, never injected. */
interface BridgeLike {
  buffer: { push: (event: { kind: 'agent-finished'; title: string; body: string; sessionId: string }) => unknown }
}

/** The Studio slice the group-chat post uses; probed, never injected. */
interface StudioLike {
  record(input: { project: string; author: string; kind: 'message'; body: string }): Promise<unknown>
}

/** Which terminal agents are working right now, for the surfaces that show it. */
export interface IdealizeTerminals {
  /**
   * Which terminal chats are working.
   * @returns the session ids of every terminal chat whose CLI is working.
   */
  working(): string[]
  /**
   * Type a line into a Terminal chat's agent and press Enter, now if it is at
   * its prompt, or when its terminal next falls quiet (see `nudge.ts`).
   * @param sessionId - the chat.
   * @param text - one line.
   * @param wanted - asked before a held line is typed; false drops it.
   * @returns false when the chat has no open terminal here.
   */
  nudge(sessionId: string, text: string, wanted?: () => boolean): boolean
  /**
   * Record what a Terminal chat's agent reported about its turns through its
   * own hooks (`idealize turn`, see `turns.ts`); a stop is the done chime.
   * @param sessionId - the chat.
   * @param turn - what the agent reported.
   * @returns false when the chat has no open terminal here.
   */
  turn(sessionId: string, turn: TerminalTurn): boolean
  /**
   * Type a line into a Terminal chat's agent, as {@link nudge} does, and wait
   * for the agent to answer it (see `delivery.ts`). Pausing every agent uses
   * this to know when each has saved its notes.
   *
   * With `interruptWith`, an agent in the middle of a run is stopped first
   * (Escape), and once its prompt is back its input box is emptied and that
   * line is typed instead of `text` (JJ, 30 Oct 2026: "if a terminal agent is
   * in the middle of a run, the pause button needs to interrupt"). An agent
   * at its prompt gets `text`, as before.
   * @param sessionId - the chat.
   * @param text - one line.
   * @param wanted - asked before a held line is typed; false drops it.
   * @param options - the line for an agent this interrupts.
   * @returns what became of the line, or undefined when the chat has no open terminal here.
   */
  deliver(
    sessionId: string, text: string, wanted?: () => boolean, options?: { interruptWith?: string },
  ): Promise<TerminalDelivery> | undefined
  /**
   * Stop a Terminal chat's agent where it stands: drop any line held for it
   * and, when the agent is working, press Escape, which Claude Code, Codex,
   * Pi and Kimi each take as "stop". An idle agent gets no key: a second
   * Escape at the prompt opens Claude Code's rewind and Codex's backtrack.
   * @param sessionId - the chat.
   * @returns false when the chat has no open terminal here.
   */
  interrupt(sessionId: string): boolean
  /**
   * Hear each time a chat's terminal opens or reattaches here.
   * @param listener - called with the chat's session id.
   * @returns a function that stops the listening.
   */
  onOpened(listener: (sessionId: string) => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizeTerminals: IdealizeTerminals
  }
  interface Events {
    /**
     * A terminal agent started or stopped working, from its shell's output.
     * @mode emit
     * @param change - the terminal's id, the chat it belongs to, and whether it is working now.
     */
    'idealize/terminal-activity': (change: { id: string; sessionId?: string; working: boolean }) => void
  }
}

/**
 * How long a run lasted, in the words the group chat carries.
 * @param ms - the run's duration.
 * @returns `2m 30s`, or `45s` under a minute.
 */
export function describeRun(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

/** The service the routes probe for. */
export interface DesktopTerminalsLike {
  open(options: { key?: string; cwd: string; cols?: number; rows?: number; env?: Record<string, string> }): DesktopTerminalLike
  get(id: string): DesktopTerminalLike | undefined
}

/** Where the probe looks for the desktop service. */
export const DESKTOP_TERMINALS_SERVICE = 'desktopTerminals'

/** Largest accepted grid; past it the request is refused. */
const MAX_COLS = 500
const MAX_ROWS = 300

/**
 * Quiet period the shell must hold after its last output before the launch is
 * typed, so a prompt drawn in several chunks finishes first. Fixed protocol
 * timing, like V0's prompt-event send; not a deployment tunable.
 */
const LAUNCH_AFTER_PROMPT_MS = 300
/**
 * Deadline from the shell opening: the launch is typed by now whatever the
 * shell is doing, so a shell that reports nothing (V0's 2s asyncAfter) and a
 * shell that never falls quiet both still start their agent.
 */
const LAUNCH_FALLBACK_MS = 2000

function refuse(req: IncomingMessage, res: ServerResponse, mutating: boolean): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * A grid dimension from a request body.
 * @param value - the raw body field.
 * @param max - the inclusive cap.
 * @returns the integer when it lies in `[1, max]`, otherwise undefined.
 */
export function gridDimension(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value < 1 || value > max) return undefined
  return value
}

/**
 * Resolve a requested directory and require it inside home or a workspace
 * root (symlinks resolved first, so a link that escapes both is refused).
 * @param raw - the requested directory.
 * @param roots - the workspace roots.
 * @returns the real path, or undefined when refused or missing.
 */
export async function fencedDirectory(raw: string, roots: readonly string[]): Promise<string | undefined> {
  let resolved: string
  try {
    resolved = await realpath(raw)
  } catch {
    return undefined
  }
  const allowed = [homedir(), ...roots]
  const inside = allowed.some(root => resolved === root || resolved.startsWith(root + sep))
  return inside ? resolved : undefined
}

/**
 * Type `command` into a fresh shell once its prompt shows — V0's
 * TerminalSession.start() analogue. Output means the shell is drawing, and
 * the launch waits for {@link LAUNCH_AFTER_PROMPT_MS} of quiet after the last
 * chunk, so a prompt written in several pieces is finished before the command
 * is typed into it. {@link LAUNCH_FALLBACK_MS} is the deadline for a shell
 * that reports nothing or never falls quiet. Ctrl-U leads so a stray
 * half-typed prefix cannot join the command. The caller schedules this only
 * for a fresh shell (empty replay), so a reattach never types a second
 * launch.
 * @param terminal - the freshly opened shell.
 * @param command - the resolved non-empty launch command.
 */
export function scheduleLaunch(terminal: DesktopTerminalLike, command: string, platform: NodeJS.Platform = process.platform): void {
  let settle: ReturnType<typeof setTimeout> | undefined
  let detach: (() => void) | undefined
  const stop = (): void => {
    clearTimeout(fallback)
    if (settle !== undefined) clearTimeout(settle)
    detach?.()
    detach = undefined
  }
  const fire = (): void => {
    stop()
    // Clearing the line: Ctrl-U in a POSIX shell's readline. Windows
    // PowerShell's line editor leaves Ctrl-U unbound and cmd.exe prints it, and
    // both clear the line on Escape.
    if (terminal.exit === undefined) terminal.write(`${platform === 'win32' ? '\u001b' : '\u0015'}${command}\r`)
  }
  const fallback = setTimeout(fire, LAUNCH_FALLBACK_MS)
  detach = terminal.subscribe((event) => {
    if (event.kind === 'exit') {
      stop()
      return
    }
    // Restarted on every chunk, not armed once on the first: a prompt whose
    // pieces arrive more than the settle apart used to take the command into
    // a half-drawn prompt.
    if (settle !== undefined) clearTimeout(settle)
    settle = setTimeout(fire, LAUNCH_AFTER_PROMPT_MS)
  })
}

/**
 * Register the terminal routes under the web server.
 * @param ctx - Host context.
 * @param config - launch-command configuration.
 */
export function apply(ctx: Context, config?: Config): void {
  let current: () => Config = () => config ?? {}
  installSettingsSection(ctx, NS, Config, config ?? {}, {
    setSource: (source: () => Config) => {
      current = source
    },
    onChange: () => {},
  })
  /** The configured commands, as the read route serves them and {@link launchCommandFor} resolves them. */
  const launches = (): TerminalLaunches => ({
    default: current().launchCommand ?? '',
    byActivity: current().launchByActivity ?? {},
  })
  /**
   * The CLI catalogue with each command's executable probed through the login
   * shell (a plain shell is always there). Cached for a minute: the pane
   * re-reads the route after every save.
   */
  let cliProbe: { at: number; value: TerminalCliOption[] } | undefined
  const catalog = async (): Promise<TerminalCliOption[]> => {
    if (cliProbe !== undefined && Date.now() - cliProbe.at < 60_000) return cliProbe.value
    const value = await Promise.all((current().clis ?? []).map(async entry => ({
      ...entry,
      installed: entry.command === '' ? true : await cliInstalled(entry.command.split(' ')[0] ?? ''),
    })))
    cliProbe = { at: Date.now(), value }
    return value
  }
  /** The launch command for one activity: the per-activity override, else the default; trimmed, '' = none. */
  const launchFor = (activity: string | undefined): string => launchCommandFor(activity, launches())
  /** Shells already given their launch, so a racing reopen cannot type twice. */
  const autoLaunched = new Set<string>()
  /**
   * The command as the shell types it: a Claude Code launch gains the hooks
   * that report its turns, and a Claude Code, Pi or Codex launch gains the standing
   * rules the composed services hold for a terminal agent. Anything else, a
   * deployment with no rules to give, or a failed write types the command as
   * configured, because guidance must never cost the user their launch.
   */
  const typedLaunch = async (terminal: DesktopTerminalLike, command: string, cwd: string): Promise<string> => {
    if (current().appendKnowledge === false) return command
    const hooked = await withHooks(command)
    if (promptChannel(command) === undefined) return hooked
    try {
      const probe = (name: string): unknown => (ctx as unknown as { get(name: string): unknown }).get(name)
      const text = await gatherKnowledge(probe, cwd, (message) => { ctx.logger.warn(message) })
      if (text === undefined) return hooked
      const file = await writeKnowledgeFile(join(resolveDshHome(), 'idealize', 'terminal-knowledge'), terminal.id, text)
      const off = terminal.subscribe((event) => {
        if (event.kind !== 'exit') return
        off()
        rm(file, { force: true }).catch(() => {})
      })
      return withKnowledge(hooked, file) ?? hooked
    } catch (error) {
      ctx.logger.warn(`idealize-ui-terminal: the launch goes without its standing rules: ${String(error)}`)
      return hooked
    }
  }
  /** A Claude Code launch with its turn hooks; any other command, or a failed write, as given. */
  const withHooks = async (command: string): Promise<string> => {
    if (!takesTurnHooks(command)) return command
    try {
      return withTurnHooks(command, await writeTurnHooks(join(resolveDshHome(), 'idealize', 'terminal-turns')))
    } catch (error) {
      ctx.logger.warn(`idealize-ui-terminal: the launch goes without its turn hooks: ${String(error)}`)
      return command
    }
  }
  /**
   * The command with the chat's conversation named on it, so its agent
   * reopens what it had before the app restarted (`conversation.ts`). A
   * failed look for the conversation types the command as configured: a fresh
   * conversation beats a launch that refuses to start.
   */
  const conversationLaunch = async (command: string, chat: string): Promise<string> => {
    try {
      return await withConversation(command, chat)
    } catch (error) {
      ctx.logger.warn(`idealize-ui-terminal: the launch starts a fresh conversation: ${String(error)}`)
      return command
    }
  }

  // What a terminal agent is doing, from the only signal a shell gives. A
  // harness agent reports itself through `agent/status`; the CLIs a Terminal
  // chat runs are other people's programs and report nothing, so before this
  // a terminal agent raised no working state and no finished notification,
  // and posted nothing to the project's group chat when it stopped (JJ,
  // 10 Sep 2026).
  const chats = new Map<string, { session: string; cwd: string }>()
  // What the nudger reads: each shell, the program its launch ran, and the
  // line the person has typed into it and not sent.
  const opened = new Map<string, DesktopTerminalLike>()
  const programs = new Map<string, string>()
  const drafts = new Map<string, PromptLines>()
  const nudges = new TerminalNudges({
    busy: id => activity.busy(id),
    draft: id => drafts.get(id)?.draft ?? '',
    program: id => programs.get(id),
  })
  // What each terminal's agent says about its own turns, where it says
  // anything (a Claude Code launch's hooks, see `turns.ts`).
  const turns = new TerminalTurns()
  /**
   * A terminal agent finished: the done chime, and the line the harness
   * agents post for themselves in the group chat. A terminal agent cannot be
   * told to post, so the host says it on the agent's behalf.
   * @param id - the terminal.
   * @param ranForMs - how long the run took, or null when nobody heard it start.
   */
  const finished = (id: string, ranForMs: number | null): void => {
    const chat = chats.get(id)
    /* v8 ignore next -- a run or a report only reaches here for a terminal the open route recorded. */
    if (chat === undefined) return
    ;(ctx.get('idealizeBridge') as BridgeLike | undefined)?.buffer.push({
      kind: 'agent-finished',
      title: 'Agent finished',
      body: '',
      sessionId: chat.session,
    })
    const studio = ctx.get('idealizeStudio') as StudioLike | undefined
    if (studio === undefined || chat.cwd === '' || chat.cwd === '/') return
    studio.record({
      project: chat.cwd,
      author: chat.session,
      kind: 'message',
      body: ranForMs === null ? 'Finished a run in the terminal.' : `Finished a run in the terminal (${describeRun(ranForMs)}).`,
    }).catch((error: unknown) => {
      ctx.logger.warn(`idealize-ui-terminal: the group-chat post failed: ${String(error)}`)
    })
  }
  const deliveries = new TerminalDeliveries()
  /** The chat a terminal belongs to, for the left panel's working and finished marks. */
  const sessionOf = (id: string): { sessionId?: string } => {
    const session = chats.get(id)?.session
    return session === undefined ? {} : { sessionId: session }
  }
  const openedListeners = new Set<(sessionId: string) => void>()
  const activity = new TerminalActivity({
    onQuiet: (id) => { nudges.quiet(id) },
    onWorking: (id) => {
      deliveries.working(id)
      ctx.emit('idealize/terminal-activity', { id, ...sessionOf(id), working: true })
    },
    onDone: (id, ranForMs, cut) => {
      ctx.emit('idealize/terminal-activity', { id, ...sessionOf(id), working: false })
      // A run this host interrupted is not the agent finishing a piece of
      // work, so it neither chimes nor answers a delivered line.
      if (cut) return
      // An agent that reports its own turns chimes on its stop, and answers a
      // delivered line there too; quiet here is only a pause, often the person
      // typing or a long tool run.
      if (turns.reporting(id)) return
      deliveries.done(id)
      finished(id, ranForMs)
    },
  })
  ctx.effect(() => () => { activity.stop() }, 'idealize-ui-terminal: activity watcher')
  /** A chat's live terminal here, if it has one open. */
  const terminalOf = (sessionId: string): DesktopTerminalLike | undefined => {
    const id = [...chats.entries()].find(([, chat]) => chat.session === sessionId)?.[0]
    const terminal = id === undefined ? undefined : opened.get(id)
    return terminal === undefined || terminal.exit !== undefined ? undefined : terminal
  }
  /**
   * Press Escape on an agent that is in the middle of a run: one its own
   * hooks report as a turn, or one the watcher has announced. `printing`
   * also counts a run too young to announce, for a caller that knows the
   * agent was working. The interrupted run then ends without a chime.
   * @returns whether the agent was working and was interrupted.
   */
  const interruptRun = (terminal: DesktopTerminalLike, printing: boolean): boolean => {
    const working = turns.inTurn(terminal.id)
      || activity.working().includes(terminal.id)
      || (printing && activity.busy(terminal.id))
    if (!working) return false
    terminal.write('\u001b')
    activity.interrupted(terminal.id)
    turns.interrupted(terminal.id)
    return true
  }
  ctx.effect(() => ctx.provide('idealizeTerminals', {
    working: () => activity.working().flatMap((id) => {
      const chat = chats.get(id)
      return chat === undefined ? [] : [chat.session]
    }),
    nudge: (sessionId: string, text: string, wanted?: () => boolean) => {
      const terminal = terminalOf(sessionId)
      if (terminal === undefined) return false
      nudges.nudge(terminal, text, wanted)
      return true
    },
    turn: (sessionId: string, turn: TerminalTurn) => {
      const terminal = terminalOf(sessionId)
      if (terminal === undefined) return false
      const ranForMs = turns.report(terminal.id, turn, Date.now())
      // The agent's own report is exact: a delivered line's answer starts and
      // ends with its turn.
      if (turn === 'start') deliveries.working(terminal.id)
      if (turn === 'stop') deliveries.done(terminal.id)
      if (turn === 'stop' && ranForMs !== undefined) finished(terminal.id, ranForMs)
      return true
    },
    deliver: (sessionId: string, text: string, wanted?: () => boolean, options: { interruptWith?: string } = {}) => {
      const terminal = terminalOf(sessionId)
      if (terminal === undefined) return undefined
      const handle = deliveries.begin(terminal.id)
      const stopped = options.interruptWith !== undefined && interruptRun(terminal, false)
      nudges.nudge(terminal, stopped ? options.interruptWith ?? text : text, wanted, { typed: handle.typed, dropped: handle.dropped }, {
        clearFirst: stopped,
        holdUntilQuiet: stopped,
      })
      // The interrupt's redraw ends in a quiet spell, which types the line.
      // One that prints nothing after the key still gets its line once the
      // watcher's quiet has passed.
      if (stopped) setTimeout(() => { nudges.quiet(terminal.id) }, QUIET_MS + 250).unref()
      return handle.outcome
    },
    interrupt: (sessionId: string) => {
      const terminal = terminalOf(sessionId)
      if (terminal === undefined) return false
      nudges.closed(terminal.id)
      deliveries.dropped(terminal.id)
      interruptRun(terminal, true)
      return true
    },
    onOpened: (listener: (sessionId: string) => void) => {
      openedListeners.add(listener)
      return () => { openedListeners.delete(listener) }
    },
  }), 'idealize-ui-terminal: idealizeTerminals')
  // The Brains pane's launch choice: a per-brain override, or the default when
  // no activity is named. Registered only where a settings provider exists,
  // because the choice is a persisted setting, not a per-process value.
  ctx.inject(['webServer', 'settings'], (sctx) => {
    sctx.effect(() => sctx.webServer.register({
      kind: 'exact',
      path: '/idealize/terminal/launch',
      handler: async (req, res) => {
        if (refuse(req, res, true)) return
        try {
          const body = JSON.parse(await readBody(req)) as { activity?: unknown; command?: unknown }
          if (!acceptableCommand(body.command)) {
            sendJson(res, 400, { error: 'command must be one bounded line' })
            return
          }
          if (body.activity !== undefined && (typeof body.activity !== 'string' || body.activity === '')) {
            sendJson(res, 400, { error: 'activity must be a non-empty string when present' })
            return
          }
          const command = body.command.trim()
          if (body.activity === undefined) {
            await sctx.settings.update(NS, { launchCommand: command })
          } else {
            await sctx.settings.update(NS, {
              launchByActivity: { ...current().launchByActivity ?? {}, [body.activity]: command },
            })
          }
          sendJson(res, 200, { ...launches() })
        } catch (error) {
          if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'idealize-ui-terminal: /idealize/terminal/launch')
  })

  /** Shells already feeding the watcher, so a reattach subscribes once. */
  const watched = new Set<string>()

  /**
   * Feed one shell's output to the activity watcher. The subscription is the
   * shell's own, so it ends with the shell.
   * @param terminal - the open shell.
   */
  const watch = (terminal: DesktopTerminalLike): void => {
    if (watched.has(terminal.id)) return
    watched.add(terminal.id)
    opened.set(terminal.id, terminal)
    const off = terminal.subscribe((event) => {
      if (event.kind === 'exit') {
        activity.closed(terminal.id)
        turns.forget(terminal.id)
        nudges.closed(terminal.id)
        deliveries.closed(terminal.id)
        opened.delete(terminal.id)
        programs.delete(terminal.id)
        drafts.delete(terminal.id)
        chats.delete(terminal.id)
        watched.delete(terminal.id)
        off()
        return
      }
      activity.sawOutput(terminal.id)
    })
  }

  ctx.inject(['webServer', 'workspaceRegistry'], (webCtx) => {
    const terminals = (): DesktopTerminalsLike | undefined => {
      // ctx.get() is the sanctioned probe for a service this plugin does not
      // inject: plain property access on an undeclared service throws.
      const maybe = (webCtx as unknown as { get(name: string): unknown }).get(DESKTOP_TERMINALS_SERVICE)
      return typeof (maybe as DesktopTerminalsLike | undefined)?.open === 'function'
        ? maybe as DesktopTerminalsLike
        : undefined
    }

    type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
    const register = (path: string, mutating: boolean, handler: RouteHandler): void => {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            if (refuse(req, res, mutating)) return
            try {
              await handler(req, res)
            } catch (error) {
              if (!res.headersSent) {
                sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
              }
            }
          },
        }),
        `idealize-ui-terminal: ${path}`,
      )
    }

    /** The terminal a mutating request names, or a 404/409 already sent. */
    const named = (res: ServerResponse, body: { id?: unknown }): DesktopTerminalLike | undefined => {
      const service = terminals()
      if (service === undefined) {
        sendJson(res, 409, { error: 'desktop shell not present' })
        return undefined
      }
      const terminal = typeof body.id === 'string' ? service.get(body.id) : undefined
      if (terminal === undefined) {
        sendJson(res, 404, { error: 'no such terminal' })
        return undefined
      }
      return terminal
    }

    register('/idealize/terminal/capabilities', false, (_req, res) => {
      sendJson(res, 200, { embedded: terminals() !== undefined })
    })

    // The commands themselves, not a verdict: the client asks per brain, and
    // only the client knows which brain a given chat is running.
    register(LAUNCHES_PATH, false, async (_req, res) => {
      sendJson(res, 200, { ...launches(), catalog: await catalog() })
    })

    register('/idealize/terminal/open', true, async (req, res) => {
      const service = terminals()
      if (service === undefined) {
        sendJson(res, 409, { error: 'desktop shell not present' })
        return
      }
      const body = JSON.parse(await readBody(req)) as {
        key?: unknown
        cwd?: unknown
        cols?: unknown
        rows?: unknown
        activity?: unknown
        plain?: unknown
      }
      const plain = body.plain === true
      const roots = webCtx.workspaceRegistry.list().map(workspace => workspace.path)
      const cwd = typeof body.cwd === 'string' && body.cwd !== ''
        ? await fencedDirectory(body.cwd, roots)
        : homedir()
      if (cwd === undefined) {
        sendJson(res, 403, { error: 'directory outside home and workspace roots' })
        return
      }
      const cols = gridDimension(body.cols, MAX_COLS)
      const rows = gridDimension(body.rows, MAX_ROWS)
      // A chat's shell knows which chat it is and carries that chat's key, so
      // the `idealize` command run by its agent speaks as this chat and
      // nothing else (the host's launch gate). A plain shell names no chat.
      const chatKey = !plain && typeof body.key === 'string' && body.key !== '' ? currentSessionKey(body.key) : undefined
      const env = chatKey === undefined || typeof body.key !== 'string'
        ? undefined
        : { DSH_SESSION_ID: body.key, DSH_IDEALIZE_HOST: `http://127.0.0.1:${webCtx.webServer.port}`, DSH_IDEALIZE_KEY: chatKey }
      const terminal = service.open({
        ...(typeof body.key === 'string' && body.key !== '' ? { key: body.key } : {}),
        ...(env === undefined ? {} : { env }),
        cwd,
        ...(cols === undefined ? {} : { cols }),
        ...(rows === undefined ? {} : { rows }),
      })
      // A fresh shell (nothing replayed yet) gets the activity's launch
      // typed at its prompt; a reattach already carries a session and must
      // not have a second agent typed into it. A plain shell gets nothing.
      const command = plain
        ? ''
        : launchFor(typeof body.activity === 'string' && body.activity !== '' ? body.activity : undefined)
      const fresh = terminal.exit === undefined && terminal.replay() === '' && !autoLaunched.has(terminal.id)
      if (fresh && command !== '') {
        autoLaunched.add(terminal.id)
        const program = programOf(command)
        if (program !== undefined) programs.set(terminal.id, program)
        // A chat's agent reopens its own conversation; a key-less shell names no chat.
        const chat = typeof body.key === 'string' && body.key !== '' ? body.key : undefined
        const named = chat === undefined ? command : await conversationLaunch(command, chat)
        scheduleLaunch(terminal, await typedLaunch(terminal, named, cwd))
      }
      // The chat this shell belongs to, and the project it runs in, so a run
      // that ends can name them. The key is the chat's session id; a plain
      // shell's key names no chat, so nothing is recorded for it.
      if (!plain && typeof body.key === 'string' && body.key !== '') {
        chats.set(terminal.id, { session: body.key, cwd })
        watch(terminal)
        // A pause's resume waits on this to type into a chat that had no
        // shell when Resume was pressed (feedback 495cec0a).
        for (const listener of [...openedListeners]) {
          try {
            listener(body.key)
          } catch (error) {
            ctx.logger.warn(`idealize-ui-terminal: an open listener failed: ${String(error)}`)
          }
        }
      }
      sendJson(res, 200, {
        id: terminal.id, cols: terminal.cols, rows: terminal.rows, cwd,
        ...(fresh && command !== '' ? { launch: command } : {}),
        // The chat's own card says when its agent acts without asking (JJ, 9 Oct 2026).
        ...(skipsPrompts(command) ? { noPrompts: true } : {}),
      })
    })

    register('/idealize/terminal/stream', false, (req, res) => {
      const service = terminals()
      const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('id') ?? ''
      const terminal = service?.get(id)
      if (terminal === undefined) {
        sendJson(res, 404, { error: 'no such terminal' })
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const send = (event: EmbeddedTerminalEvent | { kind: 'replay'; data: string }): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      send({ kind: 'replay', data: terminal.replay() })
      if (terminal.exit !== undefined) {
        send({ kind: 'exit', exitCode: terminal.exit.exitCode })
        res.end()
        return
      }
      const detach = terminal.subscribe((event) => {
        send(event)
        if (event.kind === 'exit') res.end()
      })
      req.on('close', detach)
    })

    /**
     * A name for a terminal chat from the first prompt typed into it (JJ,
     * 7 Oct 2026). Terminal keystrokes never become `user/message` events,
     * so the automatic title never runs for a terminal chat; the browser half
     * sends the first real prompt here and renames the chat with the reply,
     * through the same rename the sidebar uses. Asks the default model,
     * under the same 2-4 word, 32-character rule as a chat's own title.
     */
    register('/idealize/terminal/title', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { text?: unknown }
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      // ctx.get() is the sanctioned probe for services this plugin does not inject.
      const probe = webCtx as unknown as { get(name: string): unknown }
      const llm = probe.get('llm')
      const defaults = probe.get('agentDefaultModel') as { currentSelection?: () => { provider: string; model: string } } | undefined
      if (text === '' || llm === undefined || typeof defaults?.currentSelection !== 'function') {
        sendJson(res, 422, { error: 'no prompt, or no model to name it with' })
        return
      }
      const { provider, model } = defaults.currentSelection()
      const signal = AbortSignal.timeout(TERMINAL_TITLE_CONFIG.timeoutMs)
      // The probed service, never webCtx itself: suggestSessionTitle reads
      // ctx.llm, and that read throws on a context that did not inject llm.
      // Every terminal chat stayed "Terminal" until this (JJ, 8 Oct 2026).
      const title = await suggestSessionTitle({ llm: llm as Context['llm'] }, TERMINAL_TITLE_CONFIG, text, { provider, model }, signal)
      sendJson(res, title === '' ? 422 : 200, title === '' ? { error: 'the model gave no title' } : { title })
    })

    register('/idealize/terminal/input', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { id?: unknown; data?: unknown }
      const terminal = named(res, body)
      if (terminal === undefined) return
      if (typeof body.data === 'string') {
        // Before the write, so the echo it brings back is known for the person's.
        activity.sawInput(terminal.id)
        terminal.write(body.data)
        // Read back as lines, so a nudge never lands on a line the person is still typing.
        let lines = drafts.get(terminal.id)
        if (lines === undefined) drafts.set(terminal.id, lines = new PromptLines())
        lines.push(body.data)
      }
      sendJson(res, 200, { ok: true })
    })

    register('/idealize/terminal/resize', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { id?: unknown; cols?: unknown; rows?: unknown }
      const terminal = named(res, body)
      if (terminal === undefined) return
      const cols = gridDimension(body.cols, MAX_COLS)
      const rows = gridDimension(body.rows, MAX_ROWS)
      if (cols === undefined || rows === undefined) {
        sendJson(res, 400, { error: 'cols and rows must be positive integers' })
        return
      }
      terminal.resize(cols, rows)
      sendJson(res, 200, { ok: true, cols, rows })
    })

    register('/idealize/terminal/close', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { id?: unknown }
      const terminal = named(res, body)
      if (terminal === undefined) return
      terminal.close()
      sendJson(res, 200, { ok: true })
    })
  })
}

/**
 * Typing a note's wake line into a Terminal chat's CLI. A note from another
 * chat used to wake the chat's own agent, which sits unused behind the
 * terminal (8 Oct 2026); the agent the person talks to is the program in the
 * shell, and the only way into it is the keyboard. JJ asked for the note to
 * reach it, so the host types one line and presses Enter, the way the person
 * would.
 *
 * Typing into somebody else's program is only safe at its prompt, so a nudge
 * waits while any of these hold, and is tried again when the terminal next
 * falls quiet:
 * - the shell has printed within the activity watcher's quiet window;
 * - the person has typed a line and not sent it (Enter would send theirs too);
 * - the program in front is not a command-line agent (a bare shell would run
 *   the line as a command, an editor would take it as text);
 * - the screen shows a choice (a permission prompt or a question), where
 *   Enter picks the highlighted answer.
 * One nudge is held per terminal; a later one replaces it.
 * @module @idealize/ui-terminal/nudge
 */

import type { DesktopTerminalLike } from './index.ts'

/** Programs that run a command-line agent: npm-installed CLIs show as `node`. */
export const AGENT_PROGRAMS: readonly string[] = ['claude', 'codex', 'pi', 'node']

/**
 * Claude Code's native install runs a binary named after its version, so the
 * pty names it `2.1.294` (read off a real pty, 8 Oct 2026).
 */
const VERSION_NAMED = /^\d+(?:\.\d+)+$/u

/**
 * Whether the program in front of a shell is a command-line agent.
 * @param front - the pty's name for it, a path or a bare name.
 * @param launched - the program this host's launch ran, when known.
 * @returns true for a known agent, the launched program, or a version-named binary.
 */
export function isAgentProgram(front: string, launched: string | undefined): boolean {
  const name = front.split(/[\\/]/u).at(-1) ?? ''
  return AGENT_PROGRAMS.includes(name) || name === launched || VERSION_NAMED.test(name)
}

/** How much of the replay is read for a choice on screen. */
const SCREEN_TAIL = 4_000

/** Gap between the line and its Enter, so a TUI reads them as typing and a submit. */
export const ENTER_AFTER_MS = 150

/**
 * Ctrl-U, 32 times: each press deletes to the start of the line, so the burst
 * empties a draft of up to 16 lines in Claude Code 2.1.314, Codex 0.162.1, Pi
 * 0.85.1 and Kimi 0.41.0, and does nothing in an empty box (each read off a
 * real pty with a three-line draft, 30 Oct 2026). Ctrl-C clears a draft in one
 * press, but Codex quits on a single Ctrl-C when its box is already empty.
 */
export const CLEAR_INPUT = '\u0015'.repeat(32)

/** Gap between clearing the input box and typing the line, so the CLI has redrawn an empty box first. */
export const TYPE_AFTER_CLEAR_MS = 100

/** Escape sequences and other control bytes, stripped before reading the screen. */
const CONTROL = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|O.|.)|[\u0000-\u0008\u000B-\u001F\u007F]/gsu

/**
 * Prompts where Enter picks an answer: a numbered menu with its cursor on an
 * option (Claude Code's `❯ 1. Yes`, Codex's `› 1. Yes`), or a yes/no question.
 */
const CHOICE = /(?:❯|›|▶|>)\s*\d+\.\s|\((?:y\/n|Y\/n|y\/N)\)|\[(?:y\/n|Y\/n|y\/N)\]|Do you want to /u

/**
 * Whether the bottom of a terminal's output shows a choice waiting for Enter.
 * @param replay - the terminal's recent output.
 * @returns true when a menu or yes/no question is on screen.
 */
export function showsChoice(replay: string): boolean {
  return CHOICE.test(replay.slice(-SCREEN_TAIL).replace(CONTROL, ''))
}

/**
 * The program a launch command runs, as the process table names it.
 * @param command - the launch command, e.g. `claude --dangerously-skip-permissions`.
 * @returns the program's base name, or undefined for an empty command.
 */
export function programOf(command: string): string | undefined {
  const first = command.trim().split(/\s+/u)[0]
  if (first === undefined || first === '') return undefined
  return first.split(/[\\/]/u).at(-1)
}

/** What the nudger reads about a terminal; the plugin answers from its watcher and input readers. */
export interface NudgeReads {
  /** The terminal printed within the quiet window. */
  busy(id: string): boolean
  /** The line the person has typed and not sent. */
  draft(id: string): string
  /** The program the terminal launched, when this host launched it. */
  program(id: string): string | undefined
}

/** Who hears what became of one line: typed into the terminal, or dropped untyped. */
export interface NudgeOutcome {
  /** The line and its Enter went into the terminal. */
  typed?: () => void
  /** The line will never be typed: it was replaced, no longer wanted, or its terminal went. */
  dropped?: () => void
}

/** How one line is typed. */
export interface NudgeOptions {
  /**
   * Empty the agent's input box first. For a line typed straight after an
   * interrupt: Claude Code puts the interrupted prompt back in the box, and a
   * line typed onto it sent the old task again (30 Oct 2026).
   */
  clearFirst?: boolean
  /**
   * Hold the line for the terminal's next quiet spell even if it looks ready
   * now: after an interrupt, the CLI is still redrawing its prompt.
   */
  holdUntilQuiet?: boolean
}

/** One held nudge. */
interface Held {
  terminal: DesktopTerminalLike
  text: string
  wanted: () => boolean
  outcome: NudgeOutcome
  options: NudgeOptions
}

/** Types wake lines into terminals when they are at their prompt. */
export class TerminalNudges {
  readonly #held = new Map<string, Held>()
  readonly #reads: NudgeReads

  /** @param reads - what the plugin knows about each terminal. */
  constructor(reads: NudgeReads) {
    this.#reads = reads
  }

  /**
   * Type a line into a terminal now if it is at its agent's prompt, or hold
   * it until the terminal next falls quiet.
   * @param terminal - the chat's shell.
   * @param text - the line to type; one line, no Enter.
   * @param wanted - asked again before a held line is typed; false drops it
   *   (the agent read its inbox in the meantime).
   * @param outcome - told when the line is typed or dropped.
   * @param options - how the line is typed.
   * @returns `typed` or `held`.
   */
  nudge(
    terminal: DesktopTerminalLike,
    text: string,
    wanted: () => boolean = () => true,
    outcome: NudgeOutcome = {},
    options: NudgeOptions = {},
  ): 'typed' | 'held' {
    const line = text.replace(/[\r\n]+/gu, ' ').trim()
    if (options.holdUntilQuiet !== true && this.#ready(terminal)) {
      this.#type(terminal, line, options)
      outcome.typed?.()
      return 'typed'
    }
    // One line is held per terminal: the one it replaces will never be typed.
    this.#held.get(terminal.id)?.outcome.dropped?.()
    this.#held.set(terminal.id, { terminal, text: line, wanted, outcome, options })
    return 'held'
  }

  /**
   * A terminal fell quiet: type its held line if it is now at its prompt.
   * @param id - the terminal's id.
   */
  quiet(id: string): void {
    const held = this.#held.get(id)
    if (held === undefined) return
    if (!held.wanted()) {
      this.#held.delete(id)
      held.outcome.dropped?.()
      return
    }
    if (!this.#ready(held.terminal)) return
    this.#held.delete(id)
    this.#type(held.terminal, held.text, held.options)
    held.outcome.typed?.()
  }

  /**
   * Drop a terminal's held line untyped: its terminal has gone, or the agent
   * was interrupted and the line no longer applies.
   * @param id - the terminal's id.
   */
  closed(id: string): void {
    const held = this.#held.get(id)
    this.#held.delete(id)
    held?.outcome.dropped?.()
  }

  /**
   * Whether a line typed now lands at the agent's prompt.
   * @param terminal - the shell.
   * @returns true when every condition in the module note holds.
   */
  #ready(terminal: DesktopTerminalLike): boolean {
    if (terminal.exit !== undefined) return false
    if (this.#reads.busy(terminal.id) || this.#reads.draft(terminal.id) !== '') return false
    // A desktop shell too old to name its foreground program gets no typing at all.
    const front = terminal.foreground?.()
    if (front === undefined || front === '') return false
    if (!isAgentProgram(front, this.#reads.program(terminal.id))) return false
    return !showsChoice(terminal.replay())
  }

  /**
   * Type the line, then Enter a moment later; with `clearFirst`, empty the
   * input box a moment before the line.
   * @param terminal - the shell.
   * @param line - the text.
   * @param options - how the line is typed.
   */
  #type(terminal: DesktopTerminalLike, line: string, options: NudgeOptions = {}): void {
    const later = (ms: number, write: () => void): void => {
      const timer = setTimeout(() => {
        if (terminal.exit === undefined) write()
      }, ms)
      timer.unref()
    }
    const typeLine = (): void => {
      terminal.write(line)
      later(ENTER_AFTER_MS, () => { terminal.write('\r') })
    }
    if (options.clearFirst !== true) {
      typeLine()
      return
    }
    terminal.write(CLEAR_INPUT)
    later(TYPE_AFTER_CLEAR_MS, typeLine)
  }
}

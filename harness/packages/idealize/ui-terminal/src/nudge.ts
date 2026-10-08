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

/** One held nudge. */
interface Held {
  terminal: DesktopTerminalLike
  text: string
  wanted: () => boolean
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
   * @returns `typed` or `held`.
   */
  nudge(terminal: DesktopTerminalLike, text: string, wanted: () => boolean = () => true): 'typed' | 'held' {
    const line = text.replace(/[\r\n]+/gu, ' ').trim()
    if (this.#ready(terminal)) {
      this.#type(terminal, line)
      return 'typed'
    }
    this.#held.set(terminal.id, { terminal, text: line, wanted })
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
      return
    }
    if (!this.#ready(held.terminal)) return
    this.#held.delete(id)
    this.#type(held.terminal, held.text)
  }

  /**
   * Forget a terminal that has gone.
   * @param id - the terminal's id.
   */
  closed(id: string): void {
    this.#held.delete(id)
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
   * Type the line, then Enter a moment later.
   * @param terminal - the shell.
   * @param line - the text.
   */
  #type(terminal: DesktopTerminalLike, line: string): void {
    terminal.write(line)
    const timer = setTimeout(() => {
      if (terminal.exit === undefined) terminal.write('\r')
    }, ENTER_AFTER_MS)
    timer.unref?.()
  }
}

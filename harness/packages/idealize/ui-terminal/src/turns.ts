/**
 * When a terminal agent's turn ends, as the agent itself reports it.
 *
 * The activity watcher can only guess a run's end from 1.5 s of quiet, so the
 * done chime sounded while the person typed a prompt or answered a question,
 * and in the middle of long tool runs: in the AMI chat from 26 to 30 Oct 2026,
 * 215 chimes against 49 turns, 43 of them at a turn's end (feedback 1047a635).
 *
 * Claude Code says when a turn ends through its hooks. A Claude Code launch
 * gets a settings file ({@link TURN_HOOKS}) whose hooks run `idealize turn
 * open|start|stop|close`; the host hears them through `idealize-comm`, chimes
 * on the stop, and keeps the watcher's guess quiet for that terminal until
 * the session closes. A Claude Code whose hooks never report (hooks switched
 * off, `idealize` off its path) leaves the watcher in charge, as before.
 *
 * POSIX shells only: the hook line is POSIX, and on Windows Claude Code runs
 * hooks through a shell this has not been proved against.
 * @module @idealize/ui-terminal/turns
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What a terminal agent's hooks report: its session opening, a turn starting and ending, the session closing. */
export type TerminalTurn = 'open' | 'start' | 'stop' | 'close'

/** The settings file's name under the harness home's `idealize/terminal-turns`. */
export const TURN_HOOKS_FILE = 'claude-turns.json'

/**
 * One Claude Code hook that reports a turn. Quiet and never failing: a hook's
 * output on these events reaches the model's context, and a failed hook shows
 * an error line in the person's terminal.
 * @param turn - what the event reports.
 * @returns the hook group for one event.
 */
function hook(turn: TerminalTurn): unknown[] {
  return [{ hooks: [{ type: 'command', command: `idealize turn ${turn} >/dev/null 2>&1 || true`, timeout: 10 }] }]
}

/** Claude Code settings carrying the four turn hooks; merged with the person's own hooks, never in place of them. */
export const TURN_HOOKS = {
  hooks: {
    SessionStart: hook('open'),
    UserPromptSubmit: hook('start'),
    Stop: hook('stop'),
    SessionEnd: hook('close'),
  },
} as const

/** A command that already loads its own settings; such a command is the user's and keeps them. */
const OWN_SETTINGS = /(^|\s)--settings(\s|=|$)/

/**
 * Whether a launch command runs Claude Code and can take the turn hooks.
 * @param command - the configured launch command.
 * @param platform - the host platform.
 * @returns true for a Claude Code launch on a POSIX shell that loads no settings of its own.
 */
export function takesTurnHooks(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') return false
  const executable = (command.trim().split(/\s+/)[0] ?? '').split('/').pop() ?? ''
  return executable === 'claude' && !OWN_SETTINGS.test(command)
}

/**
 * The command as typed, loading the turn hooks. The path is single-quoted, so
 * a space or a quote in the harness home cannot break the line.
 * @param command - the configured launch command.
 * @param file - absolute path of the settings file.
 * @returns the command with `--settings` appended.
 */
export function withTurnHooks(command: string, file: string): string {
  return `${command.trim()} --settings '${file.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * Write the settings file, whole and in one rename, on every launch: Claude
 * Code refuses to start when a `--settings` file is missing, so the file must
 * stand however long ago it was first written.
 * @param dir - the directory to write it in.
 * @returns the file's absolute path.
 */
export async function writeTurnHooks(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, TURN_HOOKS_FILE)
  const draft = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`
  await writeFile(draft, `${JSON.stringify(TURN_HOOKS, null, 2)}\n`, 'utf8')
  await rename(draft, file)
  return file
}

/**
 * What each terminal's agent has reported about its turns. A terminal is in
 * the table from its agent's first report until its session closes, and the
 * value is when its current turn started.
 */
export class TerminalTurns {
  readonly #started = new Map<string, number | undefined>()

  /**
   * Whether a terminal's agent reports its own turns, so the watcher's guess stays quiet.
   * @param id - the terminal's id.
   * @returns true from the agent's first report until its session closes.
   */
  reporting(id: string): boolean {
    return this.#started.has(id)
  }

  /**
   * Record one report.
   * @param id - the terminal's id.
   * @param turn - what the agent reported.
   * @param now - the report's time.
   * @returns on `stop`, how long the turn ran, or null when its start went unheard; undefined for every other report.
   */
  report(id: string, turn: TerminalTurn, now: number): number | null | undefined {
    switch (turn) {
      case 'open':
        this.#started.set(id, undefined)
        return undefined
      case 'start':
        this.#started.set(id, now)
        return undefined
      case 'stop': {
        const started = this.#started.get(id)
        this.#started.set(id, undefined)
        return started === undefined ? null : now - started
      }
      case 'close':
        this.#started.delete(id)
        return undefined
    }
  }

  /**
   * Forget a terminal that has gone.
   * @param id - the terminal's id.
   */
  forget(id: string): void {
    this.#started.delete(id)
  }

  /**
   * Whether a terminal's agent has reported a turn starting and not yet ending.
   * @param id - the terminal's id.
   * @returns true between a `start` and its `stop`.
   */
  inTurn(id: string): boolean {
    return this.#started.get(id) !== undefined
  }

  /**
   * The agent's turn was interrupted. Claude Code runs no Stop hook for a
   * turn the person interrupts (read off a real 2.1.314 pty, 30 Oct 2026), so
   * the turn is closed here, with no chime, and the next `start` opens a new one.
   * @param id - the terminal's id.
   */
  interrupted(id: string): void {
    if (this.#started.has(id)) this.#started.set(id, undefined)
  }
}

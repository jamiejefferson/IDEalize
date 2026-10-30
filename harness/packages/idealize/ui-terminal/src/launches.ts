/**
 * The launch commands a fresh embedded shell types at its first prompt, and
 * the pure read over them.
 *
 * Browser-safe (no imports): the host resolves the command it schedules from
 * these values and serves the same values over `GET /idealize/terminal/launches`,
 * so a surface deciding whether a brain switch restarts the terminal compares
 * the commands the shell will actually run instead of guessing from a brain id.
 * @module @idealize/ui-terminal/launches
 */

/** One command-line agent the terminal can launch, as the configured catalogue lists it. */
export interface TerminalCliOption {
  /** Stable option id (`claude-code`). */
  id: string
  /** The label a picker shows (`Claude Code`). */
  label: string
  /** The command a fresh shell types; `''` is a plain shell. */
  command: string
  /** Whether the login shell finds the command's executable; null where the probe cannot run, true for `''`. */
  installed: boolean | null
}

/** The default launch command and the per-activity overrides, as the read route serves them. */
export interface TerminalLaunches {
  /** The command a fresh shell gets when no activity override applies; `''` disables the auto-launch. */
  default: string
  /** Per-activity override, keyed by the activity preset id the open request names. */
  byActivity: Record<string, string>
  /** The configured CLI catalogue with install verdicts; served by the route, ignored by {@link launchCommandFor}. */
  catalog?: readonly TerminalCliOption[]
}

/** The route serving {@link TerminalLaunches}. */
export const LAUNCHES_PATH = '/idealize/terminal/launches'

/** What {@link launchBrainOf} reads of a chat's session-list entry. */
export interface LaunchBrainSource {
  /** The activity preset the chat was created on; the session header freezes it. */
  agentPreset?: string | undefined
  /** The chat's projection values; `brain.brain` is the latest brain its log records. */
  projectionValues?: { readonly brain?: { readonly brain?: string | undefined } | undefined } | undefined
}

/**
 * The brain whose launch command a chat's fresh shell types: the latest brain
 * the chat's log records, else the activity preset it was created on. The
 * header's preset alone is not enough, because it never moves: a chat created
 * on Design and switched to Coding reopened on Design's command after a
 * restart, once the in-memory note of the switch was gone (JJ, 30 Oct 2026:
 * "on restart the cli sometimes accidentally loads the wrong model").
 * @param source - the chat's session-list entry, or undefined before it loads.
 * @returns the brain's activity preset id, or undefined for the default command.
 */
export function launchBrainOf(source: LaunchBrainSource | undefined): string | undefined {
  const recorded = source?.projectionValues?.brain?.brain
  return recorded !== undefined && recorded !== '' ? recorded : source?.agentPreset
}

/**
 * The command one activity types into a fresh shell.
 * @param activity - the activity preset id the open request names, or undefined for the default.
 * @param launches - the configured commands.
 * @returns the trimmed command; `''` when this activity launches nothing.
 */
export function launchCommandFor(activity: string | undefined, launches: TerminalLaunches): string {
  const override = activity === undefined ? undefined : launches.byActivity[activity]
  return (override ?? launches.default).trim()
}

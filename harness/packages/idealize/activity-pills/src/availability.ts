/**
 * Activity-brain availability: whether selecting an activity brain is safe
 * right now, and why not.
 *
 * An activity brain targets a provider route. Three facts decide its state:
 * whether that route is usable from the chat (a credential or sign-in
 * exists), which surface the user is on (the chat, or the desktop shell's
 * terminal running a subscription agent such as Claude Code), and whether a
 * terminal exists at all. Browser-safe (no imports): the host computes
 * states, the brain switcher and the Brains pane read them, and all share
 * these definitions. The wire field and type names keep `pill`, the id the
 * `GET /idealize/activity/models` payload has always carried.
 * @module @idealize/activity-pills/availability
 */

/** One provider route + model id. */
export interface ActivityModel {
  /** The provider route id, as the models directory names it. */
  provider: string
  /** The model id on that route. */
  model: string
}

/** Where the user is working, as the shell reports it. */
export interface Surface {
  kind: 'chat' | 'terminal'
  /** The provider the terminal agent runs on, when the surface is the terminal. */
  provider?: string
}

/** Why a pill is not simply ready. */
export type PillReason =
  /** No model resolves for the pill (no free-tokens route, no default model). */
  | 'no-model'
  /** The route has no credential or sign-in reachable from the chat. */
  | 'no-access'
  /** The route is a subscription the person has not signed in to; signing in, not a key, clears it. */
  | 'no-sign-in'
  /** The route is subscription-only here: it runs in the desktop terminal, not the chat. */
  | 'terminal-only'
  /** The terminal's shell would restart and lose its context ({@link terminalRestarts}). */
  | 'terminal-restart'

/** What the terminal runs for one brain: the provider route, and the command a fresh shell types. */
export interface TerminalRun {
  /** The provider route the agent runs on. */
  provider: string
  /** The launch command a fresh shell types for this brain; `''` when it launches nothing. */
  launch: string
}

/**
 * Whether moving the terminal onto another brain restarts its shell, which
 * loses the scrollback and whatever the running agent held in context.
 *
 * Two independent triggers, either one sufficient: the brain runs on another
 * provider route, or the shell would type a different launch command. This is
 * the whole rule behind the `terminal-restart` reason. {@link assessPills}
 * applies its provider half, which is all the host's per-brain read can see —
 * that read answers for the roster as a whole and knows no chat's current brain.
 * The composer's brain menu applies both halves, because it is asking about one
 * named chat and reads the commands from `GET /idealize/terminal/launches`.
 * @param current - what the terminal is running now.
 * @param next - what the chosen brain would run.
 * @returns true when choosing `next` restarts the shell.
 */
export function terminalRestarts(current: TerminalRun, next: TerminalRun): boolean {
  return current.provider !== next.provider || current.launch !== next.launch
}

/** A pill's state: select freely, ask first, or refuse. */
export interface PillAvailability {
  model: ActivityModel | null
  state: 'ready' | 'confirm' | 'unavailable'
  reason?: PillReason
}

/** The facts {@link assessPills} reads. */
export interface AvailabilityFacts {
  /** Whether the chat can open a request on the route now. */
  reachable: (provider: string) => boolean
  /** Whether the route is offered through subscription sign-in, so an unreachable one waits on a sign-in rather than a key. */
  subscription: (provider: string) => boolean
  surface: Surface
  /** Whether the desktop shell offers a terminal (subscription agents run there). */
  terminalAvailable: boolean
  /** Routes that only a terminal agent serves on subscription (no chat credential path). */
  terminalOnlyProviders: readonly string[]
}

/**
 * Decide each pill's state from its model and the facts.
 * @param models - the model each pill selects, null when none resolves.
 * @param facts - reachability, surface, terminal presence.
 * @returns one availability per pill id.
 */
export function assessPills(
  models: Readonly<Record<string, ActivityModel | null>>,
  facts: AvailabilityFacts,
): Record<string, PillAvailability> {
  const assessed: Record<string, PillAvailability> = {}
  for (const [id, model] of Object.entries(models)) {
    assessed[id] = assessOne(model, facts)
  }
  return assessed
}

function assessOne(model: ActivityModel | null, facts: AvailabilityFacts): PillAvailability {
  if (model === null) return { model, state: 'unavailable', reason: 'no-model' }
  if (facts.surface.kind === 'terminal') {
    // The row read knows no chat, so it cannot know which launch command is
    // running: `''` on both sides leaves the provider half of the rule.
    const restarts = terminalRestarts(
      { provider: facts.surface.provider ?? '', launch: '' },
      { provider: model.provider, launch: '' },
    )
    return restarts ? { model, state: 'confirm', reason: 'terminal-restart' } : { model, state: 'ready' }
  }
  if (facts.reachable(model.provider)) return { model, state: 'ready' }
  if (facts.terminalOnlyProviders.includes(model.provider) && facts.terminalAvailable) {
    return { model, state: 'unavailable', reason: 'terminal-only' }
  }
  if (facts.subscription(model.provider)) return { model, state: 'unavailable', reason: 'no-sign-in' }
  return { model, state: 'unavailable', reason: 'no-access' }
}

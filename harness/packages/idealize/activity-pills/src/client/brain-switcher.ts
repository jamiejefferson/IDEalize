/**
 * The in-session brain switcher's controller: which brains this chat can run,
 * which one it is running, and what changing costs.
 *
 * THE SPACE OWNS THE TOOLS; THE BRAIN OWNS THE MODEL AND THE INSTRUCTIONS.
 * A started conversation's history was produced under its preset's tools, so
 * the host fixes that preset for the life of the chat
 * (`agent-preset-locked`). Switching brains mid-chat therefore writes the
 * session's MODEL and records the brain and its standing instructions in the
 * log; it never recomposes the preset. A blank chat has no such history, so
 * there a switch recomposes exactly as the welcome card's brain step does.
 *
 * In the Terminal space a switch may also replace the running shell. That is
 * decided BEFORE the click, from the commands the deployment is configured
 * with, so the menu can say which brains cost something rather than surprising
 * the user with a dialog after the fact.
 * @module @idealize/activity-pills/client/brain-switcher
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the space vocabulary and the roster payload the menu reads.
// `@idealize/spaces/client` exports types alone, so nothing of that package
// reaches this bundle.
import type { SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import { terminalRestarts, type ActivityModel } from '../availability.ts'
import type { PillSessionSummary } from './pills-store.ts'

/** What the controller needs to know about the chat the switcher is rendered for. */
export interface BrainSessionSummary extends PillSessionSummary {
  /** The chat's space, from the `space` projection. */
  space: SpaceId
  /** The brain recorded in the log, when the chat has one; falls back to the chat's preset. */
  brain?: string
}

/**
 * One editable agent, as `GET /idealize/activity/agents` reports it. Restated
 * rather than imported: the host half of this package owns the route, and this
 * is the browser's read of its wire body.
 */
export interface BrainAgent {
  id: string
  name: string
  /** The model the agent runs, already resolved against the deployment default; null when none resolves. */
  model: ActivityModel | null
  /** The agent's standing instructions (its composition's persona text); `''` when it carries none. */
  instructions: string
}

/**
 * The launch commands, as `GET /idealize/terminal/launches` serves them.
 * Restated (`@idealize/ui-terminal` owns the route and the schema) so this
 * package stays free of a dependency on the terminal plugin, which ships only
 * in the desktop app.
 */
export interface TerminalLaunchTable {
  default: string
  byActivity: Record<string, string>
}

/** One row of the brain menu. */
export interface BrainOption {
  /** The agent preset id the switch selects. */
  id: string
  /** Display name from the preset's metadata. */
  name: string
  /** The model this brain runs; null when none resolves for it. */
  model: ActivityModel | null
  /** The brain's standing instructions; `''` when it carries none. */
  instructions: string
  /** Set on the brain the space starts with unless the user picks another. */
  isDefault: boolean
  /**
   * Whether choosing this brain restarts the terminal's shell. Always false
   * outside the Terminal space, where no shell is running to lose.
   */
  restarts: boolean
}

/** Brain-menu snapshot. */
export interface BrainSwitcherState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The chat's space, null until the first load answers. */
  space: SpaceId | null
  /** The brains that work in this chat's space, in roster order. */
  brains: readonly BrainOption[]
  /** The brain this chat is running; `''` while nothing resolves. */
  currentId: string
  /** The brain whose switch is in flight, null when idle. */
  busy: string | null
  /** A refused switch's message, cleared by the next attempt. */
  error: string | null
}

const INITIAL: BrainSwitcherState = {
  status: 'idle', space: null, brains: [], currentId: '', busy: null, error: null,
}

/** The reads the controller makes; each one is a loopback route. */
export interface BrainSwitcherReads {
  /** `GET /idealize/spaces`: which brains work in which space, and the default of each. */
  roster: () => Promise<readonly SpaceRosterEntry[]>
  /** `GET /idealize/activity/agents`: each brain's resolved model and standing instructions. */
  agents: () => Promise<readonly BrainAgent[]>
  /** `GET /idealize/terminal/launches`: the commands a fresh shell types, per brain. */
  launches: () => Promise<TerminalLaunchTable>
}

/** The writes one switch makes; each is refused loudly rather than swallowed. */
export interface BrainSwitcherWrites {
  /**
   * Recompose a BLANK chat on the brain, the way the welcome card's brain step
   * does. Never called for a started chat: the host refuses that swap.
   * @param brainId - the agent preset id.
   * @param session - the blank chat.
   * @returns null on success, the refusal message otherwise.
   */
  recompose: (brainId: string, session: PillSessionSummary) => Promise<string | null>
  /**
   * Move a STARTED chat onto the brain's model, which is the half of a brain a
   * started chat can take.
   * @param sessionId - the chat.
   * @param model - the brain's resolved model.
   * @returns null on success, the refusal message otherwise.
   */
  selectModel: (sessionId: string, model: ActivityModel) => Promise<string | null>
  /**
   * `POST /idealize/spaces/select`: record the brain and its standing
   * instructions in the chat's log. Anything reaching a model must be
   * reconstructable from the log, which is why the instructions travel with the
   * brain id rather than only being stored against the preset.
   * @param input - the chat, its unchanged space, the brain, and its instructions.
   * @returns once the append settled.
   */
  record: (input: {
    sessionId: string
    space: SpaceId
    brain: string
    instructions?: string
  }) => Promise<void>
  /**
   * Restart the chat's shell on the new brain (`terminalMode.restart`). Absent
   * wherever the terminal plugin is not composed, which is every plain browser.
   * @param sessionId - the chat whose shell restarts.
   * @param brainId - the brain the fresh shell launches.
   * @returns once the reopen has been asked for.
   */
  restartTerminal?: (sessionId: string, brainId: string) => Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The launch command one brain types into a fresh shell. Restates
 * `@idealize/ui-terminal`'s own resolution over the table that route serves;
 * importing it would inline a second copy of that package into this bundle.
 * @param brainId - the agent preset id.
 * @param launches - the table the launches route served.
 * @returns the trimmed command; `''` when this brain launches nothing.
 */
export function launchOf(brainId: string, launches: TerminalLaunchTable): string {
  return (launches.byActivity[brainId] ?? launches.default).trim()
}

/**
 * The brain a chat is running, named as one of the brains its space offers.
 *
 * A chat's recorded brain and its preset can both name a brain the chat's
 * space does not offer. A blank chat carrying an earlier launch's record is
 * relaunched into another space, and for a beat the log names the old brain
 * while the summary names the old preset; a chat launched into Gallery reads
 * the other way round, its space already Gallery while its preset is still the
 * one the blank chat was created on. Neither names what the chat runs, so the
 * space's own default answers instead — the brain a launch into that space
 * puts the chat on. The result is always a brain of the space, which is what
 * lets the composer name it rather than print an id.
 * @param entry - the chat's space, as the roster reports it.
 * @param session - the chat the switcher is rendered for.
 * @returns the brain's agent preset id; `''` when the space offers no brains.
 */
export function resolveCurrentBrain(entry: SpaceRosterEntry, session: BrainSessionSummary): string {
  const offers = (id: string): boolean => entry.brains.some(brain => brain.id === id)
  if (session.brain !== undefined && offers(session.brain)) return session.brain
  if (session.agentPreset !== undefined && offers(session.agentPreset)) return session.agentPreset
  return (entry.brains.find(brain => brain.default === true) ?? entry.brains[0])?.id ?? ''
}

/**
 * Compose the menu's rows from the three reads.
 * @param entry - the chat's space, as the roster reports it.
 * @param agents - every editable agent, keyed by the resolved model and instructions.
 * @param currentId - the brain the chat is running.
 * @param launches - the launch table, or undefined outside the Terminal space.
 * @returns one row per brain of the space, in roster order.
 */
export function composeBrains(
  entry: SpaceRosterEntry,
  agents: readonly BrainAgent[],
  currentId: string,
  launches: TerminalLaunchTable | undefined,
): BrainOption[] {
  const byId = new Map(agents.map(agent => [agent.id, agent]))
  const terminal = launches === undefined
    ? undefined
    : {
      launches,
      current: { provider: byId.get(currentId)?.model?.provider ?? '', launch: launchOf(currentId, launches) },
    }
  return entry.brains.map((brain) => {
    const agent = byId.get(brain.id)
    const model = agent?.model ?? brain.model ?? null
    return {
      id: brain.id,
      name: brain.name,
      model,
      instructions: agent?.instructions ?? '',
      isDefault: brain.default === true,
      restarts: terminal !== undefined && brain.id !== currentId && terminalRestarts(
        terminal.current,
        { provider: model?.provider ?? '', launch: launchOf(brain.id, terminal.launches) },
      ),
    }
  })
}

/** Reads the brains of one chat's space, and applies a switch to that chat. */
export class BrainSwitcherController {
  /** Menu snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<BrainSwitcherState> = createSnapshotStore(INITIAL)

  /**
   * Read token: the newest {@link load} wins. A launch changes the chat's
   * space, preset and recorded brain over three separate frames, each firing
   * another read, and an earlier read that lands last would leave the composer
   * naming the brain the chat has just left.
   */
  private loadSeq = 0

  constructor(
    private readonly reads: BrainSwitcherReads,
    private readonly writes: BrainSwitcherWrites,
  ) {}

  private set(patch: Partial<BrainSwitcherState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the brains of this chat's space and what switching to each costs.
   *
   * Reads are not coalesced: every call fetches, and only the newest writes
   * the snapshot. The launch that changes the chat's space and brain issues
   * several reads in quick succession, and the last one asked is the one whose
   * answer describes the chat.
   * @param session - the chat the switcher is rendered for.
   * @returns once the snapshot reflects the host, or once a newer read has
   * superseded this one.
   */
  async load(session: BrainSessionSummary): Promise<void> {
    const seq = ++this.loadSeq
    // What the chat names before the roster can place it in its space: shown
    // only where the space offers no brains, and the menu renders nothing.
    const named = session.brain ?? session.agentPreset ?? ''
    this.set({ status: 'loading' })
    try {
      const [roster, agents] = await Promise.all([this.reads.roster(), this.reads.agents()])
      const entry = roster.find(space => space.id === session.space)
      if (entry === undefined) {
        if (seq !== this.loadSeq) return
        this.set({ status: 'ready', space: session.space, brains: [], currentId: named, error: null })
        return
      }
      // Only the Terminal space runs a shell, so only there is a launch
      // command something a switch can change.
      const launches = session.space === 'terminal' ? await this.reads.launches() : undefined
      if (seq !== this.loadSeq) return
      const currentId = resolveCurrentBrain(entry, session)
      this.set({
        status: 'ready',
        space: session.space,
        brains: composeBrains(entry, agents, currentId, launches),
        currentId,
        error: null,
      })
    } catch (error) {
      if (seq !== this.loadSeq) return
      this.set({ status: 'error', space: session.space, currentId: named, error: messageOf(error) })
    }
  }

  /**
   * Make one brain current for this chat.
   *
   * A blank chat is recomposed on the brain. A started chat takes the brain's
   * model, and the brain and its instructions are recorded in the log; its
   * tools stay as they were, because its history was produced under them. In
   * the Terminal space a brain marked {@link BrainOption.restarts} also
   * replaces the running shell — the caller confirms that with the user first.
   * @param brainId - the chosen brain's agent preset id.
   * @param session - the chat the switcher is rendered for.
   * @returns once every write settled.
   */
  async select(brainId: string, session: BrainSessionSummary): Promise<void> {
    const state = this.store.getSnapshot()
    if (state.busy !== null) return
    const brain = state.brains.find(option => option.id === brainId)
    if (brain === undefined) return
    this.set({ busy: brainId, error: null })
    try {
      const refusal = session.blank
        ? await this.writes.recompose(brainId, session)
        : brain.model === null ? null : await this.writes.selectModel(session.id, brain.model)
      if (refusal !== null) {
        this.set({ busy: null, error: refusal })
        return
      }
      await this.writes.record({
        sessionId: session.id,
        space: session.space,
        brain: brainId,
        ...brain.instructions === '' ? {} : { instructions: brain.instructions },
      })
      if (brain.restarts) await this.writes.restartTerminal?.(session.id, brainId)
      this.set({ busy: null, currentId: brainId })
      await this.load({ ...session, brain: brainId })
    } catch (error) {
      this.set({ busy: null, error: messageOf(error) })
    }
  }
}

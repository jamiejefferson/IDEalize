/**
 * Activity-brain controller: which activity brain the current chat runs and
 * which one new chats get. The welcome card (through the `activityPills`
 * service) and the composer's brain switcher both select activity brains
 * through one instance of it.
 *
 * An activity brain is one of five named presets. Selecting it does two
 * things: when the current session is still blank the host recomposes that
 * session on the preset (a started conversation keeps the preset it began
 * with, as the host refuses the swap); on a started session the selection
 * changes the session's MODEL instead, to the one the host maps to that
 * activity (`activityModel`); and the preset becomes the roster default, so
 * every new chat opens on it. Free additionally moves the model policy to the
 * free-tokens auto route through the injected `freeRoute` hook.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ACTIVITY_IDS, FREE_ACTIVITY_ID } from '../activities.ts'
import type { PillAvailability } from '../availability.ts'

/** The wired face over one controller, as the `activityPills` service publishes it. */
export interface ActivityPillsFace {
  hooks: {
    /** Roster snapshot: the activity brains the host serves and the roster default. */
    activityPills: SnapshotStore<ActivityPillsState>
  }
  /** Read the roster. */
  load: () => Promise<void>
  /** Make one activity brain current for the given session (and for new chats). */
  select: (id: string, session?: PillSessionSummary) => Promise<void>
}

/** One activity brain the roster can serve. */
export interface ActivityPill {
  /** Preset id; also the locale key suffix and glyph key. */
  id: string
  /** Roster display name, shown when the locale carries no pill label. */
  name?: string
  /** Whether the pill may be selected now (ready until the host answers). */
  availability: PillAvailability
}

/** Roster snapshot. */
export interface ActivityPillsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The activity presets the roster serves, in roster order. */
  pills: readonly ActivityPill[]
  /** The roster default: what a session that names no preset gets. */
  defaultId: string
  /** The brain whose selection is in flight, null when idle. */
  busy: string | null
  /** A rejected select's message, cleared by the next attempt. */
  error: string | null
}

const INITIAL: ActivityPillsState = { status: 'idle', pills: [], defaultId: '', busy: null, error: null }

/** What the controller needs to know about the current session. */
export interface PillSessionSummary {
  id: string
  /** False once a turn has run; the host refuses the swap from then on. */
  blank: boolean
  /** The preset the session already runs, when the summary reports one. */
  agentPreset?: string
}

/** The wire faces the controller calls. */
export type PillsApi = Pick<IApiClient, 'agentPresets' | 'settings' | 'sessions'>

/** One provider route + model id, as the host's activity-model route reports it. */
export interface ActivityModelSelection {
  provider: string
  model: string
}

/** The host's activity-model answer: the model and state per activity brain. */
export type ActivityAvailabilityMap = Readonly<Record<string, PillAvailability>>

const READY: PillAvailability = { model: null, state: 'ready' }

/** The agent-preset settings namespace on the host wire (restated; dsh-agent-presets owns it). */
const AGENT_PRESET_SETTINGS_NS = 'agent-presets'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads the roster, recomposes the blank session, and writes the default. */
export class ActivityPillsController {
  /** Roster snapshot its consumers subscribe to. */
  readonly store: SnapshotStore<ActivityPillsState> = createSnapshotStore(INITIAL)

  constructor(
    private readonly api: PillsApi,
    /** The session a selection acts on, when there is one. */
    private readonly currentSession: () => PillSessionSummary | undefined,
    /** Publish an applied switch into the session list (optional). */
    private readonly onApplied?: (sessionId: string, agentPreset: string) => void,
    /** Move the model policy to the free-tokens auto route (optional). */
    private readonly freeRoute?: () => Promise<void>,
    /** The model and state per activity brain, from the host (optional). */
    private readonly availability?: () => Promise<ActivityAvailabilityMap>,
  ) {}

  private set(patch: Partial<ActivityPillsState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the roster and keep the five activity presets it serves.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    if (this.store.getSnapshot().status === 'loading') return
    this.set({ status: 'loading' })
    try {
      const response = await this.api.agentPresets.list({})
      if (!response.result.ok) {
        this.set({ status: 'error', error: response.result.error.message })
        return
      }
      const { presets } = response.result.value
      const byId = new Map(presets.filter(preset => preset.broken === undefined).map(preset => [preset.id, preset]))
      const states = await this.availability?.().catch(() => undefined)
      const pills: ActivityPill[] = []
      for (const id of ACTIVITY_IDS) {
        const preset = byId.get(id)
        if (preset === undefined) continue
        pills.push({
          id,
          ...preset.name === undefined ? {} : { name: preset.name },
          availability: states?.[id] ?? READY,
        })
      }
      this.set({
        status: 'ready',
        pills,
        defaultId: presets.find(preset => preset.isDefault)?.id ?? '',
        error: null,
      })
    } catch (error) {
      this.set({ status: 'error', error: messageOf(error) })
    }
  }

  /**
   * Make one activity agent current: recompose the blank current session on
   * it, give the session the brain's model, persist it as the default for
   * new chats, and route Free to the free-tokens policy.
   * @param id - the activity preset id.
   * @param session - the session the selection is for; falls back to the
   * list's current session when the caller has none.
   * @returns once every write settled.
   */
  async select(id: string, session: PillSessionSummary | undefined = this.currentSession()): Promise<void> {
    if (this.store.getSnapshot().busy !== null) return
    this.set({ busy: id, error: null })
    try {
      if (session !== undefined && session.blank && session.agentPreset !== id) {
        const response = await this.api.agentPresets.select({ sessionId: session.id as never, agentPreset: id })
        if (!response.result.ok) {
          this.set({ busy: null, error: response.result.error.message })
          return
        }
        this.onApplied?.(session.id, response.result.value.agentPreset)
      }
      // The preset carries no model: the brain's is the `models` entry the
      // host maps to it, and it reaches the chat only through this write. A
      // started chat keeps its preset and takes the model alone; a blank chat
      // takes both, else its first turn runs on the deployment default
      // whatever the brain row promised (the fresh-install walk of 14 Sep
      // 2026 failed its first turn that way, on a default route with no key).
      if (session !== undefined) {
        const selection = this.store.getSnapshot().pills.find(pill => pill.id === id)?.availability.model ?? null
        if (selection !== null) {
          const response = await this.api.sessions.selectModel({
            sessionId: session.id as never, provider: selection.provider, model: selection.model,
          })
          if (!response.result.ok) {
            this.set({ busy: null, error: response.result.error.message })
            return
          }
        }
      }
      if (this.store.getSnapshot().defaultId !== id) {
        const written = await this.api.settings.update({ ns: AGENT_PRESET_SETTINGS_NS, patch: { default: id } })
        if (!written.result.ok) {
          this.set({ busy: null, error: written.result.error.message })
          return
        }
        this.set({ defaultId: id })
      }
      if (id === FREE_ACTIVITY_ID) await this.freeRoute?.()
      this.set({ busy: null })
    } catch (error) {
      this.set({ busy: null, error: messageOf(error) })
    }
  }
}

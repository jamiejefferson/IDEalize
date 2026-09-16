/**
 * The wizard's route client: typed fetches over the host's onboarding,
 * models, activity, and media routes. Pure fetch wrappers — no cordis, no
 * React — so the step bodies and their specs share one wire mapping. Every
 * mutation carries the `x-idealize-auth` header the host fences demand.
 * @module @idealize/onboarding/client/api
 */

/** The agents-step state as `GET /idealize/onboarding/agents` reports it. */
export interface AgentsState {
  /** Claude Code CLI detection. */
  claudeCode: {
    /** Whether the `claude` executable resolves on this machine. */
    installed: boolean
    /** The resolved executable path, present when installed. */
    path?: string
  }
  /** OpenRouter credential presence. */
  openrouter: {
    /** Whether a stored OpenRouter key resolves. */
    connected: boolean
  }
}

/** One selectable LLM route: a provider and the model ids it currently lists. */
export interface LlmProviderOption {
  /** Provider route key. */
  provider: string
  /** Display name for the picker group. */
  displayName: string
  /** Selectable model ids. */
  models: string[]
  /** How the route is paid for (`/idealize/models/state`): the free engine, sign-in, or a stored key. */
  auth: 'free' | 'oauth' | 'apiKey'
  /** Whether the route can answer now: signed in, or a stored key that resolves. */
  connected: boolean
}

/** One LLM activity row's stored state (restated from `/idealize/activity/agents`). */
export interface ActivityRowState {
  /** The activity/preset id (`coding` | `design` | `admin`). */
  id: string
  /** Roster display name, round-tripped on save. */
  name: string
  /** The stored choice; the resolved default when none is stored. */
  model: { provider: string; model: string } | null
  /** True when `model` is a stored override rather than the resolved default. */
  overridden: boolean
  /**
   * The preset's current persona text. Saving a model choice rewrites the
   * preset composition through `/idealize/activity/agent`, whose absent
   * `instructions` would replace the persona with the generic template — so
   * the row round-trips what it read.
   */
  instructions: string
}

/** One media preset row's stored state (restated from `/idealize/brains/media`). */
export interface MediaRowState {
  /** The preset id (`images` | `sound` | `motion`). */
  id: string
  /** Roster display name. */
  name: string
  /** The stored choice, or null while none is stored. */
  model: { backend: string; model: string } | null
  /** Capability-filtered candidates. */
  candidates: {
    /** The generation backend id. */
    backend: string
    /** The selectable model. */
    model: {
      /** Provider-scoped model id. */
      id: string
      /** Display name. */
      name: string
    }
  }[]
  /** Whether this preset can run, including the host sentence used as a copy fallback. */
  availability:
    | { state: 'available' }
    | {
      state: 'unavailable'
      reason: 'no-backend' | 'no-compatible-model'
      recovery: string
      /** Whether a stored OpenRouter key would change the verdict; absent reads as false. */
      keyMissing?: boolean
    }
}

/** One `GET /idealize/terminal/launches` catalogue entry: a CLI a fresh Terminal shell can type (restated from `@idealize/ui-terminal`). */
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

/** The Terminal launch state the wizard's CLI row reads (restated from `GET /idealize/terminal/launches`). */
export interface TerminalLaunchState {
  /** The command a fresh shell gets when no brain override applies; `''` is a plain shell. */
  default: string
  /** The configured CLI catalogue with install verdicts. */
  catalog?: TerminalCliOption[]
}

/** Everything the tools step renders, assembled from its four GETs. */
export interface ToolsState {
  /** LLM routes with at least one selectable model that can answer now (connected, or the free engine). */
  providers: LlmProviderOption[]
  /** The LLM brain rows, in wizard order (design, coding, writing, admin, and free when no free route exists). */
  activities: ActivityRowState[]
  /** The generating-space rows, in wizard order (images, sound, motion). */
  media: MediaRowState[]
  /** Whether the free-tokens route is registered, so Free needs no model choice. */
  freeRoute: boolean
  /**
   * The Terminal's launch state, or null where the launches route is absent
   * (a plain browser, where no shell can open) so the wizard asks no CLI.
   */
  terminal: TerminalLaunchState | null
}

/** A mutation's outcome: ok, or the plain reason to show in place. */
export type SaveOutcome = { ok: true } | { ok: false; error: string }

/** The wizard's host calls. */
export interface OnboardingApi {
  /** Read the agents-step state. */
  loadAgents(): Promise<AgentsState>
  /**
   * Verify and store an OpenRouter key.
   * @param apiKey - the typed key.
   * @returns ok, or the host's plain refusal.
   */
  connectOpenRouter(apiKey: string): Promise<SaveOutcome>
  /** Assemble the tools-step state. */
  loadTools(): Promise<ToolsState>
  /**
   * Save one LLM activity row's model choice.
   * @param row - the row as loaded (name and instructions round-trip).
   * @param model - the chosen route.
   * @returns ok, or the host's plain refusal.
   */
  saveActivityModel(row: ActivityRowState, model: { provider: string; model: string }): Promise<SaveOutcome>
  /**
   * Save one media row's model choice.
   * @param id - the preset id.
   * @param model - the chosen backend/model pair.
   * @returns ok, or the host's plain refusal.
   */
  saveMediaModel(id: string, model: { backend: string; model: string }): Promise<SaveOutcome>
  /**
   * Store the CLI every Terminal brain without its own choice launches, through `POST /idealize/terminal/launch`.
   * @param command - the catalogue command a fresh shell types; `''` for a plain shell.
   * @returns ok, or the route's reason.
   */
  saveTerminalDefault(command: string): Promise<SaveOutcome>
  /**
   * Probe one folder path through the setup alias route — which also persists
   * the alias on success (the finish step's orientation write re-confirms it).
   * @param alias - which folder this path is for.
   * @param path - the absolute path to probe.
   * @returns ok, or the host's plain-language probe refusal.
   */
  probeFolder(alias: 'projectsRoot' | 'documentation' | 'skills', path: string): Promise<SaveOutcome>
  /**
   * Run the orientation: probe + persist both folders, create the first
   * project, seed and scan the documentation vault.
   * @param body - the two folders and the optional first-project name.
   * @returns ok (with the created project when one was requested), or the
   * per-field refusals verbatim.
   */
  orient(body: { projectsFolder: string; documentationFolder: string; projectName?: string }): Promise<OrientOutcome>
}

/** One refused orientation field, verbatim as the host reports it. */
export interface OrientFailure {
  /** Which request field failed. */
  field: 'projectsFolder' | 'documentationFolder' | 'projectName'
  /** The plain-language reason, shown to the user verbatim. */
  reason: string
}

/** The finish step's orientation outcome (restated from `/idealize/setup/orientation`). */
export type OrientOutcome =
  | { ok: true; project?: { workspaceId: string; path: string } }
  | { ok: false; failures?: OrientFailure[]; error?: string }

/** Mutation headers the host routes demand. */
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** The LLM brain rows the wizard shows, in wizard order: every Chat and Terminal brain the new-chat card lists. */
const TOOLS_ACTIVITY_IDS = ['design', 'coding', 'writing', 'admin'] as const
/** The Free brain's id: a row of its own only when no free-tokens route can carry it. */
const FREE_ACTIVITY_ID = 'free'
/** The generating-space rows the wizard shows, in wizard order (Gallery, Sound Stage, Motion). */
const TOOLS_MEDIA_IDS = ['images', 'sound', 'motion'] as const
/** The Terminal launch route; absent outside the desktop app, where the wizard asks no CLI. */
const TERMINAL_LAUNCHES_PATH = '/idealize/terminal/launches'

/** The error line a dropped wire earns; the host's own refusals arrive as JSON. */
const UNREACHABLE = 'The app could not reach its own onboarding route.'

/**
 * Create the wizard's route client.
 * @param fetchFn - the fetch implementation (specs inject a mock).
 * @returns the typed route face.
 */
export function createOnboardingApi(fetchFn: typeof fetch = fetch): OnboardingApi {
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetchFn(path)
    return response.json() as Promise<T>
  }
  const post = async (path: string, body: unknown): Promise<SaveOutcome> => {
    let response: Response
    try {
      response = await fetchFn(path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
    } catch {
      return { ok: false, error: UNREACHABLE }
    }
    const payload = await response.json() as { ok?: boolean; error?: string }
    if (response.ok && payload.ok !== false) return { ok: true }
    return { ok: false, error: payload.error ?? `The route answered HTTP ${String(response.status)}` }
  }
  return {
    loadAgents: () => get<AgentsState>('/idealize/onboarding/agents'),

    connectOpenRouter: apiKey => post('/idealize/onboarding/openrouter', { apiKey }),

    async loadTools() {
      // The launches route lives in the desktop app's terminal plugin; a
      // plain browser answers it with an error, which reads as "no Terminal".
      const terminal = async (): Promise<TerminalLaunchState | null> => {
        const response = await fetchFn(TERMINAL_LAUNCHES_PATH)
        if (!response.ok) return null
        const payload = await response.json() as TerminalLaunchState | undefined
        return payload === undefined || typeof payload.default !== 'string' ? null : payload
      }
      const [models, agents, media, launches] = await Promise.all([
        get<{ providers: LlmProviderOption[] }>('/idealize/models/state'),
        get<{ agents: ActivityRowState[] }>('/idealize/activity/agents'),
        get<{ presets: MediaRowState[] }>('/idealize/brains/media'),
        terminal(),
      ])
      // Only routes that can answer are offered: a first run on 14 Sep 2026
      // listed DeepSeek's catalogue beside the one keyed route, and every brain
      // the person chose from it opened on "No key for deepseek-official yet".
      const providers = models.providers.filter(provider => provider.models.length > 0 && (provider.connected || provider.auth === 'free'))
      const freeRoute = providers.some(provider => provider.auth === 'free')
      const rowIds: readonly string[] = freeRoute ? TOOLS_ACTIVITY_IDS : [...TOOLS_ACTIVITY_IDS, FREE_ACTIVITY_ID]
      return {
        providers,
        freeRoute,
        activities: rowIds.flatMap((id) => {
          const row = agents.agents.find(agent => agent.id === id)
          return row === undefined ? [] : [row]
        }),
        media: TOOLS_MEDIA_IDS.flatMap((id) => {
          const row = media.presets.find(preset => preset.id === id)
          return row === undefined ? [] : [row]
        }),
        terminal: launches,
      }
    },

    saveActivityModel: (row, model) => post('/idealize/activity/agent', {
      id: row.id,
      name: row.name,
      model,
      instructions: row.instructions,
    }),

    saveMediaModel: (id, model) => post('/idealize/brains/media', { id, model: { backend: model.backend, model: model.model } }),

    saveTerminalDefault: command => post('/idealize/terminal/launch', { command }),

    async probeFolder(alias, path) {
      let response: Response
      try {
        response = await fetchFn('/idealize/setup/alias', { method: 'POST', headers: HEADERS, body: JSON.stringify({ name: alias, path }) })
      } catch {
        return { ok: false, error: UNREACHABLE }
      }
      // The alias route's refusal carries the verbatim probe reason in `failure`.
      const payload = await response.json() as { ok?: boolean; failure?: { reason?: string }; error?: string }
      if (response.ok && payload.ok === true) return { ok: true }
      return { ok: false, error: payload.failure?.reason ?? payload.error ?? `The route answered HTTP ${String(response.status)}` }
    },

    async orient(body) {
      let response: Response
      try {
        response = await fetchFn('/idealize/setup/orientation', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
      } catch {
        return { ok: false, error: UNREACHABLE }
      }
      const payload = await response.json() as {
        ok?: boolean
        failures?: OrientFailure[]
        error?: string
        project?: { workspaceId: string; path: string }
      }
      if (response.ok && payload.ok === true) {
        return { ok: true, ...payload.project === undefined ? {} : { project: payload.project } }
      }
      return {
        ok: false,
        ...payload.failures === undefined ? {} : { failures: payload.failures },
        ...payload.error === undefined ? {} : { error: payload.error },
      }
    },
  }
}

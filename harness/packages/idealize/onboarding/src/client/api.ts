/**
 * The wizard's route client: typed fetches over the host's onboarding,
 * setup, terminal, services and models routes. Pure fetch wrappers — no cordis, no
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
  /** fal credential presence; absent from a host older than the three-part set-up. */
  fal?: {
    /** Whether a stored fal key resolves. */
    connected: boolean
  }
  /** The Terminal's default launch command; absent where the Terminal is not composed. */
  launchCommand?: string
}

/** One command-line app the Terminal can launch (restated from `GET /idealize/terminal/launches`). */
export interface LaunchChoice {
  /** Stable choice id (`claude-code`), which the align route takes as `cli`. */
  id: string
  /** The app's name (`Claude Code`). */
  label: string
  /** The command a fresh shell types; `''` is a plain shell. */
  command: string
  /** Whether the login shell finds the app; null where the check cannot run. */
  installed: boolean | null
}

/** The Terminal's launch choices and its default command. */
export interface Launches {
  /** The command a fresh shell types by default. */
  default: string
  /** The apps the Terminal offers, each with whether it is installed. */
  catalog: LaunchChoice[]
}

/** What the align route changed (restated from `POST /idealize/onboarding/align`). */
export interface AlignResult {
  /** The command now stored as the Terminal's default launch command. */
  launchCommand?: string
  /** The model now stored as the default chat model. */
  defaultModel?: { provider: string; model: string }
  /** Why a write did not happen. */
  note?: string
}

/** The align call's outcome: what changed, or the plain reason it failed. */
export type AlignOutcome = { ok: true; result: AlignResult } | { ok: false; error: string }

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
  /**
   * Read the Terminal's launch choices.
   * @returns the choices and the default command, or null where the host serves no Terminal.
   */
  loadLaunches(): Promise<Launches | null>
  /**
   * How many models a fal key adds, when the services route says.
   * @returns the count, or null when the route states none.
   */
  loadFalModelCount(): Promise<number | null>
  /**
   * Check and store a fal key.
   * @param apiKey - the typed key.
   * @returns ok, or the host's plain refusal.
   */
  connectFal(apiKey: string): Promise<SaveOutcome>
  /**
   * The name of the service Chat answers on today, when the default chat
   * model's service is connected and is not OpenRouter.
   * @returns the service's name, or null when no such default stands.
   */
  loadChatFallback(): Promise<string | null>
  /**
   * Make the chosen coding app the Terminal's default and start Chat on the
   * same company's models.
   * @param cli - the launch choice id.
   * @returns what changed, or the host's plain refusal.
   */
  align(cli: string): Promise<AlignOutcome>
  /** Whether a key gateway is connected; false when the host serves none. */
  loadGateway(): Promise<boolean>
  /**
   * Check a key gateway's address and key with the gateway, then store both.
   * @returns ok, or the gateway's own refusal.
   */
  connectGateway(address: string, key: string): Promise<SaveOutcome>
  /**
   * Probe one folder path through the setup alias route — which also persists
   * the alias on success (the finish step's orientation write re-confirms it).
   * @param alias - which folder this path is for.
   * @param path - the absolute path to probe.
   * @returns ok, or the host's plain-language probe refusal.
   */
  probeFolder(alias: 'projectsRoot' | 'documentation' | 'skills', path: string): Promise<SaveOutcome>
  /**
   * Whether the weekly documentation review is already on.
   * @returns true when the person accepted it and its calendar entry is switched on; false when the host cannot say.
   */
  loadWeeklyReview(): Promise<boolean>
  /**
   * Accept the weekly documentation review: the host saves its calendar entry
   * in the documentation folder.
   * @returns ok, or the host's plain refusal.
   */
  acceptWeeklyReview(): Promise<SaveOutcome>
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

    async loadLaunches() {
      const response = await fetchFn('/idealize/terminal/launches').catch(() => undefined)
      if (response === undefined || !response.ok) return null
      const payload = await response.json() as { default?: unknown; catalog?: unknown }
      if (!Array.isArray(payload.catalog)) return null
      return { default: typeof payload.default === 'string' ? payload.default : '', catalog: payload.catalog as LaunchChoice[] }
    },

    loadFalModelCount: () => get<{ services?: { id?: string; kind?: string; modelCount?: unknown }[] }>('/idealize/brains/services')
      .then((payload) => {
        const count = payload.services?.find(row => row.id === 'fal' && row.kind === 'media')?.modelCount
        return typeof count === 'number' && count > 0 ? count : null
      }, () => null),

    connectFal: apiKey => post('/idealize/brains/services', { id: 'fal', kind: 'media', apiKey }),

    loadChatFallback: () => get<{
      default?: { provider?: string }
      providers?: { provider?: string; displayName?: string; connected?: boolean }[]
    }>('/idealize/models/state').then((state) => {
      const provider = state.default?.provider
      if (provider === undefined || provider === 'openrouter') return null
      const row = state.providers?.find(entry => entry.provider === provider)
      return row?.connected === true ? row.displayName ?? provider : null
    }, () => null),

    async align(cli) {
      let response: Response
      try {
        response = await fetchFn('/idealize/onboarding/align', { method: 'POST', headers: HEADERS, body: JSON.stringify({ cli }) })
      } catch {
        return { ok: false, error: UNREACHABLE }
      }
      const payload = await response.json() as AlignResult & { error?: string }
      if (response.ok) return { ok: true, result: payload }
      return { ok: false, error: payload.error ?? `The route answered HTTP ${String(response.status)}` }
    },

    loadGateway: () => get<{ connected?: boolean }>('/idealize/brains/gateway').then(state => state.connected === true, () => false),

    connectGateway: (address, key) => post('/idealize/brains/gateway', { address, key }),

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

    loadWeeklyReview: () => get<{ accepted?: boolean; enabled?: boolean }>('/idealize/setup/weekly-review')
      .then(offer => offer.accepted === true && offer.enabled === true, () => false),

    acceptWeeklyReview: () => post('/idealize/setup/weekly-review', { accept: true }),

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

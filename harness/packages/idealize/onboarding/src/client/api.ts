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

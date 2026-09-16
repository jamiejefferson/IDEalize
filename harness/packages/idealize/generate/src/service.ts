/**
 * Service Definition for the generation capability seam (`ctx.generation`):
 * a registry of generation backends plus compatibility-checked dispatch.
 * Backends register with `register()` (duplicate ids are rejected; the
 * returned disposer removes the backend); consumers query the merged
 * catalogue, ask availability for a requirement set, and run generations
 * routed to the chosen backend.
 * @module @idealize/generate/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { satisfiesAll } from './compat.ts'
import { GenerationError } from './error.ts'
import { installMediaRoutes } from './routes.ts'
import type {
  BackendCredential,
  BackendCredentialState,
  CapabilityRequirement,
  GenCatalogEntry,
  GenerationAvailability,
  GenerationBackend,
  GenerationProgressSink,
  GenerationRequest,
  GenerationResult,
  GenInputField,
  GenModelRef,
} from './types.ts'

/** Version carried by descriptors, requests, and results this seam exchanges. */
export const GENERATION_SCHEMA_VERSION = 1

declare module '@deepseek-ai/cordis' {
  interface Context {
    generation: GenerationRuntime
  }
}

/**
 * The generation service. Registered as `ctx.generation` (one instance per
 * context). Also mounts the `/idealize/brains/media` preset routes and the
 * `/idealize/generate/inputs` route while a web server and settings service
 * are composed beside it.
 */
export class GenerationRuntime extends Service {
  private readonly backendsById = new Map<string, GenerationBackend>()

  constructor(ctx: Context) {
    super(ctx, 'generation')
    installMediaRoutes(ctx, this)
  }

  /**
   * Register a generation backend. Throws if its id is already registered —
   * a duplicate is a composition bug, not a task failure. Returns a disposer;
   * disposed with the calling fiber.
   * @param backend - the backend; its `id` is the registry key.
   * @returns the disposer that unregisters the backend.
   */
  register(backend: GenerationBackend): () => void {
    if (this.backendsById.has(backend.id)) {
      throw new Error(`generation: a backend with id "${backend.id}" is already registered`)
    }
    const store = this.backendsById
    const dispose = this.ctx.effect(function* () {
      store.set(backend.id, backend)
      yield () => store.delete(backend.id)
    }, 'generation.register()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * The registered backend ids.
   * @returns the ids in registration order.
   */
  backends(): readonly string[] {
    return [...this.backendsById.keys()]
  }

  /**
   * The backends that take a key from the person, with whether one is stored
   * and what each serves: a backend is connected while none of its descriptors
   * reads `no-credential`, and its artefacts are the ones its descriptors name,
   * which a backend states before it has fetched a single model.
   * @returns one row per backend declaring a {@link BackendCredential}, in registration order.
   */
  credentials(): BackendCredentialState[] {
    return [...this.backendsById.values()]
      .filter((backend): backend is GenerationBackend & { credential: BackendCredential } => backend.credential !== undefined)
      .map(backend => ({
        backend: backend.id,
        ...backend.credential,
        connected: !backend.describe().some(descriptor => descriptor.availability === 'no-credential'),
        artefacts: [...new Set(backend.describe().map(descriptor => descriptor.artefact))],
      }))
  }

  /**
   * Re-fetch one backend's catalogue after its key changed.
   * @param id - the backend id.
   * @returns false when no backend has that id; true once its refresh (if any) settled.
   */
  async refreshBackend(id: string): Promise<boolean> {
    const backend = this.backendsById.get(id)
    if (backend === undefined) return false
    await backend.refresh?.()
    return true
  }

  /**
   * The inputs a person may choose for one model before generating, from its
   * backend's {@link GenerationBackend.inputs}.
   * @param model - the backend and model id.
   * @returns the fields; empty when no backend has that id or the backend publishes no schema. Rejects when the backend's fetch fails.
   */
  async inputs(model: GenModelRef): Promise<readonly GenInputField[]> {
    const backend = this.backendsById.get(model.backend)
    if (backend?.inputs === undefined) return []
    return backend.inputs(model.model)
  }

  /**
   * The merged catalogue: every model each registered backend publishes.
   * @returns one entry per (backend, model), in registration order.
   */
  catalog(): GenCatalogEntry[] {
    return [...this.backendsById.values()].flatMap(backend =>
      backend.models().map(model => ({ backend: backend.id, model })))
  }

  /**
   * Catalogue rows whose model satisfies every requirement in the set
   * (artefact matches and required input modalities are a subset).
   * @param requirements - a preset's or task's `requiredCapabilities`.
   * @returns the compatible entries, in catalogue order.
   */
  compatible(requirements: readonly CapabilityRequirement[]): GenCatalogEntry[] {
    return this.catalog().filter(entry => satisfiesAll(entry.model, requirements))
  }

  /**
   * Queryable availability for a requirement set: available with the match
   * counts, or unavailable with the reason and a recovery action.
   * @param requirements - a preset's or task's `requiredCapabilities`.
   * @returns the availability verdict.
   */
  availability(requirements: readonly CapabilityRequirement[]): GenerationAvailability {
    if (this.backendsById.size === 0) {
      return {
        state: 'unavailable',
        reason: 'no-backend',
        recovery: 'No generation adapter is registered. Enable a generation adapter plugin, then reopen this panel.',
      }
    }
    const matches = this.compatible(requirements)
    if (matches.length === 0) {
      const artefacts = [...new Set(requirements.map(requirement => requirement.artefact))].join(', ')
      // A backend without a credential describes every artefact it serves as
      // `no-credential`; a connected backend with nothing for this artefact is
      // a catalogue gap no key can close, and the copy must not ask for one.
      const keyMissing = [...this.backendsById.values()]
        .every(backend => backend.describe().some(descriptor => descriptor.availability === 'no-credential'))
      return {
        state: 'unavailable',
        reason: 'no-compatible-model',
        recovery: keyMissing
          ? `No connected provider offers a compatible ${artefacts} model. Store the provider's API key in Settings, then refresh the catalogue.`
          : `No connected provider offers ${artefacts} generation yet.`,
        keyMissing,
      }
    }
    return {
      state: 'available',
      backends: [...new Set(matches.map(entry => entry.backend))],
      models: matches.length,
    }
  }

  /**
   * Run one generation on the request's chosen backend and model. The model
   * must exist in that backend's catalogue and satisfy the request's required
   * capabilities. Backend failures that are not already GenerationErrors are
   * wrapped as `PROVIDER_ERROR` with the cause chained.
   * @param request - the task request; `model` names the backend and model id.
   * @param onProgress - optional progress sink; omitted reports are dropped.
   * @param signal - optional cancellation signal forwarded to the backend.
   * @returns the completed result.
   */
  async generate(request: GenerationRequest, onProgress?: GenerationProgressSink, signal?: AbortSignal): Promise<GenerationResult> {
    const backend = this.backendsById.get(request.model.backend)
    if (backend === undefined) {
      throw new GenerationError(`no generation backend "${request.model.backend}" is registered`, 'NO_ADAPTER')
    }
    const model = backend.models().find(candidate => candidate.id === request.model.model)
    if (model === undefined) {
      throw new GenerationError(`backend "${request.model.backend}" offers no model "${request.model.model}"`, 'NO_MODEL')
    }
    if (!satisfiesAll(model, request.requiredCapabilities)) {
      throw new GenerationError(
        `model "${model.id}" does not satisfy the request's required capabilities`,
        'INCOMPATIBLE_MODEL',
      )
    }
    try {
      return await backend.generate(request, onProgress ?? (() => {}), signal ?? new AbortController().signal)
    } catch (error) {
      if (error instanceof GenerationError) throw error
      throw new GenerationError(
        `generation failed on ${request.model.backend}/${request.model.model}: ${errorChain(error)}`,
        'PROVIDER_ERROR',
        { cause: error },
      )
    }
  }
}

export default GenerationRuntime

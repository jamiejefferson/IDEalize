/**
 * Vocabulary types for the generation capability seam (`ctx.generation`):
 * artefacts, modalities, capability descriptors, model metadata, requests,
 * progress, results, and the backend contract adapter plugins implement.
 * @module @idealize/generate/types
 */

/** The artefact kinds a generation backend can produce. */
export type GenArtefact = 'image' | 'video' | 'audio'

/** An input or output modality named by a capability requirement or model. */
export type GenModality = 'text' | 'image' | 'audio' | 'video'

/**
 * A capability requirement a preset or task states. A model satisfies it when
 * the artefact matches and every required input modality is among the model's
 * input modalities ({@link import('./compat.ts').satisfies}).
 */
export interface CapabilityRequirement {
  operation: 'generate'
  artefact: GenArtefact
  inputModalities: readonly GenModality[]
}

/**
 * One capability a backend declares: the operation, the artefact, the input
 * modalities at least one of its models accepts, the media types results
 * arrive as, provider constraints, and current availability.
 */
export interface CapabilityDescriptor {
  operation: 'generate'
  artefact: GenArtefact
  /** Union of input modalities across the backend's models for this artefact. */
  inputModalities: readonly GenModality[]
  /** Media types (exact, or `type/*` ranges when the provider states none) results arrive as. */
  outputMediaTypes: readonly string[]
  /** Provider-specific input constraints; absent when the provider states none. */
  constraints?: Readonly<Record<string, unknown>>
  /** `no-credential` names its own recovery: store the backend's API key. */
  availability: 'available' | 'no-credential'
  /** Contract version of this descriptor (`GENERATION_SCHEMA_VERSION`). */
  schemaVersion: number
}

/** One selectable model, as a backend publishes it. */
export interface GenModelInfo {
  /** Provider-scoped model identifier (for example `google/lyria-3-pro-preview`). */
  id: string
  /** Display name; equals the id when the provider names none. */
  name: string
  artefact: GenArtefact
  inputModalities: readonly GenModality[]
  outputMediaTypes: readonly string[]
}

/** The model a request runs on: backend registry id plus that backend's model id. */
export interface GenModelRef {
  backend: string
  model: string
}

/** One input attachment for modalities beyond text. */
export interface GenAttachment {
  mediaType: string
  /** Base64 payload. */
  data: string
}

/**
 * A generation task request: intent and required capabilities come from the
 * preset (capability vocabulary, never model ids); the model ref comes from
 * stored provider configuration.
 */
export interface GenerationRequest {
  schemaVersion: number
  /** Task intent identifier from the preset (for example `generate-image`). */
  taskIntent: string
  requiredCapabilities: readonly CapabilityRequirement[]
  model: GenModelRef
  /** The prompt describing what to generate. */
  prompt: string
  attachments?: readonly GenAttachment[]
  /** Provider-neutral generation settings; backends pass through what they understand. */
  settings?: Readonly<Record<string, unknown>>
  /** Project path the task belongs to, when one is active. */
  projectPath?: string
}

/** One progress report while a generation runs. */
export interface GenerationProgress {
  phase: 'queued' | 'sending' | 'receiving' | 'done'
  message?: string
}

/** Progress sink a caller passes to `generate`. */
export type GenerationProgressSink = (progress: GenerationProgress) => void

/** One produced output. */
export interface GenerationOutput {
  mediaType: string
  /** Base64 payload. */
  data: string
}

/** The completed result a backend returns. */
export interface GenerationResult {
  schemaVersion: number
  backend: string
  model: string
  artefact: GenArtefact
  outputs: readonly GenerationOutput[]
  /** Provider-reported usage or cost facts, passed through untyped. */
  usage?: Readonly<Record<string, unknown>>
  /** Completion time (epoch milliseconds). */
  timestamp: number
}

/**
 * The API key a backend generates with, when the person pastes it in under
 * Brains: the provider's display name and the credential environment name the
 * backend resolves. A backend whose key another surface stores (a chat
 * provider's) or that needs none declares nothing.
 */
export interface BackendCredential {
  displayName: string
  env: string
}

/** One backend's key state as `GET /idealize/brains/media-keys` reports it. */
export interface BackendCredentialState extends BackendCredential {
  backend: string
  /** True while a stored key resolves and the backend's catalogue is described `available`. */
  connected: boolean
  /**
   * What this backend serves, from its descriptors rather than its catalogue.
   * A backend that has not fetched its models yet still makes what it makes,
   * and the Services list says so before any key is stored.
   */
  artefacts: readonly GenArtefact[]
}

/**
 * One input a person may choose before generating: the wire property name a
 * chosen value travels under in `GenerationRequest.settings`, a display label,
 * and the values it takes. `kind` says which: `enum` lists string literals,
 * `number` takes a number within the bounds the model states, `boolean` is a
 * switch. `default` is the value the model applies when the property is absent
 * from the body, when it states one.
 */
export type GenInputField = GenEnumField | GenNumberField | GenBooleanField

/** What every {@link GenInputField} carries, whatever its kind. */
export interface GenInputFieldBase {
  /** The wire property name; a chosen value is sent under it. */
  name: string
  /** Display label (`Aspect`, `Duration`, `Resolution`, else the humanised name). */
  label: string
}

/** A string-enum input: one of the literals the model lists. */
export interface GenEnumField extends GenInputFieldBase {
  kind: 'enum'
  /** The literals the model accepts, in the order it lists them. */
  values: readonly string[]
  /** The model's default, when it states one among `values`. */
  default?: string
}

/** A numeric input, integer or not, within the bounds the model states. */
export interface GenNumberField extends GenInputFieldBase {
  kind: 'number'
  /** True when the model types the property `integer`. */
  integer: boolean
  /** The smallest value the model accepts, when it states one. */
  min?: number
  /** The largest value the model accepts, when it states one. */
  max?: number
  /** The model's default, when it states a numeric one. */
  default?: number
}

/** A boolean input: a switch the model reads as true or false. */
export interface GenBooleanField extends GenInputFieldBase {
  kind: 'boolean'
  /** The model's default, when it states a boolean one. */
  default?: boolean
}

/** The backend contract adapter plugins register with `ctx.generation`. */
export interface GenerationBackend {
  /** Registry id, unique per runtime; doubles as {@link GenModelRef.backend}. */
  readonly id: string
  /** The key this backend takes from the person, when it takes one; see {@link BackendCredential}. */
  readonly credential?: BackendCredential
  /** Capabilities this backend serves, from its last-known catalogue. Must not throw. */
  describe(): readonly CapabilityDescriptor[]
  /** Models this backend offers, from its last-known catalogue. Must not throw. */
  models(): readonly GenModelInfo[]
  /**
   * Re-fetch live catalogue data and merge it over the shipped defaults.
   * Optional; a rejection leaves the last-known lists standing and a later
   * call retries.
   */
  refresh?(): Promise<void>
  /**
   * The inputs a person may choose for one model before generating, read from
   * the model's own input schema: enum-typed fields only, with the prompt and
   * the provider's internal fields left out. Optional; resolves empty when the
   * service publishes no schema for the model, and rejects with a
   * GenerationError when the schema cannot be fetched.
   * @param modelId - the backend's model id.
   */
  inputs?(modelId: string): Promise<readonly GenInputField[]>
  /**
   * Run one generation. Rejects with a GenerationError carrying the shared
   * code union; provider failures are translated, never rethrown raw.
   */
  generate(request: GenerationRequest, onProgress: GenerationProgressSink, signal: AbortSignal): Promise<GenerationResult>
}

/** One catalogue row: a model and the backend that serves it. */
export interface GenCatalogEntry {
  backend: string
  model: GenModelInfo
}

/**
 * Queryable availability for a requirement set: available with the matching
 * catalogue size, or unavailable with the reason and a recovery action.
 */
export type GenerationAvailability =
  | { state: 'available'; backends: readonly string[]; models: number }
  | {
    state: 'unavailable'
    reason: 'no-backend' | 'no-compatible-model'
    recovery: string
    /**
     * `no-compatible-model` only: true when no registered backend holds a
     * credential, so storing a key is the recovery; false when the backends
     * are connected and the catalogue offers nothing for the artefact.
     */
    keyMissing?: boolean
  }

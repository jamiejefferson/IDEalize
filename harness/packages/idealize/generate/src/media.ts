/**
 * The default media presets (Images, Motion, Sound) and the pure state
 * assembly behind the `/idealize/brains/media` routes.
 *
 * Each preset declares its task intent, required capabilities, and artefact
 * type here in code; the user's chosen model per preset lives only in the
 * settings document — the `models` map of the `idealize-activity-pills`
 * section, beside the activity agents' own choices — so the Brains pane reads
 * one roster of preset→model decisions and no model id appears in code.
 * @module @idealize/generate/media
 */

import type {
  BackendCredentialState,
  CapabilityRequirement,
  GenArtefact,
  GenCatalogEntry,
  GenerationAvailability,
  GenInputField,
  GenModelRef,
} from './types.ts'

/** One media preset: identity plus the capability contract its tasks state. */
export interface MediaPresetDefinition {
  /** Preset id, keying the stored model choice in the settings map. */
  id: string
  /** Roster display name. */
  name: string
  /** Roster description. */
  description: string
  /** Roster sort position, after the activity agents. */
  order: number
  /** Task intent identifier submitted with the preset's tasks. */
  taskIntent: string
  /** The artefact type this preset produces. */
  artefactType: GenArtefact
  /** Capabilities a model must satisfy to be selectable for this preset. */
  requiredCapabilities: readonly CapabilityRequirement[]
}

/** The three default media presets, in roster order. */
export const MEDIA_PRESETS: readonly MediaPresetDefinition[] = [
  {
    id: 'images',
    name: 'Images',
    description: 'Creates still images from a prompt.',
    order: -40,
    taskIntent: 'generate-image',
    artefactType: 'image',
    requiredCapabilities: [{ operation: 'generate', artefact: 'image', inputModalities: ['text'] }],
  },
  {
    id: 'motion',
    name: 'Motion',
    description: 'Creates video and motion graphics from a prompt.',
    order: -39,
    taskIntent: 'generate-video',
    artefactType: 'video',
    requiredCapabilities: [{ operation: 'generate', artefact: 'video', inputModalities: ['text'] }],
  },
  {
    id: 'sound',
    name: 'Sound',
    description: 'Creates audio from a prompt.',
    order: -38,
    taskIntent: 'generate-audio',
    artefactType: 'audio',
    requiredCapabilities: [{ operation: 'generate', artefact: 'audio', inputModalities: ['text'] }],
  },
]

/** The media preset ids in roster order. */
export const MEDIA_PRESET_IDS: readonly string[] = MEDIA_PRESETS.map(preset => preset.id)

/**
 * The stored preset→model map, as far as this module reads it. The
 * `idealize-activity-pills` settings section owns the schema; this face is
 * restated here the way `@idealize/models` restates the `llm-pi-ai` section.
 */
export interface ActivityModelsSectionFace {
  models?: Record<string, { provider?: unknown; model?: unknown } | undefined>
}

/** The catalogue queries the media state reads from the generation runtime. */
export interface GenerationQueries {
  /** Catalogue rows whose model satisfies every requirement. */
  compatible(requirements: readonly CapabilityRequirement[]): GenCatalogEntry[]
  /** Availability for the requirement set, with a recovery action when unavailable. */
  availability(requirements: readonly CapabilityRequirement[]): GenerationAvailability
}

/** The input-schema query the `/idealize/generate/inputs` route reads from the generation runtime. */
export interface GenerationInputQueries {
  /** The fields a person may choose for one model; empty when its backend publishes none. */
  inputs(model: GenModelRef): Promise<readonly GenInputField[]>
}

/**
 * The media preset each generating space's chosen model is stored under: the
 * space ids of `@idealize/spaces`' table and the preset ids themselves are
 * both accepted, so a caller may name either.
 */
const PRESET_BY_SPACE: Readonly<Record<string, string>> = {
  gallery: 'images',
  images: 'images',
  soundstage: 'sound',
  sound: 'sound',
  motion: 'motion',
  video: 'motion',
}

/**
 * The media preset id a space's generations are routed by.
 * @param space - a generating space id (`gallery`, `soundstage`, `motion`) or a media preset id.
 * @returns the preset id, or undefined for a space that does not generate.
 */
export function presetIdForSpace(space: string): string | undefined {
  return PRESET_BY_SPACE[space]
}

/** The key queries the media-keys route reads from and writes through the generation runtime. */
export interface GenerationKeyQueries {
  /** The backends that take a key from the person, with whether one is stored. */
  credentials(): BackendCredentialState[]
  /** Re-fetch one backend's catalogue after its key changed; false when no backend has that id. */
  refreshBackend(id: string): Promise<boolean>
}

/** One preset's full route payload: definition, stored choice, candidates, availability. */
export interface MediaPresetState extends MediaPresetDefinition {
  /** The stored model choice, null while none is stored. */
  model: GenModelRef | null
  /** Models whose declared capabilities satisfy the preset's requirements. */
  candidates: readonly GenCatalogEntry[]
  availability: GenerationAvailability
}

/**
 * Read one preset's stored model choice from the settings section.
 * @param section - the resolved `idealize-activity-pills` section, if registered.
 * @param id - the preset id.
 * @returns the stored `{backend, model}` ref, or null while none is stored or the entry is malformed.
 */
export function storedMediaModel(section: ActivityModelsSectionFace | undefined, id: string): GenModelRef | null {
  const entry = section?.models?.[id]
  const provider = entry?.provider
  const model = entry?.model
  if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
    return { backend: provider, model }
  }
  return null
}

/**
 * Assemble the GET payload: every media preset with its stored choice, the
 * compatibility-filtered candidates, and current availability.
 * @param queries - the generation runtime's catalogue queries.
 * @param section - the resolved `idealize-activity-pills` section, if registered.
 * @returns one state per preset, in roster order.
 */
export function mediaPresetStates(queries: GenerationQueries, section: ActivityModelsSectionFace | undefined): MediaPresetState[] {
  return MEDIA_PRESETS.map(preset => ({
    ...preset,
    model: storedMediaModel(section, preset.id),
    candidates: queries.compatible(preset.requiredCapabilities),
    availability: queries.availability(preset.requiredCapabilities),
  }))
}

/**
 * Validate a POST body for the media selection route.
 * @param body - the parsed JSON body (wire boundary: untrusted).
 * @returns the accepted selection, or the refusal to send back as a 400.
 */
export function parseMediaSelection(body: unknown): { ok: true; id: string; model: GenModelRef | null } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be a JSON object' }
  const { id, model } = body as { id?: unknown; model?: unknown }
  if (typeof id !== 'string' || !MEDIA_PRESET_IDS.includes(id)) {
    return { ok: false, error: `id must be one of: ${MEDIA_PRESET_IDS.join(', ')}` }
  }
  if (model === null || model === undefined) return { ok: true, id, model: null }
  if (typeof model !== 'object') return { ok: false, error: 'model must be {backend, model} or null' }
  const { backend, model: modelId } = model as { backend?: unknown; model?: unknown }
  if (typeof backend !== 'string' || backend === '' || typeof modelId !== 'string' || modelId === '') {
    return { ok: false, error: 'model must be {backend, model} or null' }
  }
  return { ok: true, id, model: { backend, model: modelId } }
}

/**
 * Compose the next stored preset→model map: every well-formed existing entry
 * except the edited id, plus the new choice (a null choice clears the entry).
 * @param section - the resolved `idealize-activity-pills` section, if registered.
 * @param id - the preset id being edited.
 * @param model - the new choice, or null to clear it.
 * @returns the complete next `models` map to store.
 */
export function applyMediaSelection(
  section: ActivityModelsSectionFace | undefined,
  id: string,
  model: GenModelRef | null,
): Record<string, { provider: string; model: string }> {
  const next: Record<string, { provider: string; model: string }> = {}
  for (const [key, value] of Object.entries(section?.models ?? {})) {
    if (key === id) continue
    const provider = value?.provider
    const modelId = value?.model
    if (typeof provider === 'string' && typeof modelId === 'string') next[key] = { provider, model: modelId }
  }
  if (model !== null) next[id] = { provider: model.backend, model: model.model }
  return next
}

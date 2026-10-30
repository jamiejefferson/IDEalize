/**
 * Queue-service catalogue handling, pure: map one `GET /models` page to seam
 * model metadata by its category, and merge live rows over what is already
 * known. Nothing is compiled in — the known rows come from the cache the last
 * successful fetch wrote.
 * @module @idealize/services/adapters/queue-catalog
 */

import type { GenArtefact, GenModality, GenModelInfo } from '@idealize/generate'

/** One catalogue category a queue service lists, and what it implies. */
export interface QueueCategory {
  /** The service's own category name, as its catalogue reports it. */
  category: string
  /** The artefact models in that category produce. */
  artefact: GenArtefact
  /** What such a model takes as input. */
  inputModalities: readonly GenModality[]
  /** Inputs such a model cannot run without beyond the prompt; absent when the prompt is enough. */
  requiredInputs?: readonly GenModality[]
}

/**
 * Media-type ranges per artefact: the catalogue does not state result formats.
 * @param artefact - the artefact kind a model produces.
 * @returns the wildcard media-type range for that kind.
 */
export function defaultMediaTypes(artefact: GenArtefact): string[] {
  if (artefact === 'image') return ['image/*']
  if (artefact === 'video') return ['video/*']
  return ['audio/*']
}

/**
 * Map one live `GET /v1/models?category=…` page to seam model metadata,
 * keeping active inference rows whose category is one the backend lists.
 * @param body - the parsed page JSON (wire boundary: untrusted).
 * @param categories - the categories this service lists, with what each makes.
 * @returns one entry per usable row, in page order.
 */
export function liveModelsFrom(body: unknown, categories: readonly QueueCategory[]): GenModelInfo[] {
  const rows = (body as { models?: unknown } | null | undefined)?.models
  if (!Array.isArray(rows)) return []
  const models: GenModelInfo[] = []
  for (const row of rows) {
    const { endpoint_id: id, metadata } = (row ?? {}) as {
      endpoint_id?: unknown
      metadata?: {
        display_name?: unknown
        category?: unknown
        status?: unknown
        kind?: unknown
        description?: unknown
        thumbnail_url?: unknown
        thumbnail_animated_url?: unknown
        tags?: unknown
        license_type?: unknown
        date?: unknown
      }
    }
    if (typeof id !== 'string' || id === '') continue
    const listed = categories.find(entry => entry.category === metadata?.category)
    if (listed === undefined) continue
    if (metadata?.status !== undefined && metadata.status !== 'active') continue
    if (metadata?.kind !== undefined && metadata.kind !== 'inference') continue
    const name = metadata?.display_name
    const description = text(metadata?.description)
    const thumbnailUrl = https(metadata?.thumbnail_url)
    const thumbnailAnimatedUrl = https(metadata?.thumbnail_animated_url)
    const tags = tagsFrom(metadata?.tags, listed.category)
    const licence = text(metadata?.license_type)
    const released = isoDate(metadata?.date)
    models.push({
      id,
      name: typeof name === 'string' && name !== '' ? name : id,
      artefact: listed.artefact,
      inputModalities: [...listed.inputModalities],
      outputMediaTypes: defaultMediaTypes(listed.artefact),
      ...listed.requiredInputs === undefined || listed.requiredInputs.length === 0 ? {} : { requiredInputs: [...listed.requiredInputs] },
      ...description === undefined ? {} : { description },
      ...thumbnailUrl === undefined ? {} : { thumbnailUrl },
      ...thumbnailAnimatedUrl === undefined ? {} : { thumbnailAnimatedUrl },
      ...tags.length === 0 ? {} : { tags },
      ...licence === undefined ? {} : { licence },
      ...released === undefined ? {} : { released },
      maker: makerOf(id),
    })
  }
  return models
}

/** A trimmed non-empty string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** A trimmed https URL, or undefined for anything else: a picker loads it, so no other scheme gets through. */
function https(value: unknown): string | undefined {
  const url = text(value)
  return url !== undefined && /^https:\/\/\S+$/.test(url) ? url : undefined
}

/** The `YYYY-MM-DD` part of an ISO timestamp, or undefined when the value is not one. */
function isoDate(value: unknown): string | undefined {
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null
  return match?.[1]
}

/** A tag folded for comparison: lower case, with spaces, hyphens and underscores treated alike. */
function folded(tag: string): string {
  return tag.toLowerCase().replace(/[\s_-]+/g, ' ').trim()
}

/**
 * The provider's tags worth filtering on: lower case, trimmed, de-duplicated,
 * without empty tags and without tags that only restate the category
 * (`text-to-video`, `text to video` on a text-to-video model).
 * @param raw - the row's `tags` (wire boundary: untrusted).
 * @param category - the catalogue category the row was listed under.
 * @returns the kept tags, in the provider's order.
 */
export function tagsFrom(raw: unknown, category: string): string[] {
  if (!Array.isArray(raw)) return []
  const restated = folded(category)
  const kept: string[] = []
  for (const tag of raw) {
    if (typeof tag !== 'string') continue
    const clean = tag.trim().toLowerCase()
    if (clean === '' || folded(clean) === restated || kept.includes(clean)) continue
    kept.push(clean)
  }
  return kept
}

/**
 * Who makes a model, read from its endpoint id: the first segment, or the
 * second when the first is fal's own namespace (`fal-ai/flux-2-pro` reads as
 * `flux-2-pro`, `bytedance/seedream/v5/pro` as `bytedance`).
 * @param id - the endpoint id.
 * @returns the maker or family segment.
 */
export function makerOf(id: string): string {
  const [first = id, second] = id.split('/')
  return first === 'fal-ai' && second !== undefined && second !== '' ? second : first
}

/**
 * Merge live rows over the rows already known: a live row replaces the known
 * row with its id, and a known row the live list omits stays selectable, so a
 * partial fetch never shrinks the picker.
 * @param known - what the cache held, or the last refresh produced.
 * @param live - the rows this refresh produced.
 * @returns the merged catalogue, known order first, then new live rows.
 */
export function mergeCatalog(known: readonly GenModelInfo[], live: readonly GenModelInfo[]): GenModelInfo[] {
  const merged = new Map<string, GenModelInfo>()
  for (const model of known) merged.set(model.id, model)
  for (const model of live) {
    // The catalogue page carries no price; a price fetched earlier stays
    // until the next price fetch replaces it.
    const price = merged.get(model.id)?.price
    merged.set(model.id, model.price === undefined && price !== undefined ? { ...model, price } : model)
  }
  return [...merged.values()]
}

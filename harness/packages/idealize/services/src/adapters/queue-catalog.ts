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
      metadata?: { display_name?: unknown; category?: unknown; status?: unknown; kind?: unknown }
    }
    if (typeof id !== 'string' || id === '') continue
    const listed = categories.find(entry => entry.category === metadata?.category)
    if (listed === undefined) continue
    if (metadata?.status !== undefined && metadata.status !== 'active') continue
    if (metadata?.kind !== undefined && metadata.kind !== 'inference') continue
    const name = metadata?.display_name
    models.push({
      id,
      name: typeof name === 'string' && name !== '' ? name : id,
      artefact: listed.artefact,
      inputModalities: [...listed.inputModalities],
      outputMediaTypes: defaultMediaTypes(listed.artefact),
    })
  }
  return models
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
  for (const model of live) merged.set(model.id, model)
  return [...merged.values()]
}

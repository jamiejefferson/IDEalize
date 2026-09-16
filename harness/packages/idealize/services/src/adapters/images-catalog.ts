/**
 * Images-service catalogue handling, pure: map the live `/models` response to
 * seam model metadata by output modality, and merge live rows over what is
 * already known. Nothing is compiled in — the known rows come from the cache
 * the last successful fetch wrote, plus the image shapes the vendored provider
 * library carries.
 * @module @idealize/services/adapters/images-catalog
 */

import type { ImagesModel } from '@earendil-works/pi-ai'
import type { GenArtefact, GenModality, GenModelInfo } from '@idealize/generate'

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

const MODALITIES: readonly GenModality[] = ['text', 'image', 'audio', 'video']

function modalitiesOf(value: unknown): GenModality[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is GenModality => MODALITIES.includes(entry as GenModality))
}

/**
 * The artefact a model's output modalities imply: the richest non-text output
 * (video over audio over image), or undefined for text-only rows.
 * @param outputs - the row's `architecture.output_modalities`.
 * @returns the artefact, or undefined when the row generates no media.
 */
export function artefactOf(outputs: readonly GenModality[]): GenArtefact | undefined {
  if (outputs.includes('video')) return 'video'
  if (outputs.includes('audio')) return 'audio'
  if (outputs.includes('image')) return 'image'
  return undefined
}

/**
 * Map the live `/api/v1/models` response body to seam model metadata,
 * keeping only rows whose output modalities name a media artefact.
 * @param body - the parsed response JSON (wire boundary: untrusted).
 * @returns one entry per media-generating row, in response order.
 */
export function liveModelsFrom(body: unknown): GenModelInfo[] {
  const data = (body as { data?: unknown } | null | undefined)?.data
  if (!Array.isArray(data)) return []
  const models: GenModelInfo[] = []
  for (const row of data) {
    const { id, name, architecture } = (row ?? {}) as {
      id?: unknown
      name?: unknown
      architecture?: { input_modalities?: unknown; output_modalities?: unknown }
    }
    if (typeof id !== 'string' || id === '') continue
    const artefact = artefactOf(modalitiesOf(architecture?.output_modalities))
    if (artefact === undefined) continue
    models.push({
      id,
      name: typeof name === 'string' && name !== '' ? name : id,
      artefact,
      inputModalities: modalitiesOf(architecture?.input_modalities),
      outputMediaTypes: defaultMediaTypes(artefact),
    })
  }
  return models
}

/**
 * Map one pi-ai images-catalogue model to seam metadata.
 * @param model - one row of the vendored provider library's own image catalogue.
 * @returns the seam metadata for that model; a row naming no name is named by its id.
 */
export function fromImagesModel(model: ImagesModel<string>): GenModelInfo {
  return {
    id: model.id,
    name: model.name === '' ? model.id : model.name,
    artefact: 'image',
    inputModalities: model.input,
    outputMediaTypes: defaultMediaTypes('image'),
  }
}

/**
 * Merge live catalogue rows over what is already known: a live row replaces
 * the known row with its id, and a known row the live list omits stays
 * selectable, so a partial fetch never shrinks the picker.
 * @param known - what the cache held, or the last refresh produced.
 * @param live - the rows the last refresh produced.
 * @returns the merged catalogue, known order first, then new live rows.
 */
export function mergeCatalog(known: readonly GenModelInfo[], live: readonly GenModelInfo[]): GenModelInfo[] {
  const merged = new Map<string, GenModelInfo>()
  for (const model of known) merged.set(model.id, model)
  for (const model of live) merged.set(model.id, model)
  return [...merged.values()]
}

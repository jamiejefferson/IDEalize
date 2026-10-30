/**
 * An endpoint's example output, pure: find the file a model's OpenAPI
 * document publishes as an example result, so a detail pane can play or show
 * it. fal writes examples on the response schema (`…Output`, each file an
 * object with `url` and usually `content_type`); a document without one there
 * may still name a matching file elsewhere.
 * @module @idealize/services/adapters/example-output
 */

import type { GenArtefact, GenExample } from '@idealize/generate'

/** Media types by file extension, per artefact. */
const BY_EXTENSION: Readonly<Record<GenArtefact, Readonly<Record<string, string>>>> = {
  image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' },
  video: { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' },
  audio: { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4' },
}

/** The media type a URL's extension names for an artefact, or undefined. */
function typeByExtension(url: string, artefact: GenArtefact): string | undefined {
  const extension = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase()
  return extension === undefined ? undefined : BY_EXTENSION[artefact][extension]
}

/** A served https URL, nothing else. */
function isHttps(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/[^\s"]+$/.test(value)
}

/**
 * The first file object under a value whose type fits the artefact: its
 * `content_type` when stated, else its URL's extension. Depth-first in
 * document order, at most 32 deep.
 */
function fileIn(value: unknown, artefact: GenArtefact, depth = 0): GenExample | undefined {
  if (depth > 32 || typeof value !== 'object' || value === null) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = fileIn(item, artefact, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  const row = value as Record<string, unknown>
  if (isHttps(row.url)) {
    const stated = typeof row.content_type === 'string' ? row.content_type.split(';')[0]?.trim() : undefined
    if (stated !== undefined && stated.startsWith(`${artefact}/`)) return { url: row.url, mediaType: stated }
    const byExtension = typeByExtension(row.url, artefact)
    if (byExtension !== undefined) return { url: row.url, mediaType: byExtension }
  }
  for (const child of Object.values(row)) {
    const found = fileIn(child, artefact, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** The first https string under a value whose extension fits the artefact, at most 32 deep. */
function urlIn(value: unknown, artefact: GenArtefact, depth = 0): GenExample | undefined {
  if (isHttps(value)) {
    const mediaType = typeByExtension(value, artefact)
    return mediaType === undefined ? undefined : { url: value, mediaType }
  }
  if (depth > 32 || typeof value !== 'object' || value === null) return undefined
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = urlIn(child, artefact, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Find a model's example output in its OpenAPI document. The response schema
 * (`components.schemas` keys ending in `Output`) is read first, file objects
 * before bare URL strings; failing that,
 * any https URL with a fitting extension anywhere else, leaving out the
 * document's `info` (it carries the catalogue thumbnail, which is no example)
 * and the input schemas (their example files are inputs, such as the picture
 * an image-to-image model starts from).
 * @param document - the parsed OpenAPI JSON (wire boundary: untrusted).
 * @param artefact - what the model makes.
 * @returns the example, or undefined when the document names none.
 */
export function exampleOutput(document: unknown, artefact: GenArtefact): GenExample | undefined {
  if (typeof document !== 'object' || document === null) return undefined
  const schemas = (document as { components?: { schemas?: unknown } }).components?.schemas
  const entries = typeof schemas === 'object' && schemas !== null ? Object.entries(schemas as Record<string, unknown>) : []
  const outputs = entries.filter(([key]) => key.endsWith('Output')).map(([, schema]) => schema)
  for (const schema of outputs) {
    const found = fileIn(schema, artefact)
    if (found !== undefined) return found
  }
  // Some response schemas list their example as a bare URL string
  // (`"examples": ["https://…/clip.wav"]`) rather than a file object.
  for (const schema of outputs) {
    const found = urlIn(schema, artefact)
    if (found !== undefined) return found
  }
  const { info: _info, components, ...rest } = document as Record<string, unknown>
  const otherSchemas = Object.fromEntries(entries.filter(([key]) => !key.endsWith('Input') && !key.endsWith('Output')))
  const { schemas: _schemas, ...otherComponents } = typeof components === 'object' && components !== null
    ? components as Record<string, unknown>
    : {}
  return urlIn([otherSchemas, otherComponents, rest], artefact)
}

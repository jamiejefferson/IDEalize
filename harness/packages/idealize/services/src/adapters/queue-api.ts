/**
 * Queue-service wire translation, pure: build the queue request body from a
 * generation request, find the result files in a queue response, and classify
 * provider failures into the shared GenerationError codes.
 * @module @idealize/services/adapters/queue-api
 */

import type { GenAttachment, GenerationErrorCode, GenerationRequest } from '@idealize/generate'

/**
 * The first image attachment of a request, when it carries one.
 * @param request - the task request.
 * @returns the attachment, or undefined.
 */
export function imageAttachment(request: GenerationRequest): GenAttachment | undefined {
  return (request.attachments ?? []).find(attachment => attachment.mediaType.startsWith('image/'))
}

/** The endpoint id segment fal's text-conditioned video endpoints end in, and the image-conditioned sibling. */
const TEXT_TO_VIDEO = 'text-to-video'
const IMAGE_TO_VIDEO = 'image-to-video'

/**
 * The endpoint one request is enqueued on. fal publishes each video family as
 * sibling endpoints, `…/text-to-video` and `…/image-to-video` (Seedance, Veo,
 * Kling and the rest), and only the image-conditioned one takes `image_url`.
 * A request carrying an image attachment to a model whose id ends in
 * `text-to-video` therefore goes to the `image-to-video` sibling; every other
 * request goes to the model's own endpoint.
 * @param modelId - the catalogue endpoint id the request names.
 * @param request - the task request.
 * @returns the endpoint id to POST to.
 */
export function endpointFor(modelId: string, request: GenerationRequest): string {
  if (imageAttachment(request) === undefined) return modelId
  const segments = modelId.split('/')
  if (segments.at(-1) !== TEXT_TO_VIDEO) return modelId
  return [...segments.slice(0, -1), IMAGE_TO_VIDEO].join('/')
}

/**
 * Build the JSON body for `POST queue.fal.run/<endpoint>`: the prompt, the
 * first image attachment as a data URL (`image_url`, the field fal's
 * image-conditioned endpoints share), and the seam's neutral settings mapped
 * onto fal's vocabulary — `aspect` `a:b` becomes `aspect_ratio`, `aspect`
 * `WxH` becomes `image_size {width, height}`, `duration_s` becomes `duration`,
 * `count` becomes `num_images`. Other settings pass through under their own
 * names, and a setting already carrying fal's own name (`duration`,
 * `aspect_ratio`, `image_size`, `num_images`) wins over the neutral one; the
 * endpoint's 422 reports any it refuses. Values keep their type here; the
 * endpoint's input schema decides the wire type at enqueue.
 * @param request - the task request.
 * @returns the body to POST.
 */
export function queuePayload(request: GenerationRequest): Record<string, unknown> {
  const { prompt: _prompt, aspect, duration_s: durationS, count, ...rest } = request.settings ?? {}
  const body: Record<string, unknown> = { ...rest, prompt: request.prompt }
  if (typeof aspect === 'string' && !('aspect_ratio' in body) && !('image_size' in body)) {
    const size = /^(\d{2,5})x(\d{2,5})$/i.exec(aspect.trim())
    if (size !== null) body['image_size'] = { width: Number(size[1]), height: Number(size[2]) }
    else if (/^\d{1,2}:\d{1,2}$/.test(aspect.trim())) body['aspect_ratio'] = aspect.trim()
  }
  if (typeof durationS === 'number' && Number.isFinite(durationS) && durationS > 0 && !('duration' in body)) body['duration'] = durationS
  if (typeof count === 'number' && Number.isInteger(count) && count > 0 && !('num_images' in body)) body['num_images'] = count
  const image = imageAttachment(request)
  if (image !== undefined) body['image_url'] = `data:${image.mediaType};base64,${image.data}`
  return body
}

/** One result file a queue response names. */
export interface ResultFile {
  url: string
  /** The `content_type` beside the URL, when the endpoint states one. */
  contentType?: string
}

/**
 * Find every file in a queue result: any object carrying a string `url`
 * (`images[]`, `image`, `video`, `audio`, `audio_file`, and whatever an
 * endpoint names its output), in document order, at most 32 deep.
 * @param result - the parsed result JSON (wire boundary: untrusted).
 * @returns the files, empty when the result carries none.
 */
export function resultFilesFrom(result: unknown): ResultFile[] {
  const files: ResultFile[] = []
  const walk = (value: unknown, depth: number): void => {
    if (depth > 32 || typeof value !== 'object' || value === null) return
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1)
      return
    }
    const record = value as Record<string, unknown>
    const url = record['url']
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      const contentType = record['content_type']
      files.push({ url, ...typeof contentType === 'string' && contentType !== '' ? { contentType } : {} })
      return
    }
    for (const entry of Object.values(record)) walk(entry, depth + 1)
  }
  walk(result, 0)
  return files
}

/**
 * Classify an HTTP refusal from fal into the shared code union.
 * @param status - the response status.
 * @returns the code a GenerationError should carry.
 */
export function classifyStatus(status: number): GenerationErrorCode {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 402) return 'QUOTA'
  if (status === 408) return 'TIMEOUT'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 400 && status < 500) return 'INVALID_REQUEST'
  return 'PROVIDER_ERROR'
}

/** One validation entry of a fal 422 body, with its `loc` reduced to the field path under `body`. */
export interface ValidationEntry {
  msg: string
  /** The dotted field path, `''` when the entry names no location. */
  field: string
}

/** The `detail` of a fal error body, or undefined when the text is not JSON carrying one. */
function errorDetail(text: string): unknown {
  try {
    return (JSON.parse(text) as { detail?: unknown } | null)?.detail
  } catch {
    // Not JSON: the caller reports the text itself.
    return undefined
  }
}

/**
 * The validation entries of a fal 422 body text.
 * @param text - the response body text (wire boundary: untrusted).
 * @returns the entries in document order; empty when the text is not fal's validation JSON.
 */
export function refusedFields(text: string): ValidationEntry[] {
  return validationEntries(errorDetail(text))
}

/**
 * The validation entries of a fal error body: every `detail[]` element with a
 * string `msg`, its `loc` joined without the leading `body` segment.
 * @param detail - the parsed `detail` (wire boundary: untrusted).
 * @returns the entries in document order; empty when `detail` is not a validation list.
 */
function validationEntries(detail: unknown): ValidationEntry[] {
  if (!Array.isArray(detail)) return []
  return detail
    .map(entry => (entry as { msg?: unknown; loc?: unknown } | null))
    .filter((entry): entry is { msg: string; loc?: unknown } => typeof entry?.msg === 'string')
    .map(entry => ({
      msg: entry.msg,
      field: Array.isArray(entry.loc) ? entry.loc.filter(part => part !== 'body').map(String).join('.') : '',
    }))
}

/**
 * The plain reason in a fal error body: `detail` as a string, or the
 * `msg` of each validation entry joined.
 * @param text - the response body text.
 * @returns the reason, or the text itself (bounded) when it is not fal's error JSON.
 */
export function refusalReason(text: string): string {
  const detail = errorDetail(text)
  if (typeof detail === 'string') return detail.slice(0, 300)
  const reasons = validationEntries(detail).map(entry => `${entry.field === '' ? '' : `${entry.field}: `}${entry.msg}`)
  if (reasons.length > 0) return reasons.join('; ').slice(0, 300)
  return text.slice(0, 300)
}

/** The `msg` fal's validation layer gives a required field the body omitted. */
const FIELD_REQUIRED = 'Field required'

/**
 * Fields fal endpoints require beyond the prompt, and the value each takes
 * when the request carries nothing for it. fal's music endpoints
 * (`minimax/music-3` among them) require `lyrics` beside `prompt`, and
 * `[instrumental]` is the structure tag their lyric vocabulary uses for a
 * track with no words. These are fal wire vocabulary, not deployment choices.
 */
export const REQUIRED_FIELD_DEFAULTS: Readonly<Record<string, string>> = { lyrics: '[instrumental]' }

/**
 * The defaults that would satisfy a 422 whose every `Field required` entry
 * names a field absent from the sent body and present in
 * {@link REQUIRED_FIELD_DEFAULTS}.
 * @param text - the 422 response body text (wire boundary: untrusted).
 * @param body - the body that was sent.
 * @returns the fields to add, or undefined when the 422 names no missing
 * field, names one without a default, or is not a validation body at all.
 */
export function requiredFieldDefaults(text: string, body: Record<string, unknown>): Record<string, string> | undefined {
  const missing = validationEntries(errorDetail(text))
    .filter(entry => entry.msg === FIELD_REQUIRED && entry.field !== '' && !(entry.field in body))
    .map(entry => entry.field)
  if (missing.length === 0) return undefined
  const defaults: Record<string, string> = {}
  for (const field of missing) {
    const value = REQUIRED_FIELD_DEFAULTS[field]
    if (value === undefined) return undefined
    defaults[field] = value
  }
  return defaults
}

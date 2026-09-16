/**
 * Images-service wire translation, pure: build the chat-completions payload for
 * audio/video generation, read media outputs back out of the response, and
 * classify provider failures into the shared GenerationError codes.
 * @module @idealize/services/adapters/images-api
 */

import type { GenArtefact, GenerationOutput, GenerationRequest } from '@idealize/generate'
import type { GenerationErrorCode } from '@idealize/generate'

/** One OpenAI-style content part of a user message. */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }

/**
 * Build the chat-completions payload for a media generation: the prompt (plus
 * image/audio attachments as content parts) with `modalities` asking for the
 * artefact beside text.
 * @param request - the task request.
 * @param artefact - the artefact being generated (`audio` or `video` routes use this endpoint).
 * @returns the JSON payload to POST to `/chat/completions`.
 */
export function chatMediaPayload(request: GenerationRequest, artefact: GenArtefact): Record<string, unknown> {
  const attachments = request.attachments ?? []
  const parts: ContentPart[] = [{ type: 'text', text: request.prompt }]
  for (const attachment of attachments) {
    if (attachment.mediaType.startsWith('image/')) {
      parts.push({ type: 'image_url', image_url: { url: `data:${attachment.mediaType};base64,${attachment.data}` } })
    } else if (attachment.mediaType.startsWith('audio/')) {
      parts.push({ type: 'input_audio', input_audio: { data: attachment.data, format: attachment.mediaType.slice('audio/'.length) } })
    }
  }
  return {
    model: request.model.model,
    messages: [{ role: 'user', content: parts.length === 1 ? request.prompt : parts }],
    modalities: ['text', artefact === 'video' ? 'video' : 'audio'],
    ...request.settings ?? {},
  }
}

/**
 * Parse one `data:<mediaType>;base64,<payload>` URL.
 * @param url - the candidate data URL.
 * @returns the output, or undefined when the URL is not base64 data.
 */
export function parseDataUrl(url: string): GenerationOutput | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(url)
  const [, mediaType, data] = match ?? []
  if (mediaType === undefined || data === undefined) return undefined
  return { mediaType, data }
}

/**
 * Read the media outputs out of a chat-completions response: the message's
 * `audio.data` (typed by its `format`) and any `images[].image_url.url` data
 * URLs.
 * @param body - the parsed response JSON (wire boundary: untrusted).
 * @returns the outputs, empty when the response carries no media.
 */
export function outputsFromChatResponse(body: unknown): GenerationOutput[] {
  const message = (body as {
    choices?: { message?: { audio?: { data?: unknown; format?: unknown }; images?: unknown } }[]
  } | null | undefined)?.choices?.[0]?.message
  const outputs: GenerationOutput[] = []
  const audioData = message?.audio?.data
  if (typeof audioData === 'string' && audioData !== '') {
    const format = message?.audio?.format
    outputs.push({
      mediaType: typeof format === 'string' && format !== '' ? `audio/${format}` : 'application/octet-stream',
      data: audioData,
    })
  }
  const images = message?.images
  if (Array.isArray(images)) {
    for (const image of images) {
      const url = (image as { image_url?: { url?: unknown } } | null | undefined)?.image_url?.url
      if (typeof url !== 'string') continue
      const output = parseDataUrl(url)
      if (output !== undefined) outputs.push(output)
    }
  }
  return outputs
}

/**
 * Classify an HTTP failure status into the shared code union.
 * @param status - the response status.
 * @returns the provider-neutral code.
 */
export function classifyStatus(status: number): GenerationErrorCode {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 402) return 'QUOTA'
  if (status === 408) return 'TIMEOUT'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 400 && status < 500) return 'INVALID_REQUEST'
  return 'PROVIDER_ERROR'
}

/**
 * Classify an in-band provider failure message (the pi-ai images path returns
 * failures as text) into the shared code union.
 * @param message - the provider's failure text.
 * @returns the provider-neutral code; `PROVIDER_ERROR` when nothing matches.
 */
export function classifyFailureMessage(message: string): GenerationErrorCode {
  if (/\babort/i.test(message)) return 'ABORTED'
  if (/\btime[d]?\s?-?out\b|\btimeout\b/i.test(message)) return 'TIMEOUT'
  if (/\bunauthorized\b|\binvalid\s+api\s+key\b|\bforbidden\b|\b401\b|\b403\b/i.test(message)) return 'AUTH'
  if (/\binsufficient\b|\bcredits?\b|\bquota\b|\b402\b/i.test(message)) return 'QUOTA'
  if (/\brate\s?-?limit/i.test(message) || /\b429\b/.test(message)) return 'RATE_LIMIT'
  return 'PROVIDER_ERROR'
}

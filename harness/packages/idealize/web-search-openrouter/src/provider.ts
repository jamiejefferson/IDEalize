/**
 * `OpenRouterSearchProvider`: a `WebSearchProvider` over OpenRouter's chat
 * completions endpoint with the `web` plugin attached. One request asks a model
 * to answer the query from a live web search; the assistant text becomes
 * `content` and every `url_citation` annotation becomes a source. The key is
 * resolved per search from the credential store, so a key stored through the
 * app's Services panel is used without a restart.
 * @module @idealize/web-search-openrouter/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { OpenRouterAnnotation, OpenRouterError, OpenRouterSearchRequest, OpenRouterSearchResponse } from './types.ts'

/** Stable id this provider registers under; the same id as the chat route, so one key serves both. */
export const OPENROUTER_PROVIDER_ID = 'openrouter'

/** Default endpoint base; `/chat/completions` is the operation. */
export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

/** Default model that reads the search results and answers. */
export const OPENROUTER_DEFAULT_MODEL = 'deepseek/deepseek-v4-flash'

/** Default page count the web plugin may read when a request names no bound. */
export const OPENROUTER_DEFAULT_MAX_RESULTS = 5

/** Attribution headers OpenRouter shows on its usage pages. */
const ATTRIBUTION = { 'http-referer': 'https://idealize.projject.ai', 'x-title': 'IDEalize' }

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface OpenRouterSearchProviderOptions {
  /** Literal OpenRouter key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolves the key for one search; undefined means no key is stored. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv: CredentialRef
  /** Endpoint base; `/chat/completions` is appended. */
  baseURL: string
  /** Model that reads the search results and answers. */
  model: string
  /** Page count the web plugin may read when the request names no bound. */
  maxResults: number
}

/**
 * The instruction sent with the query. The model answers from what the web
 * plugin read; the answer text is returned as the result's `content`.
 * @param query - the model-facing search query.
 * @returns the user message content.
 */
export function searchPrompt(query: string): string {
  return `Search the web for: ${query}\n\nAnswer in a few plain sentences from what the search found, and name the pages you used.`
}

/**
 * Map one annotation to a source, or undefined when it is not a page citation
 * or names no URL.
 * @param annotation - one entry of the assistant message's `annotations[]`.
 * @returns the normalised source, or undefined.
 */
export function mapAnnotation(annotation: OpenRouterAnnotation): WebSearchSource | undefined {
  if (annotation.type !== 'url_citation') return undefined
  const citation = annotation.url_citation
  if (citation == null || citation.url == null || citation.url.length === 0) return undefined
  const title = citation.title ?? ''
  const snippet = (citation.content ?? '').trim()
  return {
    url: citation.url,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
  }
}

/**
 * Map a chat completions response to a search result: the first choice's text
 * as `content` when it has any, and its citations as sources, deduplicated by
 * URL in first-seen order.
 * @param response - the parsed response body.
 * @returns the normalised result; the seam owns `maxResults` truncation, so `truncated` is false.
 */
export function mapOpenRouterResponse(response: OpenRouterSearchResponse): WebSearchResult {
  const message = response.choices?.[0]?.message
  const content = (message?.content ?? '').trim()
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const annotation of message?.annotations ?? []) {
    const source = mapAnnotation(annotation)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  return { ...content.length > 0 ? { content } : {}, sources, truncated: false }
}

/** The OpenRouter-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class OpenRouterSearchProvider implements WebSearchProvider {
  readonly id = OPENROUTER_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the next search, read once per search so a
   *   settings change lands on the following request rather than mid-flight.
   */
  constructor(private readonly resolveOptions: () => OpenRouterSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && Number.isInteger(options.maxResults) && options.maxResults > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await resolveKey(options)
    const body: OpenRouterSearchRequest = {
      model: options.model,
      messages: [{ role: 'user', content: searchPrompt(request.query) }],
      plugins: [{ id: 'web', max_results: request.maxResults ?? options.maxResults }],
    }
    let response: Response
    try {
      response = await fetch(`${options.baseURL}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          ...ATTRIBUTION,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('OpenRouter search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`OpenRouter search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      let message = `OpenRouter error (HTTP ${response.status})`
      try {
        const parsed = await response.json() as OpenRouterError
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort mid-body is a cancellation, not a provider error; any other
        // unreadable error body only costs the richer message, the status
        // already captured above stands.
        if (isAbortError(error)) throw new WebError('OpenRouter search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      return mapOpenRouterResponse(await response.json() as OpenRouterSearchResponse)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('OpenRouter search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`OpenRouter returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/**
 * The key for one search: the literal when configured, else the credential
 * store's value. Nothing stored is a provider error naming the reference.
 * @param options - this search's options.
 * @returns the key.
 */
async function resolveKey(options: OpenRouterSearchProviderOptions): Promise<string> {
  if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
  let resolved: string | undefined
  try {
    resolved = await options.resolveApiKey?.()
  } catch (error: unknown) {
    throw new WebError(`OpenRouter search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (resolved !== undefined && resolved.length > 0) return resolved
  throw new WebError(
    `OpenRouter search has no API key for "${options.apiKeyEnv}"; connect OpenRouter in Brains › Services`,
    'WEB_PROVIDER_ERROR',
  )
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

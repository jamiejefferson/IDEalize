/**
 * Wire types for OpenRouter's chat completions endpoint when the `web` plugin
 * is attached (`POST https://openrouter.ai/api/v1/chat/completions`). Types
 * only, no runtime code. The plugin searches before the model answers and
 * returns what it read as `url_citation` annotations on the assistant message.
 *
 * @module @idealize/web-search-openrouter/types
 */

/** Request body sent to the chat completions endpoint. */
export interface OpenRouterSearchRequest {
  model: string
  messages: { role: 'user'; content: string }[]
  /** The web plugin and the number of pages it may read. */
  plugins: { id: 'web'; max_results: number }[]
}

/** One page the web plugin read, attached to the assistant message. */
export interface OpenRouterUrlCitation {
  url?: string | null
  title?: string | null
  /** The excerpt the plugin read from the page. */
  content?: string | null
}

/** One annotation on the assistant message; only `url_citation` carries a page. */
export interface OpenRouterAnnotation {
  type?: string
  url_citation?: OpenRouterUrlCitation | null
}

/** The chat completions response envelope, reduced to what the provider reads. */
export interface OpenRouterSearchResponse {
  choices?: {
    message?: {
      content?: string | null
      annotations?: OpenRouterAnnotation[] | null
    } | null
  }[] | null
}

/** OpenRouter's error envelope (best effort; fields vary by failure). */
export interface OpenRouterError {
  error?: { message?: string } | string
  message?: string
}

# @idealize/web-search-openrouter

Web search through OpenRouter's `web` plugin, registered into `ctx.web` under the id `openrouter`. One chat completions request carries the query with the plugin attached; the plugin reads the pages, the model answers from them, and the provider returns the answer as `content` and every `url_citation` as a source. The key is the same `OPENROUTER_API_KEY` the chat route uses, resolved per search from the credential store, so the key a person connects in Brains › Services serves search at once. The IDEalize profile selects this provider (`web.searchProvider: openrouter`) and leaves the DeepSeek search provider out (JJ, 16 Sep 2026: "remove the reliance on a deep seek subscription").

## Configuration (`idealize-web-search-openrouter` row)

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | none | A literal key; prefer `apiKeyEnv` so no secret enters a configuration file. |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | The credential reference resolved for each search. |
| `baseURL` | `https://openrouter.ai/api/v1` | Endpoint base; `/chat/completions` is appended. |
| `model` | `deepseek/deepseek-v4-flash` | The model that reads the results and answers. |
| `maxResults` | `5` | Pages the plugin may read when the request names no bound; `dsh-tool-web` always names one. |

A search without a stored key fails as `WEB_PROVIDER_ERROR` naming the reference; an HTTP failure carries OpenRouter's message; a cancelled request fails as `WEB_ABORTED`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../../web/tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles and excerpts, its answer text as the result's `content`, or its exact `OpenRouter search aborted`, `OpenRouter search request failed: <error>`, `OpenRouter returned an unprocessable response body: <error>` and `OpenRouter search has no API key for "<ref>"` failures under the consumer's error wrapper. The prompt this provider sends to OpenRouter (`searchPrompt`) never enters the session.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Citations depend on the model.** A model that answers without citing returns `content` and no sources; the seam then shows the answer alone.
- **No settings section.** Unlike the DeepSeek provider, the model and endpoint change only through the profile, not the hot-reloaded settings document.

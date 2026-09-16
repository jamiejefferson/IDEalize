/**
 * `@idealize/web-search-openrouter`: registers an OpenRouter-backed
 * `WebSearchProvider` with `ctx.web`, so the one OpenRouter key an IDEalize
 * user connects also serves web search (JJ, 16 Sep 2026: "remove the reliance
 * on a deep seek subscription"). A function plugin: it registers into the seam
 * owned by `@deepseek-ai/dsh-web`, exactly as the Exa and Perplexity providers do.
 *
 * @module @idealize/web-search-openrouter
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MAX_RESULTS,
  OPENROUTER_DEFAULT_MODEL,
  OpenRouterSearchProvider,
} from './provider.ts'
import type { OpenRouterSearchProviderOptions } from './provider.ts'

export {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MAX_RESULTS,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  OpenRouterSearchProvider,
  mapAnnotation,
  mapOpenRouterResponse,
  searchPrompt,
} from './provider.ts'
export type { OpenRouterSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-openrouter'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'OPENROUTER_API_KEY'

/** Plugin config (all optional; `apply` fills credential and constant defaults). */
export interface Config {
  /** Literal OpenRouter key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `OPENROUTER_API_KEY`, the chat route's key. */
  apiKeyEnv?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Model that reads the search results and answers. Defaults to `deepseek/deepseek-v4-flash`. */
  model?: string
  /** Page count the web plugin may read when a request names no bound. Defaults to 5. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(OPENROUTER_DEFAULT_BASE_URL),
  model: z.string().default(OPENROUTER_DEFAULT_MODEL),
  maxResults: z.number().step(1).min(1).default(OPENROUTER_DEFAULT_MAX_RESULTS),
})

/**
 * Project the config into the options one search runs with. The key resolves
 * through the credential seam when it is mounted, else the launch environment;
 * every other field falls back to the package constant when the config, read
 * outside the schema, names none.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the plugin config.
 * @returns options for one search.
 */
export function resolveOptions(ctx: Context, config: Config): OpenRouterSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literal = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return {
    ...literal === undefined ? {} : { apiKey: literal },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? OPENROUTER_DEFAULT_BASE_URL,
    model: config.model ?? OPENROUTER_DEFAULT_MODEL,
    maxResults: config.maxResults ?? OPENROUTER_DEFAULT_MAX_RESULTS,
  }
}

/**
 * Register the OpenRouter search provider with `ctx.web`.
 * @param ctx - plugin context carrying the web seam.
 * @param config - the plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new OpenRouterSearchProvider(() => resolveOptions(ctx, config)))
}

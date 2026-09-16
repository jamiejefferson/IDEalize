/**
 * `@idealize/services` — one list of every service the app can connect, and
 * one way to connect them.
 *
 * A person adding fal.ai or Anthropic holds two facts: the company's name and
 * an API key. They do not hold an endpoint, a wire protocol or a route id, and
 * the surface that asks for those is the reason adding a service has been hard.
 * This plugin serves the list and stores the key, reading what a service is
 * called and what it makes from the registries that already know — the LLM
 * configurable-provider directory for chat, `ctx.generation` for images, video
 * and sound — so a service the app gains appears here with no entry to write.
 * @module @idealize/services
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@idealize/generate'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installServicesRoute, chatKeyEnv, LLM_NS } from './routes.ts'
import { registerMediaServices } from './registrar.ts'
import { applyEndpoints, MEDIA_SERVICES } from './media-directory.ts'
import type { ChatCandidate, MediaCandidate } from './join.ts'

/** The OAuth face `@idealize/provider-pack` publishes, when it is composed. */
interface OAuthFace {
  status?: () => Promise<{ id: string; stored: boolean; keyless?: boolean }[]>
}

export * from './directory.ts'
export * from './join.ts'
export * from './media-directory.ts'
export { chatKeyEnv, installServicesRoute, KEYS_FILE_FORMAT } from './routes.ts'
export type { ServicesRuntime } from './routes.ts'
export { registerMediaServices } from './registrar.ts'
export { SHIPPED_PRICE_CURRENCY, shippedTokenPrices } from './shipped-prices.ts'
export type { ShippedTokenPrice } from './shipped-prices.ts'
export type { RegistrarOptions } from './registrar.ts'
export { createQueueBackend } from './adapters/queue.ts'
export type { QueueBackend, QueueBackendOptions, ServiceAuth } from './adapters/queue.ts'
export { createImagesBackend } from './adapters/images.ts'
export type { ImagesBackend, ImagesBackendOptions } from './adapters/images.ts'
export { readCatalogCache, readInputSchemaCache, writeCatalogCache, writeInputSchemaCache } from './adapters/catalog-cache.ts'
export {
  coerceBody, coerceLiteral, enumRetryValues, EXCLUDED_INPUTS, humaniseLabel, inputFieldsFrom, literalsFromMessage, parseInputSchema,
} from './adapters/input-schema.ts'
export type { InputProperty, InputPropertyType, InputSchema } from './adapters/input-schema.ts'

/** Where one media service is reached, replacing the directory's addresses. */
export interface MediaEndpointOverride {
  /** Catalogue API origin including its version segment, no trailing slash. */
  baseUrl?: string
  /** Queue API origin, no trailing slash. Queue services only. */
  queueUrl?: string
}

/** Plugin config. */
export interface Config {
  /** Whole-generation timeout in milliseconds, enqueue to last download. */
  requestTimeoutMs?: number
  /** Milliseconds between queue status polls. */
  pollIntervalMs?: number
  /** Minutes between catalogue refreshes; 0 refreshes once on mount only. */
  catalogueRefreshMinutes?: number
  /**
   * Where a media service is reached, keyed by its directory id. A deployment
   * behind a proxy or on a regional endpoint answers the same wire shapes at a
   * different host, which is what the retired per-service plugins offered as
   * `baseUrl` and `queueUrl`. An id absent here is reached at the address in
   * the directory; an id absent from the directory is refused at load.
   */
  mediaEndpoints?: Record<string, MediaEndpointOverride>
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  requestTimeoutMs: z.natural().default(600_000),
  pollIntervalMs: z.natural().default(2_000),
  catalogueRefreshMinutes: z.number().min(0).default(60),
  mediaEndpoints: z.dict(z.object({
    baseUrl: z.string(),
    queueUrl: z.string(),
  } satisfies Record<keyof MediaEndpointOverride, z<string>>)).default({}),
})

/** Cordis plugin name. */
export const name = 'idealize-services'
/** Required services. */
export const inject = ['llm', 'generation', 'settings', 'credentials', 'webServer']

/** One chat provider profile as the pi-ai settings section records it. */
interface ChatProfile {
  apiKeyEnv?: unknown
}

/**
 * Register every media service's generation backend, serve the services list,
 * and store the keys it collects.
 * @param ctx - the host plugin context.
 * @param config - generation timings and catalogue refresh cadence.
 */
export function apply(ctx: Context, config: Config): void {
  registerMediaServices(ctx, {
    home: resolveDshHome(),
    timeoutMs: config.requestTimeoutMs ?? 600_000,
    pollIntervalMs: config.pollIntervalMs ?? 2_000,
    refreshMinutes: config.catalogueRefreshMinutes ?? 60,
    rows: applyEndpoints(MEDIA_SERVICES, config.mediaEndpoints ?? {}),
  })

  const profiles = (): Record<string, ChatProfile> => {
    const section = ctx.settings.get(LLM_NS) as { providers?: Record<string, ChatProfile> } | undefined
    return section?.providers ?? {}
  }

  const chat = async (): Promise<ChatCandidate[]> => {
    const stored = profiles()
    const oauth = ctx.get('idealizeOAuth') as OAuthFace | undefined
    const offers = oauth?.status === undefined ? [] : await oauth.status().catch(() => [])
    const offered = new Set(offers.map(row => row.id))
    // Sign-in is the only auth these routes take: a key stored for one can
    // never serve it, and one did (14 Sep 2026: a stray value under
    // OPENAI_CODEX_API_KEY was sent as a ChatGPT token and every turn on the
    // route failed "Failed to extract accountId from token").
    const keyless = new Set(offers.filter(row => row.keyless === true).map(row => row.id))
    const rows = await Promise.all(ctx.llm.listConfigurableProviders().map(async (entry) => {
      // The route may already name a credential; a route yet to be configured
      // resolves the name this plugin would store, so a key pasted through the
      // models page shows as connected here too.
      const recorded = stored[entry.provider]?.apiKeyEnv
      const env = typeof recorded === 'string' ? recorded : chatKeyEnv(entry.provider)
      const connected = (await ctx.credentials.resolve(credentialRef(env)).catch(() => undefined)) !== undefined
      return { provider: entry.provider, displayName: entry.displayName, connected, offered: offered.has(entry.provider) }
    }))
    // A route reached by signing in is connected under Subscriptions, where
    // signing in happens; listing it here as well would show one account twice
    // and offer a key it does not take. A route holding a key belongs here
    // whether or not sign-in is also on offer; one whose only auth is sign-in
    // is marked, so the route refuses a new key and lets the stray one go.
    return rows.filter(row => row.connected || !row.offered)
      .map(({ provider, displayName, connected }) => ({
        provider,
        displayName,
        connected,
        ...keyless.has(provider) ? { signIn: true } : {},
      }))
  }

  // What a service makes comes from its descriptors, not from its catalogue: a
  // service that has not fetched its models yet — a first run, an offline
  // start — still makes what it makes, and the Add list has to say so.
  const media = (): MediaCandidate[] => ctx.generation.credentials().map(row => ({
    backend: row.backend,
    displayName: row.displayName,
    env: row.env,
    connected: row.connected,
    artefacts: [...row.artefacts],
  }))

  const recordChatKeyEnv = async (provider: string, env: string): Promise<void> => {
    const stored = profiles()
    if (typeof stored[provider]?.apiKeyEnv === 'string') return
    await ctx.settings.update(LLM_NS, {
      providers: { ...stored, [provider]: { ...stored[provider], apiKeyEnv: env } },
    })
  }

  const forgetChatKeyEnv = async (provider: string, env: string): Promise<void> => {
    const stored = profiles()
    const profile = stored[provider]
    if (profile?.apiKeyEnv !== env) return
    const { apiKeyEnv: _forgotten, ...rest } = profile
    await ctx.settings.update(LLM_NS, { providers: { ...stored, [provider]: rest } })
  }

  installServicesRoute(ctx, {
    chat,
    media,
    recordChatKeyEnv,
    forgetChatKeyEnv,
    refreshBackend: id => ctx.generation.refreshBackend(id),
  })
}

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
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { chatProfileOf, recordedKeyEnv, type ChatRoute } from './chat-profile.ts'
import { installServicesRoute, chatKeyEnv } from './routes.ts'
import { registerMediaServices } from './registrar.ts'
import { applyEndpoints, MEDIA_SERVICES } from './media-directory.ts'
import { GATEWAY_PREFIX, installGateway } from './gateway.ts'
import type { ChatCandidate, MediaCandidate } from './join.ts'

/** The OAuth face `@idealize/provider-pack` publishes, when it is composed. */
interface OAuthFace {
  status?: () => Promise<{ id: string; stored: boolean; keyless?: boolean }[]>
}

export * from './chat-profile.ts'
export * from './directory.ts'
export * from './join.ts'
export * from './media-directory.ts'
export { chatKeyEnv, installServicesRoute, KEYS_FILE_FORMAT } from './routes.ts'
export type { ServicesRuntime } from './routes.ts'
export { registerMediaRow, registerMediaServices } from './registrar.ts'
export { chatRoutesFor, gatewayAddress, gatewayDecisionsUrl, GATEWAY_KEY_ENV, GATEWAY_PREFIX, GATEWAY_URL_ENV, mediaRowsFor, readMe, statusOf } from './gateway.ts'
export type { GatewayFace, GatewayMe, GatewayService, GatewayStatus } from './gateway.ts'
export { SHIPPED_PRICE_CURRENCY, shippedTokenPrices } from './shipped-prices.ts'
export { chatFactKey, chatFacts, CONTROL_IDS, controlsFromInputs, GOOD_AT_TERMS, mediaFacts, withModelFacts } from './model-facts.ts'
export type { ControlInput, FactKind, GoodAtTerm, ModelFacts, ShippedFacts } from './model-facts.ts'
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



/**
 * Register every media service's generation backend, serve the services list,
 * and store the keys it collects.
 * @param ctx - the host plugin context.
 * @param config - generation timings and catalogue refresh cadence.
 */
export function apply(ctx: Context, config: Config): void {
  const registrar = {
    home: resolveDshHome(),
    timeoutMs: config.requestTimeoutMs ?? 600_000,
    pollIntervalMs: config.pollIntervalMs ?? 2_000,
    refreshMinutes: config.catalogueRefreshMinutes ?? 60,
  }
  registerMediaServices(ctx, { ...registrar, rows: applyEndpoints(MEDIA_SERVICES, config.mediaEndpoints ?? {}) })

  // The key gateway adds its own routes and backends; they are listed under its own row, not as services.
  const gateway = installGateway(ctx, { home: registrar.home, registrar })
  ctx.effect(() => ctx.provide('idealizeGateway', gateway))

  // A chat route's profile lives where the adapter that owns the route keeps
  // it, which the directory entry names (see ./chat-profile.ts).
  const read = (ns: Parameters<typeof ctx.settings.get>[0]): unknown => ctx.settings.get(ns)
  const routeOf = (provider: string): ChatRoute | undefined =>
    ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)
  /** The credential name a route reads: the one its profile records (or defaults), else the one this plugin derives. */
  const chatEnv = (provider: string): string => {
    const route = routeOf(provider)
    return (route === undefined ? undefined : recordedKeyEnv(read, route)) ?? chatKeyEnv(provider)
  }

  const chat = async (): Promise<ChatCandidate[]> => {
    const oauth = ctx.get('idealizeOAuth') as OAuthFace | undefined
    const offers = oauth?.status === undefined ? [] : await oauth.status().catch(() => [])
    // Sign-in is the only auth these routes take: a key stored for one can
    // never serve it, and one did (14 Sep 2026: a stray value under
    // OPENAI_CODEX_API_KEY was sent as a ChatGPT token and every turn on the
    // route failed "Failed to extract accountId from token").
    const keyless = new Set(offers.filter(row => row.keyless === true).map(row => row.id))
    const routes = ctx.llm.listConfigurableProviders().filter(entry => !entry.provider.startsWith(GATEWAY_PREFIX))
    const rows = await Promise.all(routes.map(async (entry) => {
      // The route may already name a credential; a route yet to be configured
      // resolves the name this plugin would store, so a key pasted through the
      // models page shows as connected here too.
      const env = chatEnv(entry.provider)
      const connected = (await ctx.credentials.resolve(credentialRef(env)).catch(() => undefined)) !== undefined
      return { provider: entry.provider, displayName: entry.displayName, connected, env }
    }))
    // A route whose only auth is sign-in is connected under Subscriptions and
    // takes no key, so it is listed only to let a stray key go, and marked so
    // the route refuses a new one. A route that takes a key is always listed,
    // even when sign-in is also on offer: OpenRouter takes both, and hiding it
    // left someone holding a key with nowhere to paste it (JJ, 4 Nov 2026).
    return rows.filter(row => row.connected || !keyless.has(row.provider))
      .map(({ provider, displayName, connected, env }) => ({
        provider,
        displayName,
        connected,
        env,
        ...keyless.has(provider) ? { signIn: true } : {},
      }))
  }

  // What a service makes comes from its descriptors, not from its catalogue: a
  // service that has not fetched its models yet — a first run, an offline
  // start — still makes what it makes, and the Add list has to say so.
  const media = (): MediaCandidate[] => ctx.generation.credentials().filter(row => !row.backend.startsWith(GATEWAY_PREFIX)).map(row => ({
    backend: row.backend,
    displayName: row.displayName,
    env: row.env,
    connected: row.connected,
    artefacts: [...row.artefacts],
  }))

  const recordChatKeyEnv = async (provider: string, env: string): Promise<void> => {
    const route = routeOf(provider)
    if (route === undefined || recordedKeyEnv(read, route) !== undefined) return
    await ctx.settings.mutate(settingsNamespace(route.settingsNs), [
      { op: 'set', path: [...route.settingsPath, 'apiKeyEnv'], value: env },
    ])
  }

  const forgetChatKeyEnv = async (provider: string, env: string): Promise<void> => {
    const route = routeOf(provider)
    if (route === undefined || chatProfileOf(read, route)?.['apiKeyEnv'] !== env) return
    await ctx.settings.mutate(settingsNamespace(route.settingsNs), [
      { op: 'unset', path: [...route.settingsPath, 'apiKeyEnv'] },
    ])
  }

  // A key pasted into OpenRouter's old Images row reached the credential store
  // but never switched chat on, so the person was told to sign in while holding
  // a stored key (JJ, 4 Nov 2026). Their one row now does both; this finishes
  // the job for a key stored before it did.
  const switchOnSharedKeys = async (): Promise<void> => {
    for (const row of media()) {
      if (routeOf(row.backend) === undefined || chatEnv(row.backend) !== row.env) continue
      if ((await ctx.credentials.resolve(credentialRef(row.env)).catch(() => undefined)) === undefined) continue
      await recordChatKeyEnv(row.backend, row.env)
    }
  }
  void switchOnSharedKeys().catch((error: unknown) => {
    ctx.logger.warn(`idealize-services: a stored shared key could not be switched on: ${error instanceof Error ? error.message : String(error)}`)
  })

  installServicesRoute(ctx, {
    chat,
    media,
    chatEnv,
    recordChatKeyEnv,
    forgetChatKeyEnv,
    refreshBackend: id => ctx.generation.refreshBackend(id),
    connectGateway: (address, key) => gateway.connect(address, key),
  })
}

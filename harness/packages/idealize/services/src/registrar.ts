/**
 * Registers one generation backend per media service in the directory.
 *
 * Before this, each service was its own plugin row in the profile, so the set
 * of services the app could offer was fixed at composition time and a new one
 * meant a new package. Registration now comes from {@link MEDIA_SERVICES}:
 * every row gets a backend, keyed or not, because an unkeyed service still
 * has to appear in the Add list and still has to tell the space launcher what
 * it makes. Whether the key resolves is what `describe()` reports, and the
 * connect route's `refreshBackend` is what re-reads it, so pasting a key makes
 * the models selectable without a restart.
 * @module @idealize/services/registrar
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@idealize/generate'
import type { GenerationBackend, GenModelInfo } from '@idealize/generate'
import { createImagesBackend } from './adapters/images.ts'
import { createQueueBackend } from './adapters/queue.ts'
import { readCatalogCache, readInputSchemaCache, writeCatalogCache, writeInputSchemaCache } from './adapters/catalog-cache.ts'
import type { InputSchema } from './adapters/input-schema.ts'
import { MEDIA_SERVICES } from './media-directory.ts'
import type { MediaServiceRow } from './media-directory.ts'

/** What the registrar needs from its host, so the caller owns the filesystem and the clock. */
export interface RegistrarOptions {
  /** Harness home, where each service's catalogue cache lives. */
  home: string
  /** Whole-generation timeout in milliseconds, enqueue to last download. */
  timeoutMs: number
  /** Milliseconds between queue status polls. */
  pollIntervalMs: number
  /** Minutes between catalogue refreshes; 0 refreshes once on mount only. */
  refreshMinutes: number
  /** The rows to register; defaults to the whole directory. */
  rows?: readonly MediaServiceRow[]
  /** Fetch used by every adapter; injectable for keyless tests. */
  fetchImpl?: typeof fetch
}

/** Build one backend from one directory row. */
function backendFor(
  ctx: Context, row: MediaServiceRow, options: RegistrarOptions,
): GenerationBackend & { refresh(): Promise<void> } {
  const ref = credentialRef(row.apiKeyEnv)
  const shared = {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl.replace(/\/+$/, ''),
    timeoutMs: options.timeoutMs,
    credential: { displayName: row.name, env: row.apiKeyEnv },
    resolveApiKey: async () => (await ctx.credentials.resolve(ref))?.value,
    cached: readCatalogCache(options.home, row.id),
    onCatalog: (models: readonly GenModelInfo[]) => { writeCatalogCache(options.home, row.id, models) },
    ...options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl },
  }
  if (row.adapter === 'images') return createImagesBackend(shared)
  if (row.queueUrl === undefined || row.categories === undefined || row.auth === undefined) {
    // A queue row without its endpoints cannot be talked to at all, and a
    // backend that fails on first use would say so far from the cause.
    throw new Error(`idealize-services: the queue service "${row.id}" is missing its queueUrl, categories or auth`)
  }
  return createQueueBackend({
    ...shared,
    queueUrl: row.queueUrl.replace(/\/+$/, ''),
    categories: row.categories,
    auth: row.auth,
    pollIntervalMs: options.pollIntervalMs,
    ...row.inputSchemaUrl === undefined ? {} : { inputSchemaUrl: row.inputSchemaUrl },
    cachedInputs: (endpoint: string) => readInputSchemaCache(options.home, row.id, endpoint),
    onInputSchema: (endpoint: string, schema: InputSchema) => { writeInputSchemaCache(options.home, row.id, endpoint, schema) },
  })
}

/**
 * Register every media service's backend, and keep their catalogues fresh.
 * @param ctx - a context carrying `generation`, `credentials` and a logger.
 * @param options - home, timings, the rows to register, and a test fetch.
 */
export function registerMediaServices(ctx: Context, options: RegistrarOptions): void {
  for (const row of options.rows ?? MEDIA_SERVICES) {
    const backend = backendFor(ctx, row, options)
    ctx.effect(() => ctx.generation.register(backend), `idealize-services: ${row.id} backend`)
    const refresh = (): void => {
      backend.refresh().catch((error: unknown) => {
        ctx.logger.warn(`idealize-services: ${row.id} catalogue refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    ctx.effect(() => {
      refresh()
      if (options.refreshMinutes === 0) return () => {}
      const timer = setInterval(refresh, options.refreshMinutes * 60_000)
      return () => { clearInterval(timer) }
    }, `idealize-services: ${row.id} catalogue refresh`)
  }
}

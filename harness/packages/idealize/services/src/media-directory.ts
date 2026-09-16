/**
 * The media services this app knows how to talk to, as data.
 *
 * Before this table each service was a package: its endpoints, its categories
 * and the scheme its key is sent under were constants in code, so adding a
 * second service that works the same way meant writing and mounting another
 * plugin. A row here is enough, because the wire shapes the rows point at —
 * {@link createQueueBackend} and {@link createImagesBackend} — are the only
 * two the app has evidence for. A service that answers differently needs a new
 * adapter, and that is the honest cost: the table removes the per-service
 * package, not the per-protocol one.
 * @module @idealize/services/media-directory
 */

import type { QueueCategory } from './adapters/queue-catalog.ts'
import type { ServiceAuth } from './adapters/queue.ts'

/** Which wire shape a service answers on. */
export type MediaAdapter = 'queue' | 'images'

/** One media service the app can register a generation backend for. */
export interface MediaServiceRow {
  /** Registry id — the `provider` half of stored model choices, and the credential's owner. */
  id: string
  /** The service's own name for itself, shown to the person and used in its messages. */
  name: string
  /** The wire shape it answers on. */
  adapter: MediaAdapter
  /** Catalogue API origin including its version segment, no trailing slash. */
  baseUrl: string
  /** Credential environment name the key is stored under. */
  apiKeyEnv: string
  /** Queue API origin, no trailing slash. `queue` rows only. */
  queueUrl?: string
  /** The catalogue categories to list. `queue` rows only. */
  categories?: readonly QueueCategory[]
  /** How the key is presented on the wire. `queue` rows only. */
  auth?: ServiceAuth
  /**
   * Where the service publishes one endpoint's OpenAPI document, with `{id}`
   * standing for the endpoint id. `queue` rows only; absent when the service
   * publishes no per-endpoint schema, in which case no inputs are offered and
   * the body is sent as the seam built it.
   */
  inputSchemaUrl?: string
}

/**
 * The known media services.
 *
 * fal's `Key ` prefix is the reason `auth` is data: sending a bare bearer
 * token there answers 401, and that was a special case in code until this row
 * existed.
 */
export const MEDIA_SERVICES: readonly MediaServiceRow[] = [
  {
    id: 'fal',
    name: 'fal.ai',
    adapter: 'queue',
    baseUrl: 'https://api.fal.ai/v1',
    queueUrl: 'https://queue.fal.run',
    apiKeyEnv: 'FAL_KEY',
    auth: { header: 'authorization', prefix: 'Key ' },
    inputSchemaUrl: 'https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={id}',
    categories: [
      { category: 'text-to-image', artefact: 'image', inputModalities: ['text'] },
      { category: 'text-to-video', artefact: 'video', inputModalities: ['text'] },
      { category: 'text-to-audio', artefact: 'audio', inputModalities: ['text'] },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    adapter: 'images',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
]

/**
 * Apply a deployment's endpoint overrides to the directory.
 *
 * A service named here that the directory does not carry is a misconfiguration
 * with no silent reading: it would leave the person's override doing nothing
 * while the app talked to the address they meant to replace.
 * @param rows - the directory rows.
 * @param overrides - endpoints by service id, from plugin config.
 * @returns the rows with their addresses replaced where an override names them.
 * @throws when an override names a service the directory does not carry.
 */
export function applyEndpoints(
  rows: readonly MediaServiceRow[],
  overrides: Readonly<Record<string, { baseUrl?: string; queueUrl?: string }>>,
): readonly MediaServiceRow[] {
  for (const id of Object.keys(overrides)) {
    if (!rows.some(row => row.id === id)) {
      throw new Error(`idealize-services: mediaEndpoints names "${id}", which is not a known media service`)
    }
  }
  return rows.map((row) => {
    const override = overrides[row.id]
    if (override === undefined) return row
    return {
      ...row,
      ...override.baseUrl === undefined ? {} : { baseUrl: override.baseUrl },
      ...override.queueUrl === undefined ? {} : { queueUrl: override.queueUrl },
    }
  })
}

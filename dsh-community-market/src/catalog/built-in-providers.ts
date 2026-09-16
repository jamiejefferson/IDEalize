import { randomUUID } from 'node:crypto'
import type { MarketSourceDescriptionKey } from '../api-types.js'
import type { LocalSourceRecord } from '../contracts/types.js'
import { DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_ENDPOINT, DSH_1024STORE_KEY, DSH_1024STORE_PROVIDER_ID } from '../adapters/dsh-1024store.js'
import { DSHFIND_ADAPTER_ID, DSHFIND_ENDPOINT, DSHFIND_KEY, DSHFIND_PROVIDER_ID } from '../adapters/dshfind.js'

export interface BuiltInProviderDefinition {
  readonly key: string
  readonly name: string
  /** Client locale key for the provider's one-line description; the text lives in the market dictionaries. */
  readonly descriptionKey: MarketSourceDescriptionKey
  readonly providerId: string
  readonly adapterId: string
  readonly endpoint: string
  readonly attribution: {
    readonly name: string
    readonly url: string
    readonly notice?: string
  }
  readonly partnership: boolean
  /** Selected when the built-in sources are first seeded into an empty registry. */
  readonly defaultSelected: boolean
}

export const BUILT_IN_PROVIDERS: readonly BuiltInProviderDefinition[] = [
  {
    key: DSH_1024STORE_KEY,
    name: 'DSH 1024Store',
    descriptionKey: 'partnerSourceDescription',
    providerId: DSH_1024STORE_PROVIDER_ID,
    adapterId: DSH_1024STORE_ADAPTER_ID,
    endpoint: DSH_1024STORE_ENDPOINT,
    attribution: {
      name: 'DSH 1024Store',
      url: 'https://deepseek1024.com',
      notice: 'Community catalog data provided by a cooperating provider.',
    },
    partnership: true,
    defaultSelected: true,
  },
  {
    key: DSHFIND_KEY,
    name: 'dshfind',
    descriptionKey: 'partnerSourceDescription',
    providerId: DSHFIND_PROVIDER_ID,
    adapterId: DSHFIND_ADAPTER_ID,
    endpoint: DSHFIND_ENDPOINT,
    attribution: {
      name: 'dshfind',
      url: 'https://dshfind.com',
      notice: 'Community catalog data provided by a cooperating provider.',
    },
    partnership: true,
    defaultSelected: false,
  },
]

/**
 * Source records for every built-in provider, in catalogue order, with the
 * default-selected provider enabled. Used once, when a registry is first read empty.
 * @returns fresh records with new ids.
 */
export function seedBuiltInSourceRecords(): readonly LocalSourceRecord[] {
  return BUILT_IN_PROVIDERS.map((provider, order) => ({
    sourceRecordId: randomUUID(),
    registrationKind: 'built-in',
    adapterId: provider.adapterId,
    providerId: provider.providerId,
    builtInProviderKey: provider.key,
    enabled: provider.defaultSelected,
    order,
  }))
}

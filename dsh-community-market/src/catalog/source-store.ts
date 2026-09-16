import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { MarketInstallReceipt } from '../api-types.js'
import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import { validateLocalSourceRecords } from '../contracts/validate.js'
import type { CatalogSourceStore, LocalSourceRecord } from '../contracts/types.js'
import { seedBuiltInSourceRecords } from './built-in-providers.js'

export interface MarketCatalogCache {
  readonly version: 1
  readonly sourceRecordId: string
  readonly locale: string
  readonly savedAt: string
  readonly snapshot: CatalogSnapshot
  readonly categories: readonly string[]
  readonly scannedAt: string
  readonly expiresAt: string
  readonly providerRevision?: string
}

export interface MarketSettingsDocument {
  readonly sources: readonly LocalSourceRecord[]
  /**
   * Set once the built-in partner sources have been offered to this registry,
   * by the first-read seed or by any save. An empty `sources` list with the
   * flag set is the user's own choice and is never reseeded.
   */
  readonly builtInSourcesSeeded?: boolean
  readonly installReceipts?: readonly MarketInstallReceipt[]
  readonly catalogCache?: MarketCatalogCache
}

/**
 * Reconcile legacy multi-enabled settings into the single active-source model.
 * The first enabled record by user order wins. An all-disabled registry keeps
 * its explicit no-selection state.
 */
export function normalizeActiveSourceRecords(
  records: readonly LocalSourceRecord[],
): readonly LocalSourceRecord[] {
  const ordered = [...records].sort((left, right) => left.order - right.order)
  const activeSourceRecordId = ordered.find(record => record.enabled)?.sourceRecordId
  return ordered.map(record => ({
    ...record,
    enabled: record.sourceRecordId === activeSourceRecordId,
  }))
}

export class SettingsCatalogSourceStore implements CatalogSourceStore {
  constructor(private readonly scope: SettingsScope<MarketSettingsDocument>) {}

  /**
   * Read the registry. An empty registry that has never been offered the
   * built-in partner sources receives them on this read: every
   * `BUILT_IN_PROVIDERS` entry is added, the default-selected one enabled, and
   * the seed is persisted with `builtInSourcesSeeded`. Every save sets the
   * same flag, so a registry the user has emptied stays empty.
   * @returns validated records, one enabled at most.
   */
  async load(): Promise<readonly LocalSourceRecord[]> {
    const document = this.scope.get()
    if (document.sources.length === 0 && document.builtInSourcesSeeded !== true) {
      const seeded = seedBuiltInSourceRecords()
      validateLocalSourceRecords(seeded)
      await this.scope.update({ sources: seeded, builtInSourcesSeeded: true })
      return normalizeActiveSourceRecords(seeded)
    }
    const records = [...document.sources]
    validateLocalSourceRecords(records)
    return normalizeActiveSourceRecords(records)
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    await this.scope.update({ sources: normalized, builtInSourcesSeeded: true })
  }
}

export class MemoryCatalogSourceStore implements CatalogSourceStore {
  private records: readonly LocalSourceRecord[] = []

  async load(): Promise<readonly LocalSourceRecord[]> {
    return this.records
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    this.records = normalized.map(record => ({ ...record }))
  }
}

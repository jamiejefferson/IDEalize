import { readFileSync } from 'node:fs'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import {
  SettingsCatalogSourceStore,
  type MarketSettingsDocument,
} from '../src/catalog/source-store.js'
import type { CatalogSourceManifest, LocalSourceRecord } from '../src/contracts/index.js'
import { DSH_1024STORE_KEY } from '../src/adapters/dsh-1024store.js'
import { DSHFIND_KEY } from '../src/adapters/dshfind.js'

const manifest = JSON.parse(
  readFileSync(new URL('../docs/examples/catalog-source.example.json', import.meta.url), 'utf8'),
) as CatalogSourceManifest

const source: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'user-added',
  adapterId: 'market.standard-http-v1',
  providerId: 'org.example.community-catalog',
  manifestUrl: 'https://plugins.example.org/catalog-source.json',
  manifest,
  enabled: true,
  order: 0,
}

function scopeOver(initial: MarketSettingsDocument) {
  let document = initial
  const update = vi.fn(async (patch: Partial<MarketSettingsDocument>) => { document = { ...document, ...patch } })
  const scope = { get: () => document, update } as unknown as SettingsScope<MarketSettingsDocument>
  return { scope, update, read: () => document }
}

describe('settings-backed catalog source store', () => {
  it('seeds both partner sources into a never-offered empty registry, 1024Store selected', async () => {
    const { scope, update, read } = scopeOver({ sources: [] })
    const store = new SettingsCatalogSourceStore(scope)

    const records = await store.load()

    expect(records).toEqual([
      expect.objectContaining({ registrationKind: 'built-in', builtInProviderKey: DSH_1024STORE_KEY, enabled: true, order: 0 }),
      expect.objectContaining({ registrationKind: 'built-in', builtInProviderKey: DSHFIND_KEY, enabled: false, order: 1 }),
    ])
    expect(update).toHaveBeenCalledOnce()
    expect(read()).toEqual({ sources: records, builtInSourcesSeeded: true })
    // A second read serves the persisted seed without writing again.
    await expect(store.load()).resolves.toEqual(records)
    expect(update).toHaveBeenCalledOnce()
  })

  it('leaves an emptied registry empty once the sources have been offered', async () => {
    const { scope, update } = scopeOver({ sources: [], builtInSourcesSeeded: true })

    await expect(new SettingsCatalogSourceStore(scope).load()).resolves.toEqual([])
    expect(update).not.toHaveBeenCalled()
  })

  it('does not touch a registry that already holds sources', async () => {
    const { scope, update } = scopeOver({ sources: [source] })

    await expect(new SettingsCatalogSourceStore(scope).load()).resolves.toEqual([source])
    expect(update).not.toHaveBeenCalled()
  })

  it('marks the registry as offered on every save, so removing every source sticks', async () => {
    const { scope, read } = scopeOver({ sources: [source] })
    const store = new SettingsCatalogSourceStore(scope)

    await store.save([])

    expect(read()).toEqual({ sources: [], builtInSourcesSeeded: true })
    await expect(store.load()).resolves.toEqual([])
  })

  it('persists validated source records through the settings scope', async () => {
    let document: MarketSettingsDocument = { sources: [] }
    const update = vi.fn(async (next: MarketSettingsDocument) => { document = next })
    const scope = {
      get: () => document,
      update,
    } as unknown as SettingsScope<MarketSettingsDocument>
    const store = new SettingsCatalogSourceStore(scope)

    await store.save([source])

    expect(update).toHaveBeenCalledWith({ sources: [source], builtInSourcesSeeded: true })
    await expect(store.load()).resolves.toEqual([source])
  })

  it('normalizes legacy multi-enabled settings to one selected source', async () => {
    const secondSource: LocalSourceRecord = {
      ...source,
      sourceRecordId: '028f1f77-a5c4-7b73-a9ae-0242ac120003',
      order: 1,
    }
    let document: MarketSettingsDocument = { sources: [] }
    const update = vi.fn(async (next: MarketSettingsDocument) => { document = next })
    const scope = {
      get: () => document,
      update,
    } as unknown as SettingsScope<MarketSettingsDocument>
    const store = new SettingsCatalogSourceStore(scope)

    await store.save([source, secondSource])

    expect(update).toHaveBeenCalledWith({
      sources: [source, { ...secondSource, enabled: false }],
      builtInSourcesSeeded: true,
    })
    await expect(store.load()).resolves.toEqual([
      source,
      { ...secondSource, enabled: false },
    ])
  })
})

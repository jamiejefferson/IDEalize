/**
 * AC-04: every first-party V1 capability loads through the plugin registry.
 *
 * The shipped `cordis.patch.yml` is the manifest: one row per capability, each
 * naming a versioned workspace package the Loader resolves. These assertions
 * read the real file and the real package manifests, so a capability wired in
 * by any route other than a row fails here.
 */

import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import bundleManifest from '../package.json' with { type: 'json' }

const REPO_ROOT = resolve(import.meta.dirname, '../../../..')
const PATCH = resolve(import.meta.dirname, '../cordis.patch.yml')

/**
 * IDEalize host plugins that deliberately carry no row, each with the reason.
 * An entry here is a claim the reviewer can check, not a way to skip AC-04.
 */
const UNCOMPOSED: ReadonlyMap<string, string> = new Map([
  ['@idealize/gen-fixture', 'a keyless test backend; composing it in the shipped profile would offer users a fake model'],
])

/** One row of the patch, as far as the manifest expectation reads it. */
interface PatchRow {
  id?: string
  name?: string
  insert?: { id?: string; name?: string }[]
}

/** Every plugin row the patch inserts, in file order. */
function insertedRows(): { id: string; name: string }[] {
  const rows = load(readFileSync(PATCH, 'utf8')) as PatchRow[]
  return rows.flatMap(row => row.insert ?? [])
    .filter((entry): entry is { id: string; name: string } =>
      typeof entry.id === 'string' && typeof entry.name === 'string')
}

/** Every `@idealize/*` package that exports a Cordis host plugin from `src/index.ts`. */
function hostPlugins(): string[] {
  const names: string[] = []
  for (const manifest of globSync('packages/idealize/*/package.json', { cwd: REPO_ROOT })) {
    const dir = dirname(resolve(REPO_ROOT, manifest))
    const json = JSON.parse(readFileSync(resolve(REPO_ROOT, manifest), 'utf8')) as { name: string }
    let source: string
    try {
      source = readFileSync(resolve(dir, 'src/index.ts'), 'utf8')
    } catch {
      // A package with no host entry (client-only) contributes no host row.
      continue
    }
    const plugin = /export function apply\(/.test(source)
      || /export const apply\b/.test(source)
      || /export default class/.test(source)
    if (plugin) names.push(json.name)
  }
  return names.sort()
}

describe('AC-04: every first-party capability loads through the plugin registry', () => {
  it('composes each IDEalize host plugin as a patch row, or names why it has none', () => {
    const composed = new Set(insertedRows().map(row => row.name))
    const missing = hostPlugins().filter(name => !composed.has(name) && !UNCOMPOSED.has(name))

    expect(missing).toEqual([])
  })

  it('keeps the exemptions honest: each one is a real package that no row composes', () => {
    const composed = new Set(insertedRows().map(row => row.name))
    for (const [name, reason] of UNCOMPOSED) {
      expect(reason.length).toBeGreaterThan(0)
      expect(hostPlugins()).toContain(name)
      expect(composed.has(name)).toBe(false)
    }
  })

  it('resolves every row to a versioned workspace package', () => {
    const versions = new Map(
      globSync('packages/*/*/package.json', { cwd: REPO_ROOT }).map((manifest) => {
        const json = JSON.parse(readFileSync(resolve(REPO_ROOT, manifest), 'utf8')) as { name: string; version?: string }
        return [json.name, json.version]
      }),
    )
    for (const row of insertedRows()) {
      expect(versions.has(row.name), `${row.name} is not a workspace package`).toBe(true)
      expect(versions.get(row.name)).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  it('gives every row a unique idealize-prefixed id', () => {
    const rows = insertedRows()
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
    for (const row of rows) {
      expect(row.id.startsWith('idealize-'), `${row.id} is not idealize-prefixed`).toBe(true)
      // A row on a first-party package derives its id from the package name.
      // A row mounting an upstream plugin names the instance instead, because
      // one upstream package can carry several rows: `idealize-mcp-paper` is
      // `@deepseek-ai/dsh-mcp-client` pointed at the Paper server.
      if (row.name.startsWith('@idealize/')) {
        expect(row.id).toBe(`idealize-${row.name.slice('@idealize/'.length)}`)
      }
    }
  })

  it('declares the patch as the bundle`s own manifest entry', () => {
    expect(bundleManifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(bundleManifest.files).toContain('cordis.patch.yml')
    // Every composed row is a declared dependency, so the Loader can resolve it.
    for (const row of insertedRows()) {
      expect(Object.keys(bundleManifest.dependencies)).toContain(row.name)
    }
  })
})

/**
 * Each rule of the mode/provider boundary gate is exercised twice: once on a
 * tree that violates it, once on the tree that does not. A gate that has never
 * failed proves nothing, and the real repository is checked last so the rules
 * are known to bite on the tree they ship against.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectModeProviderBoundaryViolations,
  describeScope,
  discoverAdapterPackages,
  discoverModePackages,
  discoverPresetSources,
  readWorkspace,
} from './verify-mode-provider-boundary.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One package to write into a fixture tree. */
interface FixturePackage {
  dir: string
  name: string
  dependencies?: Record<string, string>
  sources?: Record<string, string>
}

/** The Gallery-shaped mode package every fixture starts from. */
function modePackage(overrides: Partial<FixturePackage> = {}): FixturePackage {
  return {
    dir: 'packages/idealize/ui-fake',
    name: '@idealize/ui-fake',
    dependencies: { react: '^18.2.0' },
    sources: { 'client/index.ts': "export const view = 'fake'\n" },
    ...overrides,
  }
}

/** The adapter every fixture registers a backend from. */
const ADAPTER: FixturePackage = {
  dir: 'packages/idealize/gen-fake',
  name: '@idealize/gen-fake',
  sources: {
    'index.ts': [
      "const backend = { id: 'fake', models: () => [{ id: 'acme/painter-1' }] }",
      'export function apply(ctx: Ctx) { ctx.generation.register(backend) }',
      '',
    ].join('\n'),
  },
}

/** Write a fixture workspace and return its root. */
function tree(...packages: FixturePackage[]): string {
  const root = mkdtempSync(join(tmpdir(), 'idealize-mode-boundary-'))
  roots.push(root)
  for (const pkg of packages) {
    const dir = join(root, pkg.dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: pkg.name, dependencies: pkg.dependencies ?? {} }),
    )
    for (const [file, source] of Object.entries(pkg.sources ?? {})) {
      const target = join(dir, 'src', file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, source)
    }
  }
  return root
}

describe('mode/provider boundary gate — scope discovery', () => {
  it('polices ui-prefixed packages and any package that takes a ring seat', () => {
    const root = tree(modePackage(), ADAPTER, {
      dir: 'packages/idealize/canvas',
      name: '@idealize/canvas',
      sources: { 'client.ts': "slots.register({ name: 'conversation.view', id: 'canvas' })\n" },
    }, {
      dir: 'packages/idealize/vault',
      name: '@idealize/vault',
      sources: { 'index.ts': 'export const name = 1\n' },
    })
    const packages = readWorkspace(root)
    expect(discoverModePackages(root, packages).map(mode => mode.name))
      .toEqual(['@idealize/canvas', '@idealize/ui-fake'])
    expect(discoverAdapterPackages(root, packages)).toEqual(['@idealize/gen-fake'])
    expect(discoverPresetSources(root, packages)).toEqual([])
  })
})

describe('mode/provider boundary gate — rule 1, the import graph', () => {
  it('rejects a mode importing an adapter, and passes once the import is gone', () => {
    const violating = tree(ADAPTER, modePackage({
      sources: { 'client/index.ts': "import { apply } from '@idealize/gen-fake'\nexport { apply }\n" },
    }))
    expect(collectModeProviderBoundaryViolations(violating)).toEqual([
      'packages/idealize/ui-fake/src/client/index.ts:1: imports the provider @idealize/gen-fake.'
      + ' A mode names a capability and lets ctx.generation route it; only adapter packages'
      + ' and settings may name a provider.',
    ])
    expect(collectModeProviderBoundaryViolations(tree(ADAPTER, modePackage()))).toEqual([])
  })

  it('rejects an adapter reached through an intermediate package, naming the path', () => {
    const root = tree(ADAPTER, {
      dir: 'packages/idealize/helper',
      name: '@idealize/helper',
      dependencies: { '@idealize/gen-fake': 'workspace:^' },
    }, modePackage({ dependencies: { '@idealize/helper': 'workspace:^' } }))
    expect(collectModeProviderBoundaryViolations(root)).toEqual([
      '@idealize/ui-fake: depends on the provider @idealize/gen-fake'
      + ' (through @idealize/helper → @idealize/gen-fake).'
      + ' A mode names a capability and lets ctx.generation route it; only adapter packages'
      + ' and settings may name a provider.',
    ])
  })

  it('rejects a mode depending on a provider SDK', () => {
    const root = tree(ADAPTER, modePackage({ dependencies: { '@earendil-works/pi-ai': '^0.82.1' } }))
    expect(collectModeProviderBoundaryViolations(root)).toEqual([
      '@idealize/ui-fake: depends on the provider @earendil-works/pi-ai'
      + ' (through @earendil-works/pi-ai).'
      + ' A mode names a capability and lets ctx.generation route it; only adapter packages'
      + ' and settings may name a provider.',
    ])
  })

  it('admits an adapter a mode only names in its tests', () => {
    const root = tree(ADAPTER, modePackage())
    const tests = join(root, 'packages/idealize/ui-fake/tests')
    mkdirSync(tests, { recursive: true })
    writeFileSync(join(tests, 'mode.spec.ts'), "import * as Fake from '@idealize/gen-fake'\nexport { Fake }\n")
    expect(collectModeProviderBoundaryViolations(root)).toEqual([])
  })
})

describe('mode/provider boundary gate — rule 2, model-id literals', () => {
  it('rejects a vendor-prefixed model id in mode source', () => {
    const root = tree(ADAPTER, modePackage({
      sources: { 'client/index.ts': "export const fallback = 'openai/gpt-audio'\n" },
    }))
    expect(collectModeProviderBoundaryViolations(root)).toEqual([
      'packages/idealize/ui-fake/src/client/index.ts:1: names the model "openai/gpt-audio".'
      + ' The chosen model id lives in the settings document; code carries capability'
      + ' identifiers only (AC-14).',
    ])
  })

  it('rejects a model id from a vendor no list names, because the adapter publishes it', () => {
    const root = tree(ADAPTER, modePackage({
      sources: { 'client/index.ts': "export const fallback = 'acme/painter-1'\n" },
    }))
    expect(collectModeProviderBoundaryViolations(root)).toHaveLength(1)
    expect(collectModeProviderBoundaryViolations(root)[0]).toContain('names the model "acme/painter-1"')
  })

  it('accepts a CLI launcher id that resembles a bare model family', () => {
    const root = tree(ADAPTER, modePackage({
      sources: { 'client/index.ts': "export const cli = 'claude-code'\n" },
    }))
    expect(collectModeProviderBoundaryViolations(root)).toHaveLength(0)
  })

  it('rejects a bare model family', () => {
    const root = tree(ADAPTER, modePackage({
      sources: { 'client/index.ts': "export const fallback = 'claude-opus-4'\n" },
    }))
    expect(collectModeProviderBoundaryViolations(root)[0]).toContain('names the model "claude-opus-4"')
  })

  it('AC-14: rejects a model id in the default preset definitions', () => {
    const root = tree(ADAPTER, modePackage(), {
      dir: 'packages/idealize/generate',
      name: '@idealize/generate',
      sources: { 'media.ts': "export const MEDIA_PRESETS = [{ id: 'images', model: 'openai/gpt-image-1' }]\n" },
    })
    expect(collectModeProviderBoundaryViolations(root)).toEqual([
      'packages/idealize/generate/src/media.ts:1: names the model "openai/gpt-image-1".'
      + ' The chosen model id lives in the settings document; code carries capability'
      + ' identifiers only (AC-14).',
    ])
  })

  it('admits the slug-shaped literals a mode legitimately writes', () => {
    const root = tree(ADAPTER, modePackage({
      sources: {
        'client/index.ts': [
          "import jsx from 'react/jsx-runtime'",
          "export const events = ['artefact/created', 'tool/result']",
          "export const thumbnail = 'image/png'",
          "export const route = '/idealize/artefacts/raw'",
          'export { jsx }',
          '',
        ].join('\n'),
      },
    }))
    expect(collectModeProviderBoundaryViolations(root)).toEqual([])
  })
})

describe('mode/provider boundary gate — rule 3, provider-id literals', () => {
  it('rejects a hard-named backend, and admits the same word inside prose', () => {
    const violating = tree(ADAPTER, modePackage({
      sources: { 'client/index.ts': "export const backend = 'openrouter'\n" },
    }))
    expect(collectModeProviderBoundaryViolations(violating)).toEqual([
      'packages/idealize/ui-fake/src/client/index.ts:1: names the provider "openrouter".'
      + ' Provider ids belong to adapter packages and to the settings document (AC-03).',
    ])
    const prose = tree(ADAPTER, modePackage({
      sources: { 'client/locales.ts': "export const en = { 'brains.media.addKey': 'Add OpenRouter key' }\n" },
    }))
    expect(collectModeProviderBoundaryViolations(prose)).toEqual([])
  })
})

describe('mode/provider boundary gate — the repository it ships against', () => {
  it('polices every V1 view package and the bar that launches them', () => {
    const { modes, adapters, presets } = describeScope(REPO_ROOT)
    expect(presets).toEqual(['packages/idealize/generate/src/media.ts'])
    expect(modes).toEqual(expect.arrayContaining([
      '@idealize/ui-bar',
      '@idealize/ui-gallery',
      '@idealize/ui-schedule',
      '@idealize/ui-soundstage',
      '@idealize/ui-terminal',
    ]))
    expect(adapters).toEqual(expect.arrayContaining(['@idealize/gen-fixture', '@idealize/services']))
  })

  it('finds the boundary intact', () => {
    expect(collectModeProviderBoundaryViolations(REPO_ROOT)).toEqual([])
  })
})

/**
 * The plugin-architecture acceptance criteria, proved on a real composition
 * booted through the vendored Loader: storage, the settings file, the agent
 * preset roster, the web server, the real `idealize-activity-pills` settings
 * section, the artefact store, the generation seam, the Sound Stage host half,
 * and the fixture generation backend as one composition row.
 *
 * - AC-01: the row makes the fixture's models selectable in the media presets.
 * - AC-02: `disabled: true` on that one row takes the capability away and
 *   leaves every other row serving.
 * - AC-14: the chosen model id is written to and read back from the settings
 *   document, across a relaunch over the same file.
 */

import { get as httpGet, request as httpRequest } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import ArtefactStore from '@idealize/artefacts'
import GenerationRuntime from '@idealize/generate'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as ActivityPills from '@idealize/activity-pills/src/index.ts'
import * as Soundstage from '@idealize/ui-soundstage/src/index.ts'
import * as GenFixture from '../src/index.ts'
import fixtureManifest from '../package.json' with { type: 'json' }

/** The settings section `@idealize/activity-pills` owns; the media choices share its `models` map. */
const ACTIVITY_NS = settingsNamespace('idealize-activity-pills')

/** The fixture row's registry id and the two models it publishes. */
const BACKEND = 'fixture'
const STILL = 'fixture-still'
const TONE = 'fixture-tone'

/** One media preset as the `/idealize/brains/media` route serves it. */
interface PresetPayload {
  id: string
  model: { backend: string; model: string } | null
  candidates: { backend: string; model: { id: string } }[]
  availability: { state: string; recovery?: unknown[] }
}

let roots: string[] = []
let contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  roots = []
  contexts = []
})

/**
 * Boot the composition over a root, with the fixture row present, disabled, or
 * absent. Every row is one line of the test cordis.yml, exactly as
 * `bundle-idealize/cordis.patch.yml` contributes rows to the shipped profile.
 */
async function boot(
  { root, fixture = 'enabled' }: { root: string; fixture?: 'enabled' | 'disabled' | 'absent' },
): Promise<{ ctx: Context; port: number }> {
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-agent-presets'",
    '  config:',
    '    default: standard',
    '    includeUserRoot: false',
    '    roots:',
    `      - path: ${JSON.stringify(join(root, 'presets'))}`,
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'sessions'))}`,
    "- name: '@deepseek-ai/dsh-workspace'",
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@idealize/activity-pills'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'presets'))}`,
    "- name: '@idealize/artefacts'",
    "- name: '@idealize/generate'",
    "- name: '@idealize/ui-soundstage'",
    ...fixture === 'absent' ? [] : [
      "- name: '@idealize/gen-fixture'",
      ...fixture === 'disabled' ? ['  disabled: true'] : [],
      '  config:',
      `    backendId: ${BACKEND}`,
      '    models:',
      `      - id: ${STILL}`,
      '        artefact: image',
      `      - id: ${TONE}`,
      '        artefact: audio',
    ],
    '',
  ].join('\n'))

  const context = new Context()
  contexts.push(context)
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@idealize/activity-pills', ActivityPills],
    ['@idealize/artefacts', ArtefactStore],
    ['@idealize/generate', GenerationRuntime],
    ['@idealize/ui-soundstage', Soundstage],
    ['@idealize/gen-fixture', GenFixture],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { ctx: context, port: context.webServer.port }
}

/** A temp root that outlives one boot, so a relaunch can reuse its settings file. */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'idealize-plugin-lifecycle-'))
  roots.push(root)
  return root
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path, headers: { host: '127.0.0.1' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
    }).on('error', reject)
  })
}

function post(port: number, path: string, payload: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        'x-idealize-auth': '1',
      },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
    })
    req.on('error', reject)
    req.end(data)
  })
}

/** The media presets as the Brains pane reads them. */
async function presets(port: number): Promise<PresetPayload[]> {
  const response = await get(port, '/idealize/brains/media')
  expect(response.status).toBe(200)
  return (JSON.parse(response.body) as { presets: PresetPayload[] }).presets
}

function preset(all: PresetPayload[], id: string): PresetPayload {
  const found = all.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no ${id} preset in the media payload`)
  return found
}

describe('AC-01: a fixture generation plugin registers through the plugin host', () => {
  it('makes its models selectable in the presets its capabilities satisfy', async () => {
    const { port } = await boot({ root: await makeRoot() })
    const all = await presets(port)

    expect(preset(all, 'images').candidates.map(entry => `${entry.backend}/${entry.model.id}`))
      .toEqual([`${BACKEND}/${STILL}`])
    expect(preset(all, 'sound').candidates.map(entry => `${entry.backend}/${entry.model.id}`))
      .toEqual([`${BACKEND}/${TONE}`])
    expect(preset(all, 'images').availability.state).toBe('available')
    // Motion has no fixture model: an unsatisfied preset states so rather than
    // borrowing another preset's backend.
    expect(preset(all, 'motion').candidates).toEqual([])
  })

  it('touches the product through the published seam alone, so no core code changes with it', () => {
    expect(GenFixture.inject).toEqual(['generation'])
    expect(Object.keys(fixtureManifest.dependencies)).toEqual([
      '@deepseek-ai/cordis',
      '@deepseek-ai/schemastery',
      '@idealize/generate',
    ])
  })
})

describe('AC-02: disabling the fixture removes its capability', () => {
  it('takes the models away and leaves the unrelated rows serving', async () => {
    const { ctx, port } = await boot({ root: await makeRoot(), fixture: 'disabled' })
    const all = await presets(port)

    for (const id of ['images', 'motion', 'sound']) {
      expect(preset(all, id).candidates).toEqual([])
      expect(preset(all, id).availability.state).toBe('unavailable')
      expect((preset(all, id).availability.recovery ?? []).length).toBeGreaterThan(0)
    }

    // The artefact store the Sound Stage reads its bytes from, and the settings
    // section the Brains pane writes, both keep working without the backend.
    // (The Sound Stage's own host face registers nothing since 4 Sep 2026: its
    // rows come from the chat's conversation snapshot, not from a route.)
    expect(ctx.get('artefacts')).toBeDefined()
    expect(ctx.settings.get(ACTIVITY_NS)).toBeDefined()
  })

  it('serves the same unavailable state as never composing the row at all', async () => {
    const disabled = await boot({ root: await makeRoot(), fixture: 'disabled' })
    const absent = await boot({ root: await makeRoot(), fixture: 'absent' })

    expect(preset(await presets(disabled.port), 'sound').availability)
      .toEqual(preset(await presets(absent.port), 'sound').availability)
  })
})

describe('AC-14: the chosen model id lives in the settings document', () => {
  it('writes the selection to the real settings section and restores it after a relaunch', async () => {
    const root = await makeRoot()
    const first = await boot({ root })

    expect(preset(await presets(first.port), 'images').model).toBeNull()
    const written = await post(first.port, '/idealize/brains/media', {
      id: 'images',
      model: { backend: BACKEND, model: STILL },
    })
    expect(written.status).toBe(200)

    // The settings file is the only place the id lands.
    const document = await readFile(join(root, 'settings.yaml'), 'utf8')
    expect(document).toContain('idealize-activity-pills')
    expect(document).toContain(STILL)

    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const relaunched = await boot({ root })
    expect(preset(await presets(relaunched.port), 'images').model)
      .toEqual({ backend: BACKEND, model: STILL })
  })

  it('refuses a model the registered backends do not offer', async () => {
    const { port } = await boot({ root: await makeRoot() })
    const refused = await post(port, '/idealize/brains/media', {
      id: 'images',
      model: { backend: BACKEND, model: 'fixture-absent' },
    })

    expect(refused.status).toBe(400)
    expect(preset(await presets(port), 'images').model).toBeNull()
  })
})

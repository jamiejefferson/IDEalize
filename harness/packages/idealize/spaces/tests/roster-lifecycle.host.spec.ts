/**
 * REAL-composition coverage for `GET /idealize/spaces`, booted through the
 * vendored Loader over a temp root: storage, the settings file, the agent
 * preset roster, the web server, the seeded activity and media brains, the
 * generation seam, and a fixture generation backend that is present in one
 * boot and absent in the next.
 *
 * The assertions are the product invariant: every declared space is served
 * with a brain count in both boots, so the chooser can never dim or drop a
 * tile, while `models`, `reason` and `recovery` change with the composition
 * for the brain step alone.
 */

import { get as httpGet, request as httpRequest } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import GenerationRuntime from '@idealize/generate'
import * as ActivityPills from '@idealize/activity-pills/src/index.ts'
import * as GenTools from '@idealize/gen-tools/src/index.ts'
import * as GenFixture from '@idealize/gen-fixture/src/index.ts'
import * as Spaces from '../src/index.ts'
import { ROSTER_PATH, type SpaceRosterEntry } from '../src/index.ts'

/** The fixture row's registry id and its one model: a still image, no video and no audio. */
const BACKEND = 'fixture'
const STILL = 'fixture-still'

let roots: string[] = []
let contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  roots = []
  contexts = []
})

/**
 * Boot the composition, varying the three rows the roster route probes for:
 * the fixture generation backend, the generation seam itself, and the two
 * brain seeders. Every row is one line of a test cordis.yml, the way the
 * shipped profile is assembled. Both preset roots are the temp directory, and
 * the user root is off, so no test reads or writes the developer's own
 * `$DSH_HOME`.
 *
 * The two roots mirror the installed app: a read-only `system` root carrying
 * the shipped `standard` composition the brains derive from, and a writable
 * `user` root the seeders write into. Only the second holds brains.
 */
async function boot(
  { fixture, generation = true, brains = true }: { fixture: boolean; generation?: boolean; brains?: boolean },
): Promise<{ ctx: Context; port: number }> {
  const root = await mkdtemp(join(tmpdir(), 'idealize-space-roster-'))
  roots.push(root)
  const presets = join(root, 'presets')
  const shipped = join(root, 'shipped')
  await mkdir(presets, { recursive: true })
  await mkdir(join(shipped, 'standard'), { recursive: true })
  await writeFile(
    join(shipped, 'standard', 'agent.cordis.yml'),
    "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: A standard test brain.\n",
  )
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
    `      - path: ${JSON.stringify(shipped)}`,
    '        trust: system',
    `      - path: ${JSON.stringify(presets)}`,
    '        trust: user',
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    ...brains
      ? [
        // The activity routes register once a credential store exists; the
        // brains' access is read from it (and nothing is stored here).
        "- name: '@deepseek-ai/dsh-credentials-local'",
        '  config:',
        `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
        '    watch: false',
        "- name: '@idealize/activity-pills'",
        '  config:',
        `    root: ${JSON.stringify(presets)}`,
        "- name: '@idealize/gen-tools'",
        '  config:',
        `    root: ${JSON.stringify(presets)}`,
      ]
      : [],
    ...generation ? ["- name: '@idealize/generate'"] : [],
    ...fixture
      ? [
        "- name: '@idealize/gen-fixture'",
        '  config:',
        `    backendId: ${BACKEND}`,
        '    models:',
        `      - id: ${STILL}`,
        '        artefact: image',
      ]
      : [],
    '- id: idealize-spaces',
    "  name: '@idealize/spaces'",
    '',
  ].join('\n'))

  const context = new Context()
  contexts.push(context)
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjections],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-credentials-local', CredentialsLocal],
    ['@idealize/activity-pills', ActivityPills],
    ['@idealize/gen-tools', GenTools],
    ['@idealize/generate', GenerationRuntime],
    ['@idealize/gen-fixture', GenFixture],
    ['@idealize/spaces', Spaces],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  // Both seeders write their presets in the background once the roster service
  // is up; the roster route reads the same list, so wait for the writes.
  if (brains) await waitForPresets(context, ['coding', 'gallery', 'soundstage', 'video'])
  return { ctx: context, port: context.webServer.port }
}

/** Poll the roster until every id has landed, so a seeding race cannot flake the count. */
async function waitForPresets(ctx: Context, ids: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const listed = new Set((await ctx.agentPresets.list()).map(preset => preset.id))
    if (ids.every(id => listed.has(id))) return
    await new Promise((settle) => { setTimeout(settle, 25) })
  }
  throw new Error(`the seeded presets never appeared: ${ids.join(', ')}`)
}

function get(port: number, path: string, headers: Record<string, string> = { host: '127.0.0.1' }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
    }).on('error', reject)
  })
}

/** The roster as the welcome card reads it. */
async function roster(port: number): Promise<SpaceRosterEntry[]> {
  const response = await get(port, ROSTER_PATH)
  expect(response.status).toBe(200)
  return (JSON.parse(response.body) as { spaces: SpaceRosterEntry[] }).spaces
}

function entry(all: readonly SpaceRosterEntry[], id: string): SpaceRosterEntry {
  const found = all.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no ${id} entry in the roster payload`)
  return found
}

describe('GET /idealize/spaces on a real composition', () => {
  it('counts the seeded brains per space and reads the generation seam for the media spaces', async () => {
    const { port } = await boot({ fixture: true })
    const all = await roster(port)

    expect(all.map(space => space.id)).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    // The five activity brains work in Chat and four of them in Terminal
    // (Free's route is a chat route); each media brain works in its own
    // space. The shipped `standard` composition they all derive from is not a
    // brain and is not counted, so the tiles read what the product offers.
    expect(all.map(space => [space.id, space.brainCount])).toEqual([
      ['chat', 5], ['terminal', 4], ['gallery', 1], ['soundstage', 1], ['motion', 1],
    ])
    expect(entry(all, 'chat').brains.map(brain => brain.name).sort())
      .toEqual(['Admin', 'Coding', 'Design', 'Free', 'Writing'])
    expect(entry(all, 'terminal').brains.map(brain => brain.name).sort())
      .toEqual(['Admin', 'Coding', 'Design', 'Writing'])
    expect(entry(all, 'gallery').brains).toEqual([{ id: 'gallery', name: 'Gallery', default: true }])
    expect(entry(all, 'motion').brains).toEqual([{ id: 'video', name: 'Video', default: true }])

    // The fixture publishes a still-image model and nothing else.
    expect(entry(all, 'gallery').models).toBe('some')
    expect(entry(all, 'soundstage')).toMatchObject({ models: 'none', reason: 'no-compatible-model' })
    expect(entry(all, 'motion')).toMatchObject({ models: 'none', reason: 'no-compatible-model' })
  })

  it('keeps every tile live when no generation backend is registered', async () => {
    const { port } = await boot({ fixture: false })
    const all = await roster(port)

    expect(all.map(space => space.id)).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    for (const id of ['gallery', 'soundstage', 'motion']) {
      expect(entry(all, id)).toMatchObject({ models: 'none', reason: 'no-backend' })
      expect(typeof entry(all, id).recovery).toBe('string')
    }
    // Refused spaces keep their counts, which is all a tile ever reads.
    expect(entry(all, 'gallery').brainCount).toBe(1)
    expect(entry(all, 'motion').brainCount).toBe(1)
  })

  it('takes both coordinator presets out of the spaces: each answers to the person, not to a space', async () => {
    const { ctx, port } = await boot({ fixture: false })
    ctx.provide('idealizeComm', {
      config: () => ({ projectAgentPreset: 'design', studioAgentPreset: 'admin' }),
    } as never)

    const all = await roster(port)
    // Both named presets leave Chat and Terminal (JJ, 11 Sep 2026: the Studio
    // Coordinator belongs beside the project one under Agent roles).
    expect(entry(all, 'chat').brains.map(brain => brain.id).sort()).toEqual(['coding', 'free', 'writing'])
    expect(entry(all, 'terminal').brains.map(brain => brain.id).sort()).toEqual(['coding', 'writing'])
  })

  it('explains where the terminal runs instead of hiding it, on a composition with no desktop shell', async () => {
    const { ctx, port } = await boot({ fixture: false })
    expect((ctx as unknown as { get(name: string): unknown }).get('desktopActions')).toBeUndefined()

    const terminal = entry(await roster(port), 'terminal')
    expect(terminal).toMatchObject({ brainCount: 4, models: 'none', reason: 'desktop-only' })
    expect(terminal.recovery).toContain('desktop app')
  })

  it('states that no chat model resolves while the deployment configures none', async () => {
    const { port } = await boot({ fixture: false })
    expect(entry(await roster(port), 'chat')).toMatchObject({
      brainCount: 5,
      models: 'none',
      reason: 'no-model',
    })
  })

  it('reads the desktop shell, the role mapping and the stored space map when the deployment supplies them', async () => {
    const { ctx, port } = await boot({ fixture: false })
    // The desktop shell and the `idealize` command service both ship in some
    // compositions and not others; the route probes for each with `ctx.get`.
    ctx.provide('desktopActions', { openTerminal: () => {} } as never)
    ctx.provide('idealizeComm', { config: () => ({ projectAgentPreset: 'design' }) } as never)
    await ctx.settings.update(settingsNamespace('idealize-activity-pills'), {
      spaces: { writing: ['gallery'] },
      models: { admin: { provider: 'openai', model: 'gpt-5' } },
    })

    const all = await roster(port)

    // Chat loses the brain now carrying the coordinator role and the one
    // reassigned to Gallery; Terminal loses Free as well; the stored override
    // proves a chat model resolves.
    expect(all.map(space => [space.id, space.brainCount])).toEqual([
      ['chat', 3], ['terminal', 2], ['gallery', 2], ['soundstage', 1], ['motion', 1],
    ])
    expect(entry(all, 'chat').brains.map(brain => brain.id).sort()).toEqual(['admin', 'coding', 'free'])
    // The stored override reaches the brain row that carries it.
    expect(entry(all, 'chat').brains.find(brain => brain.id === 'admin')?.model)
      .toEqual({ provider: 'openai', model: 'gpt-5' })
    // With a shell present the terminal states no refusal of its own.
    expect(entry(all, 'terminal')).toMatchObject({ id: 'terminal', brainCount: 2, models: 'some' })
    expect(entry(all, 'terminal').reason).toBeUndefined()

    // The developer's own shell may carry the key this brain would read.
    vi.stubEnv('OPENAI_API_KEY', '')
    // The agents route assesses every brain, not only the five activities:
    // Admin's override names a route with no stored key, so a chat on it
    // would fail at its first turn and the row reads `no-access`; a brain
    // with no model at all reads `no-model`.
    const agents = await get(port, '/idealize/activity/agents')
    expect(agents.status).toBe(200)
    const rows = (JSON.parse(agents.body) as { agents: { id: string; access: { state: string; reason?: string } }[] }).agents
    expect(rows.find(row => row.id === 'admin')?.access).toEqual({
      model: { provider: 'openai', model: 'gpt-5' }, state: 'unavailable', reason: 'no-access',
    })
    expect(rows.find(row => row.id === 'gallery')?.access).toMatchObject({ state: 'unavailable', reason: 'no-model' })
    // The terminal-only route names the CLI that serves it, with the login shell's verdict on its presence.
    const terminal = (JSON.parse(agents.body) as { terminal: { provider: string; cli: string; installed: boolean | null }[] }).terminal
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toMatchObject({ provider: 'anthropic', cli: 'claude' })
    expect([true, false, null]).toContain(terminal[0]?.installed)
    // The probe itself: a name every shell resolves, one none does, and shapes it refuses to run.
    if (process.platform !== 'win32') {
      expect(await ActivityPills.cliInstalled('ls')).toBe(true)
      expect(await ActivityPills.cliInstalled('no-such-cli-for-idealize-c6')).toBe(false)
    }
    expect(await ActivityPills.cliInstalled('../claude')).toBeNull()
    expect(await ActivityPills.cliInstalled('claude; rm -rf /')).toBeNull()
  })

  it('serves the whole table on a composition with no generation seam and no seeded brains', async () => {
    const { port } = await boot({ fixture: false, generation: false, brains: false })
    const all = await roster(port)

    // Only the shipped source preset is on the roster, and it is not a brain,
    // so every space serves an empty list and a zero count — and still a tile.
    expect(all.map(space => [space.id, space.brainCount])).toEqual([
      ['chat', 0], ['terminal', 0], ['gallery', 0], ['soundstage', 0], ['motion', 0],
    ])
    expect(all.every(space => space.brains.length === 0)).toBe(true)
    for (const id of ['gallery', 'soundstage', 'motion']) {
      expect(entry(all, id)).toMatchObject({ models: 'none', reason: 'no-backend' })
    }
  })

  it('answers GET from loopback and refuses anything else', async () => {
    const { port } = await boot({ fixture: false })

    expect(await get(port, ROSTER_PATH, { host: 'example.com' }))
      .toMatchObject({ status: 403, body: 'loopback only' })
    const posted = await new Promise<{ status: number; allow: string | undefined }>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port, path: ROSTER_PATH, method: 'POST',
        headers: { host: '127.0.0.1', 'content-length': 0 },
      }, (res) => {
        res.resume()
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, allow: res.headers.allow }) })
      })
      req.on('error', reject)
      req.end()
    })
    expect(posted).toEqual({ status: 405, allow: 'GET' })
  })
})

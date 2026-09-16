/**
 * REAL-composition coverage for the rule that the space owns the tools: a
 * test-only cordis.yml booted through the vendored Loader mounts storage, the
 * settings file, the agent preset roster (a read-only `system` root carrying
 * `standard`, a writable `user` root), the web server, a credential store and
 * `@idealize/activity-pills`. Assertions observe the composition files the
 * create and save routes write for brains placed in generating spaces and in
 * Chat, and the startup repair of a preset that predates the rule.
 */

import { request as httpRequest, get as httpGet } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import * as ActivityPills from '@idealize/activity-pills/src/index.ts'
import { repairGeneratingBrains, retiredRolePresetsToRemove } from '@idealize/activity-pills/src/index.ts'

/** The shipped composition the test's `standard` preset carries: a persona and a shell. */
const STANDARD = [
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    text: A standard test brain.',
  '- id: tool-bash',
  "  name: '@deepseek-ai/dsh-tool-bash'",
  '',
].join('\n')

const GENERATION_ROWS = ['@deepseek-ai/dsh-persona', '@idealize/gen-tools/tools', '@deepseek-ai/dsh-tool-jobs']

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Composition {
  names: string[]
  persona: string | undefined
}

/** One composition file as rows and persona text. */
async function composition(path: string): Promise<Composition> {
  const rows = load(await readFile(path, 'utf8'), { schema: entryListSchema }) as { name: string; config?: { text?: string } }[]
  return {
    names: rows.map(row => row.name),
    persona: rows.find(row => row.name === '@deepseek-ai/dsh-persona')?.config?.text,
  }
}

/** A preset written into the user root by hand, the way a pre-rule brain sits on disk. */
async function writePreset(presets: string, id: string, text: string, name: string): Promise<void> {
  await mkdir(join(presets, id), { recursive: true })
  await writeFile(join(presets, id, 'agent.cordis.yml'), text)
  await writeFile(join(presets, id, 'preset.yml'), `name: ${name}\n`)
}

/**
 * Boot the composition over a temp root. `before` runs once both preset roots
 * exist and before any plugin loads, so a test can plant a preset the startup
 * repair must find.
 */
async function boot(before?: (presets: string) => Promise<void>): Promise<{ ctx: Context; port: number; presets: string; info: string[] }> {
  root = await mkdtemp(join(tmpdir(), 'idealize-activity-composition-'))
  const presets = join(root, 'presets')
  const shipped = join(root, 'shipped')
  await mkdir(presets, { recursive: true })
  await mkdir(join(shipped, 'standard'), { recursive: true })
  await writeFile(join(shipped, 'standard', 'agent.cordis.yml'), STANDARD)
  await before?.(presets)
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
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    watch: false',
    "- name: '@idealize/activity-pills'",
    '  config:',
    `    root: ${JSON.stringify(presets)}`,
    '',
  ].join('\n'))

  context = new Context()
  const info: string[] = []
  vi.spyOn(context.logger, 'info').mockImplementation(((message: unknown) => { info.push(String(message)) }) as never)
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-credentials-local', CredentialsLocal],
    ['@idealize/activity-pills', ActivityPills],
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
  // Seeding and the repair pass run in the background once the roster is up.
  await waitForPresets(context, ['coding', 'free'])
  return { ctx: context, port: context.webServer.port, presets, info }
}

/** Poll the roster until every id has landed, so the seeding race cannot flake a read. */
async function waitForPresets(ctx: Context, ids: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const listed = new Set((await ctx.agentPresets.list()).map(preset => preset.id))
    if (ids.every(id => listed.has(id))) return
    await new Promise((settle) => { setTimeout(settle, 25) })
  }
  throw new Error(`the seeded presets never appeared: ${ids.join(', ')}`)
}

/** Poll until a predicate over the file holds, for writes that land off the request path. */
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return
    await new Promise((settle) => { setTimeout(settle, 25) })
  }
  throw new Error('the awaited state never arrived')
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
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        host: '127.0.0.1',
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

const AGENT = '/idealize/activity/agent'

describe('POST /idealize/activity/agent composes by space', () => {
  it('creates a brain placed in Images with the generation toolset only and a persona built from its name', async () => {
    const { port, presets } = await boot()

    const response = await post(port, AGENT, { name: 'Retro', model: null, instructions: '', spaces: ['gallery'] })
    expect(JSON.parse(response.body)).toEqual({ ok: true, id: 'retro' })

    const retro = await composition(join(presets, 'retro', 'agent.cordis.yml'))
    expect(retro.names).toEqual(GENERATION_ROWS)
    expect(retro.persona).toBe(
      'You are the IDEalize Retro agent powered by the {{model}} model. Your working directory is {{cwd}}. '
      + 'You create still images from the user\'s prompts with the generate_image tool; every result is stored as a project artefact and appears in the gallery. '
      + 'Report each artefact id when you finish, and describe what was generated. '
      + 'Explain engineering plainly and without jargon; your user directs the work and learns from how you narrate it.',
    )
  })

  it('creates "Video" with no placement as Motion\'s own agent: generate_video, and no shell', async () => {
    // JJ, 7 Sep 2026: "Add a brain for Video" produced a standard brain with no
    // generate_video tool, and the model reached for a Higgsfield CLI instead.
    const { port, presets } = await boot()

    await post(port, AGENT, { name: 'Video', model: null, instructions: '' })

    const video = await composition(join(presets, 'video', 'agent.cordis.yml'))
    expect(video.names).toEqual(GENERATION_ROWS)
    expect(video.persona).toContain('with the generate_video tool')
    const agents = JSON.parse((await get(port, '/idealize/activity/agents')).body) as { agents: { id: string; spaces: string[] }[] }
    expect(agents.agents.find(agent => agent.id === 'video')?.spaces).toEqual(['motion'])
  })

  it('creates a brain for Chat from the shipped source, as before', async () => {
    const { port, presets } = await boot()

    await post(port, AGENT, { name: 'Notes', model: null, instructions: 'Keep notes.', spaces: ['chat'] })

    const notes = await composition(join(presets, 'notes', 'agent.cordis.yml'))
    expect(notes.names).toEqual(['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-bash'])
    expect(notes.persona).toBe('Keep notes.')
  })

  it('rewrites a standard brain moved into Sounds with the generation toolset, keeping its instructions', async () => {
    const { port, presets } = await boot(presets => writePreset(
      presets, 'foley', STANDARD.replace('A standard test brain.', 'Only footsteps and doors.'), 'Foley',
    ))
    expect((await composition(join(presets, 'foley', 'agent.cordis.yml'))).names).toContain('@deepseek-ai/dsh-tool-bash')

    const response = await post(port, AGENT, {
      id: 'foley', name: 'Foley', model: null, instructions: 'Only footsteps and doors.', spaces: ['soundstage'],
    })
    expect(response.status).toBe(200)

    const foley = await composition(join(presets, 'foley', 'agent.cordis.yml'))
    expect(foley.names).toEqual(GENERATION_ROWS)
    expect(foley.persona).toBe('Only footsteps and doors.')
  })

  it('derives a generating brain moved to Chat from the shipped source again, keeping its instructions', async () => {
    const { port, presets } = await boot()
    await post(port, AGENT, { name: 'Retro', model: null, instructions: 'Film grain.', spaces: ['gallery'] })
    expect((await composition(join(presets, 'retro', 'agent.cordis.yml'))).names).toEqual(GENERATION_ROWS)

    await post(port, AGENT, { id: 'retro', name: 'Retro', model: null, instructions: 'Film grain.', spaces: ['chat', 'terminal'] })

    const retro = await composition(join(presets, 'retro', 'agent.cordis.yml'))
    expect(retro.names).toEqual(['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-bash'])
    expect(retro.persona).toBe('Film grain.')
  })

  it('leaves a generating brain\'s composition alone when a save changes only its model or instructions', async () => {
    const { port, presets } = await boot()
    await post(port, AGENT, { name: 'Retro', model: null, instructions: 'Film grain.', spaces: ['gallery'] })

    await post(port, AGENT, { id: 'retro', name: 'Retro', model: { provider: 'openai', model: 'gpt-5' }, instructions: 'Heavy film grain.' })

    const retro = await composition(join(presets, 'retro', 'agent.cordis.yml'))
    expect(retro.names).toEqual(GENERATION_ROWS)
    expect(retro.persona).toBe('Heavy film grain.')
  })

  it('lists Free in Chat alone: no command-line agent plays the free-tokens route in the terminal', async () => {
    const { port } = await boot()
    const agents = JSON.parse((await get(port, '/idealize/activity/agents')).body) as { agents: { id: string; spaces: string[] }[] }
    expect(agents.agents.find(agent => agent.id === 'free')?.spaces).toEqual(['chat'])
    expect(agents.agents.find(agent => agent.id === 'coding')?.spaces).toEqual(['chat', 'terminal'])
  })
})

describe('the startup removal of a retired role preset', () => {
  it('deletes a seeded lead-agent preset nobody placed in a space, and logs it once', async () => {
    // JJ, 7 Sep 2026: "remove the lead agent row". The role went to the group
    // chat on 1 Sep; the preset kept a row under Agent roles on every install.
    const { ctx, presets, info } = await boot(presets => writePreset(presets, 'lead-agent', STANDARD, 'Lead Agent'))

    await waitFor(async () => !(await ctx.agentPresets.list()).some(preset => preset.id === 'lead-agent'))

    await expect(readFile(join(presets, 'lead-agent', 'agent.cordis.yml'), 'utf8')).rejects.toThrow()
    expect(info.filter(line => line.includes('removed the retired role preset "lead-agent"'))).toHaveLength(1)
    // The activity brains and the shipped source are untouched.
    const ids = (await ctx.agentPresets.list()).map(preset => preset.id)
    expect(ids).toEqual(expect.arrayContaining(['standard', 'coding', 'free']))
  })

  it('keeps a retired preset the person placed in a space, and touches no other preset', () => {
    const facts = { presetIds: ['coding', 'lead-agent', 'project-agent'], storedSpaces: {} }
    expect(retiredRolePresetsToRemove(facts)).toEqual(['lead-agent'])
    expect(retiredRolePresetsToRemove({ ...facts, storedSpaces: { 'lead-agent': ['chat'] } })).toEqual([])
    expect(retiredRolePresetsToRemove({ presetIds: ['coding', 'project-agent'], storedSpaces: {} })).toEqual([])
  })
})

describe('the startup repair', () => {
  it('rewrites a pre-rule Video preset with the generation toolset, keeps its persona, and logs the repair once', async () => {
    const generic = 'You are the IDEalize Video agent powered by the {{model}} model. Your working directory is {{cwd}}.'
    const { presets, info } = await boot(presets => writePreset(presets, 'video', STANDARD.replace('A standard test brain.', generic), 'Video'))

    const path = join(presets, 'video', 'agent.cordis.yml')
    await waitFor(async () => !(await composition(path)).names.includes('@deepseek-ai/dsh-tool-bash'))

    const video = await composition(path)
    expect(video.names).toEqual(GENERATION_ROWS)
    expect(video.persona).toBe(generic)
    const lines = info.filter(line => line.includes('repaired preset "video"'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('works in motion only')
    // The activity brains work in Chat, so none of them is touched.
    expect((await composition(join(presets, 'coding', 'agent.cordis.yml'))).names).toContain('@deepseek-ai/dsh-tool-bash')
  })

  it('is idempotent: a repaired preset yields nothing to repair', () => {
    const before = { id: 'video', name: 'Video', path: '/x/video/agent.cordis.yml', composition: STANDARD }
    const first = repairGeneratingBrains({ presets: [before], rolePresets: [], storedSpaces: {} })
    expect(first.map(entry => [entry.id, entry.spaces])).toEqual([['video', ['motion']]])

    const second = repairGeneratingBrains({
      presets: [{ ...before, composition: first[0]?.composition ?? '' }], rolePresets: [], storedSpaces: {},
    })
    expect(second).toEqual([])
  })

  it('reads the stored space map, and leaves brains in Chat, Terminal, or a role alone', () => {
    const presets = [
      { id: 'design', name: 'Design', path: '/x/design', composition: STANDARD },
      { id: 'coding', name: 'Coding', path: '/x/coding', composition: STANDARD },
      { id: 'project-agent', name: 'Project', path: '/x/project-agent', composition: STANDARD },
    ]
    const repairs = repairGeneratingBrains({
      presets, rolePresets: ['project-agent'], storedSpaces: { design: ['gallery', 'motion'] },
    })
    expect(repairs.map(entry => entry.id)).toEqual(['design'])
    expect(repairs[0]?.spaces).toEqual(['gallery', 'motion'])
    // The persona survives; the duties are not appended to a persona the composition already carries.
    expect(repairs[0]?.composition).toContain('A standard test brain.')
    expect(repairs[0]?.composition).not.toContain('generate_image tool')
  })
})

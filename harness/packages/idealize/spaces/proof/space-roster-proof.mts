/**
 * Proof run (not a vitest spec): boot a real composition twice and capture what
 * `GET /idealize/spaces` actually serves — once with a fixture generation
 * backend mounted, once with none — into the two JSON files beside this script.
 *
 * This slice's proof is the payload itself, so it is JSON rather than a
 * screenshot: what has to be seen is that every declared space is served with a
 * brain count in both runs, while `models`, `reason` and `recovery` change with
 * the composition. A tile can read only the first two, so no run can dim a
 * tile; the brain step reads the rest.
 *
 * Usage: pnpm exec tsx packages/idealize/spaces/proof/space-roster-proof.mts
 */

import { get as httpGet } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
import GenerationRuntime from '@idealize/generate'
import * as ActivityPills from '@idealize/activity-pills/src/index.ts'
import * as GenTools from '@idealize/gen-tools/src/index.ts'
import * as GenFixture from '@idealize/gen-fixture/src/index.ts'
import * as Spaces from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))

// Isolation: every run works inside a scratch home, so a proof can never read
// or write the developer's own `~/.dsh` or the packaged app's data directory.
// The composition also names every root explicitly and turns the preset user
// root off, but the fence is stated here rather than assumed.
const scratch = await mkdtemp(join(tmpdir(), 'idealize-spaces-proof-home-'))
process.env.HOME = scratch
process.env.DSH_HOME = join(scratch, '.dsh')
await mkdir(process.env.DSH_HOME, { recursive: true })
for (const [name, value] of [['HOME', process.env.HOME], ['DSH_HOME', process.env.DSH_HOME]] as const) {
  if (!resolve(value).startsWith(resolve(scratch))) throw new Error(`${name} is not inside the scratch home`)
}
console.log(`scratch HOME=${process.env.HOME}\nscratch DSH_HOME=${process.env.DSH_HOME}`)

const BACKEND = 'fixture'
const STILL = 'fixture-still'

async function boot(fixture: boolean): Promise<{ ctx: Context; port: number; root: string }> {
  const root = await mkdtemp(join(scratch, 'run-'))
  // Two roots, as the installed app has them: a read-only `system` root
  // carrying the shipped `standard` composition every brain derives from, and
  // the writable `user` root the seeders write brains into.
  const presets = join(root, 'presets')
  const shipped = join(root, 'shipped')
  await mkdir(presets, { recursive: true })
  await mkdir(join(shipped, 'standard'), { recursive: true })
  await writeFile(
    join(shipped, 'standard', 'agent.cordis.yml'),
    "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: A standard composition.\n",
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
    "- name: '@idealize/activity-pills'",
    '  config:',
    `    root: ${JSON.stringify(presets)}`,
    "- name: '@idealize/gen-tools'",
    '  config:',
    `    root: ${JSON.stringify(presets)}`,
    "- name: '@idealize/generate'",
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

  const ctx = new Context()
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjections],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@idealize/activity-pills', ActivityPills],
    ['@idealize/gen-tools', GenTools],
    ['@idealize/generate', GenerationRuntime],
    ['@idealize/gen-fixture', GenFixture],
    ['@idealize/spaces', Spaces],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const listed = new Set((await ctx.agentPresets.list()).map(preset => preset.id))
    if (['coding', 'gallery', 'soundstage'].every(id => listed.has(id))) break
    await new Promise((settle) => { setTimeout(settle, 25) })
  }
  return { ctx, port: ctx.webServer.port, root }
}

function get(port: number, path: string): Promise<string> {
  return new Promise((settle, fail) => {
    httpGet({ host: '127.0.0.1', port, path, headers: { host: '127.0.0.1' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { settle(body) })
    }).on('error', fail)
  })
}

async function capture(fixture: boolean, file: string): Promise<void> {
  const { ctx, port } = await boot(fixture)
  const payload = JSON.parse(await get(port, Spaces.ROSTER_PATH)) as unknown
  await writeFile(join(here, file), `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`\n=== ${file} (fixture generation backend ${fixture ? 'mounted' : 'absent'}) ===`)
  console.log(JSON.stringify(payload, null, 2))
  await ctx.fiber.dispose()
}

await capture(true, 'roster-with-backend.json')
await capture(false, 'roster-no-backend.json')
await rm(scratch, { recursive: true, force: true })

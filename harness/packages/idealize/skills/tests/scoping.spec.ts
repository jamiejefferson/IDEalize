// Which skills one chat is offered: a brain's `skills` list narrows the
// person's folder for chats on that brain and leaves the brain's own skills
// alone, and a project's playbooks reach chats working in that project only.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { bindScopeParent } from '@deepseek-ai/dsh-scope'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as docPolicy from '@idealize/doc-policy'
import * as skills from '../src/index.ts'

const run = promisify(execFile)
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// A staged folder and a new playbook reach the registry through file watchers,
// which take seconds when the host runs many suites at once.
const SETTLE_MS = 15_000
vi.setConfig({ testTimeout: 90_000 })

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const manifest = (name: string, description = name) => `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`

async function writePackage(folder: string, name: string, description = name): Promise<void> {
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, `${name}.skill`), zipSync({ 'SKILL.md': strToU8(manifest(name, description)) }))
}

/** A preset directory whose composition registers one skill of its own. */
async function writePreset(presets: string, id: string, metadata?: string): Promise<void> {
  const directory = join(presets, id)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'agent.cordis.yml'),
    `- id: own\n  name: ${JSON.stringify(join(FIXTURES, 'own-skill.js'))}\n  config:\n    skill: ${id}-own\n`,
  )
  if (metadata !== undefined) await writeFile(join(directory, 'preset.yml'), metadata)
}

type View = Parameters<Context['skills']['list']>[0]

/** The view's skill names, apart from the skills the plugin ships. */
async function viewNames(ctx: Context, options: View): Promise<string[]> {
  return (await ctx.skills.list(options)).filter(skill => skill.provider !== skills.BUILT_IN_SKILLS_PROVIDER_NAME).map(skill => skill.name)
}

/** Poll until the view's skill names equal `expected`. */
async function expectView(ctx: Context, options: View, expected: string[]): Promise<void> {
  const deadline = Date.now() + SETTLE_MS
  for (;;) {
    const names = await viewNames(ctx, options)
    if (JSON.stringify(names) === JSON.stringify(expected)) return
    if (Date.now() > deadline) {
      expect(names).toEqual(expected)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

async function scratch(): Promise<string> {
  root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-skill-scope-')))
  return root
}

describe('a brain\'s skill list', () => {
  async function boot(withFolder = true): Promise<{ ctx: Context; presets: string }> {
    const dir = await scratch()
    const presets = join(dir, 'presets')
    const folder = join(dir, 'skills')
    for (const name of ['alpha', 'beta', 'delta', 'gamma']) await writePackage(folder, name)
    await writePreset(presets, 'listed', 'name: Listed\nskills:\n  - alpha\n  - beta\n  - gamma\n  - listed-own\n  - never-installed\n')
    await writePreset(presets, 'open', 'name: Open\n')
    await writePreset(presets, 'gone')
    const ctx = new Context()
    context = ctx
    ctx.baseUrl = `${pathToFileURL(dir).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentPresets, { default: 'open', roots: [{ path: presets, trust: 'user' }], includeUserRoot: false })
    await ctx.plugin(skills, { ...withFolder ? { skillsFolder: folder } : {}, unpackFolder: join(dir, 'unpack') })
    return { ctx, presets }
  }

  it('shows a brain that lists three skills those three plus its own, and a brain with no list every skill', async () => {
    const { ctx } = await boot()
    const listed = await ctx.agentPresets.standingKeyFor('listed')
    const open = await ctx.agentPresets.standingKeyFor('open')

    await expectView(ctx, {}, ['alpha', 'beta', 'delta', 'gamma'])
    await expectView(ctx, { scope: listed }, ['alpha', 'beta', 'gamma', 'listed-own'])
    await expectView(ctx, { scope: open }, ['alpha', 'beta', 'delta', 'gamma', 'open-own'])

    // The skills IDEalize ships are offered whatever the brain lists.
    expect((await ctx.skills.list({ scope: listed })).map(skill => skill.name)).toContain('fold-learnings')

    // A chat's agent reads through its own scope key, parented to its brain's.
    const agent = {}
    bindScopeParent(agent, listed)
    await expectView(ctx, { scope: agent }, ['alpha', 'beta', 'gamma', 'listed-own'])
    expect(skills.presetOfScope(agent)).toBe('listed')
    expect(skills.presetOfScope({})).toBeUndefined()

    // The loader refuses what the catalogue leaves out, and loads the rest.
    expect(await ctx.skills.get('delta', { scope: agent })).toBeUndefined()
    expect((await ctx.skills.get('delta', { scope: open }))?.content).toContain('Body of delta.')
    expect((await ctx.skills.get('alpha', { scope: agent }))?.content).toContain('Body of alpha.')
    expect((await ctx.skills.get('listed-own', { scope: agent }))?.content).toBe('listed-own body.')
  })

  it('reads the list again on every request, and an empty list offers none of the folder', async () => {
    const { ctx, presets } = await boot()
    const listed = await ctx.agentPresets.standingKeyFor('listed')
    await expectView(ctx, { scope: listed }, ['alpha', 'beta', 'gamma', 'listed-own'])

    await writeFile(join(presets, 'listed', 'preset.yml'), 'name: Listed\nskills: []\n')
    expect(await viewNames(ctx, { scope: listed })).toEqual(['listed-own'])

    await writeFile(join(presets, 'listed', 'preset.yml'), 'name: Listed\n')
    expect(await viewNames(ctx, { scope: listed })).toEqual(['alpha', 'beta', 'delta', 'gamma', 'listed-own'])
  })

  it('does not narrow a view whose preset the roster no longer holds', async () => {
    const { ctx, presets } = await boot()
    const gone = await ctx.agentPresets.standingKeyFor('gone')
    await rm(join(presets, 'gone'), { recursive: true, force: true })
    await expectView(ctx, { scope: gone }, ['alpha', 'beta', 'delta', 'gamma', 'gone-own'])

  })

  it('leaves a registry that holds no folder skills as it is', async () => {
    const { ctx } = await boot(false)
    const listed = await ctx.agentPresets.standingKeyFor('listed')
    await expectView(ctx, { scope: listed }, ['listed-own'])
  })
})

describe('a project\'s playbooks', () => {
  async function boot(): Promise<{ ctx: Context; repo: string; elsewhere: string; playbooks: string; folder: string }> {
    const dir = await scratch()
    const vault = join(dir, 'vault')
    const repo = join(dir, 'acme-site')
    const elsewhere = join(dir, 'other-repo')
    const folder = join(dir, 'skills')
    const playbooks = join(vault, 'Projects', 'Acme-Site', 'playbooks')
    for (const path of [repo, elsewhere, folder, join(playbooks, 'release')]) await mkdir(path, { recursive: true })
    await mkdir(join(repo, 'src'), { recursive: true })
    for (const path of [repo, elsewhere]) await run('git', ['-C', path, 'init', '-q'])
    await writeFile(join(playbooks, 'release', 'SKILL.md'), manifest('release', 'how this project ships'))
    await writePackage(folder, 'release', 'the general release skill')
    await writePackage(folder, 'triage')
    const ctx = new Context()
    context = ctx
    await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(docPolicy, { documentationFolder: vault })
    await ctx.docPolicy.scan()
    await ctx.plugin(skills, { skillsFolder: folder, unpackFolder: join(dir, 'unpack') })
    return { ctx, repo, elsewhere, playbooks, folder }
  }

  it('lists them for a chat in the project, ahead of a folder skill of the same name, and for no other chat', async () => {
    const { ctx, repo, elsewhere } = await boot()
    await expectView(ctx, { cwd: elsewhere }, ['release', 'triage'])
    await expectView(ctx, { cwd: repo }, ['release', 'triage'])

    const inProject = (await ctx.skills.list({ cwd: join(repo, 'src') })).find(skill => skill.name === 'release')
    expect(inProject).toMatchObject({
      description: 'how this project ships', provider: skills.PLAYBOOKS_PROVIDER_NAME, source: skills.PLAYBOOK_SOURCE,
    })
    expect((await ctx.skills.get('release', { cwd: repo }))?.content).toContain('Body of release.')

    // A folder outside every repository is its own project root.
    expect(await skills.projectRootOf(dirname(repo))).toBe(dirname(repo))
    for (const options of [{ cwd: elsewhere }, {}]) {
      const outside = (await ctx.skills.list(options)).find(skill => skill.name === 'release')
      expect(outside).toMatchObject({ description: 'the general release skill', provider: skills.SKILLS_PROVIDER_NAME })
    }
  })

  // The folder watcher (chokidar, in dsh-skill-filesystem) has missed this
  // write about once in four runs when several hundred test files run beside
  // it, and never in ten runs alone, so the test is retried.
  it('picks up a playbook written while the chat is open', { retry: 2, timeout: 20_000 }, async () => {
    const { ctx, repo, elsewhere, playbooks } = await boot()
    await expectView(ctx, { cwd: repo }, ['release', 'triage'])

    await mkdir(join(playbooks, 'handover'), { recursive: true })
    await writeFile(join(playbooks, 'handover', 'SKILL.md'), manifest('handover'))
    await expectView(ctx, { cwd: repo }, ['handover', 'release', 'triage'])
    await expectView(ctx, { cwd: elsewhere }, ['release', 'triage'])
  })
})

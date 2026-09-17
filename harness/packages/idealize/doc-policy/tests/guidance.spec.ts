/**
 * Documentation as core knowledge: the standing prompt section reaches every
 * chat (with a folder and without one), a
 * repository with no project note is told how to create one, and an annotated
 * `repo:` pointer still finds its repository.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as docPolicy from '../src/index.ts'
import { DOCUMENTATION_SECTION_NAME, DOCUMENTATION_SECTION_ORDER, noteForRepo, projectNoteFor, repoPaths } from '../src/index.ts'

const run = promisify(execFile)

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function scratch(): Promise<{ vault: string; repo: string }> {
  root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-doc-guidance-')))
  const vault = join(root, 'vault')
  const repo = join(root, 'repo')
  await mkdir(vault, { recursive: true })
  await mkdir(repo, { recursive: true })
  await run('git', ['-C', repo, 'init', '-q'])
  return { vault, repo }
}

async function compose(config: docPolicy.DocPolicyConfig): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt, { persona: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(docPolicy, config)
  return ctx
}

const prompt = async (ctx: Context): Promise<string> => renderPrompt(await ctx.systemPrompt.assemble({}))

/** Emit a session start for `cwd` and return every notice the plugin injected. */
async function startSession(ctx: Context, cwd: string): Promise<string[]> {
  const injected: string[] = []
  const agent = {
    session: { header: { cwd } },
    inject: (message: { content: Array<{ text: string }> }) => { injected.push(message.content[0]!.text) },
  }
  ctx.emit('agent/session-start', { agent } as never)
  await vi.waitFor(() => { expect(injected.length).toBe(1) })
  return injected
}

describe('the standing documentation section', () => {
  it('names the folder, the rule, the layout and the search tool in every prompt', async () => {
    const { vault } = await scratch()
    const ctx = await compose({ documentationFolder: vault })
    // Scans run on one chain, so this also waits out the init scan's scaffold.
    await ctx.docPolicy.scan()
    await vi.waitFor(async () => { expect(await prompt(ctx)).toContain(vault) })
    const text = await prompt(ctx)
    expect(text).toContain(`The user's documentation folder is ${vault}.`)
    expect(text).toContain('Write every piece of project documentation there')
    expect(text).toContain('Projects/<name>/ anchored by _index.md')
    expect(text).toContain('Read CONVENTIONS.md at the folder root before your first write')
    expect(text).toContain('docs_search')
    const names = (await ctx.systemPrompt.assemble({})).sections.map(section => section.name)
    expect(names).toContain(DOCUMENTATION_SECTION_NAME)
    expect(DOCUMENTATION_SECTION_ORDER).toBe(122)
  }, 30_000)

  it('tells a chat with no folder set to ask before writing documentation', async () => {
    const ctx = await compose({})
    await vi.waitFor(async () => { expect(await prompt(ctx)).toContain('No documentation folder is set') })
    expect(await prompt(ctx)).toContain('ask the user to choose their documentation folder in Settings')
  }, 30_000)
})

describe('session-start documentation context', () => {
  it('tells a repository with no note how to create one', async () => {
    const { vault, repo } = await scratch()
    const ctx = await compose({ documentationFolder: vault })
    await ctx.docPolicy.scan()
    const [notice] = await startSession(ctx, repo)
    expect(notice).toContain(`holds no project note for this repository (${repo})`)
    expect(notice).toContain(join(vault, 'templates', 'project-index.md'))
    expect(notice).toContain(`set its \`repo:\` field to ${repo}`)
    expect(notice).toContain('# Vault conventions')
  }, 30_000)

  it('hands over the project note when the pointer carries an annotation', async () => {
    const { vault, repo } = await scratch()
    const ctx = await compose({ documentationFolder: vault })
    await ctx.docPolicy.scan()
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(
      join(vault, 'Projects', 'acme', '_index.md'),
      projectNoteFor('acme', `${repo} (V1); V0 frozen at /nowhere/acme-v0`, '2026-09-17')
        .replace('## State\n', '## State\n\nWaiting on the heliotrope pigment decision.\n'),
    )
    expect((await noteForRepo(vault, repo))?.path).toBe(join(vault, 'Projects', 'acme', '_index.md'))
    const [notice] = await startSession(ctx, repo)
    expect(notice).toContain('Documentation context for this project')
    expect(notice).toContain('heliotrope pigment')
  }, 30_000)
})

describe('terminal knowledge', () => {
  it('names the project note for a known repository, the way to create one for an unknown one, and only the rule outside a repository', async () => {
    const { vault, repo } = await scratch()
    const ctx = await compose({ documentationFolder: vault })
    await ctx.docPolicy.scan()
    const unknown = await ctx.docPolicy.terminalKnowledge(repo)
    expect(unknown).toContain(`The user's documentation folder is ${vault}.`)
    expect(unknown).toContain(`Search ${vault} (rg or grep) for an existing note`)
    expect(unknown).not.toContain('docs_search')
    expect(unknown).toContain(`holds no project note for this repository (${repo})`)

    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    const note = join(vault, 'Projects', 'acme', '_index.md')
    await writeFile(note, projectNoteFor('acme', repo, '2026-09-17'))
    expect(await ctx.docPolicy.terminalKnowledge(repo)).toContain(`This project's note is ${note}.`)

    const outside = await ctx.docPolicy.terminalKnowledge(tmpdir())
    expect(outside).toContain('Write every piece of project documentation there')
    expect(outside).not.toContain('project note')
  }, 30_000)

  it('tells the agent to ask for a folder when none is set', async () => {
    const ctx = await compose({})
    expect(await ctx.docPolicy.terminalKnowledge(tmpdir())).toContain('No documentation folder is set')
  }, 30_000)
})

describe('repoPaths', () => {
  it('reads a plain pointer as itself, spaces included', () => {
    expect(repoPaths('/Users/me/_AppDev/EQTR2026 Sketch')).toEqual(['/Users/me/_AppDev/EQTR2026 Sketch'])
  })

  it('reads every checkout an annotated pointer names', () => {
    expect(repoPaths('/Users/me/dev/app (V1); V0 frozen at /Users/me/old/app')).toEqual([
      '/Users/me/dev/app (V1)',
      '/Users/me/dev/app',
      '/Users/me/old/app',
    ])
  })

  it('expands a home-relative pointer and ignores text with no path', () => {
    expect(repoPaths('~/code/short-name')).toEqual([join(homedir(), 'code/short-name')])
    expect(repoPaths('not cloned yet')).toEqual([])
  })
})

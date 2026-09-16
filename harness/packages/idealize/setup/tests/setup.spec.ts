// Composition smoke for SET-02/04/06 and the alias seam: over a real
// settings document, storage domain, workspace registry, doc-policy, and
// vault, orientation probes both folders, creates and registers the first
// project under the projects root, persists the aliases + seeds, and kicks
// the documentation scan; the alias routes serve the later Reconnect flow.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import * as docPolicy from '@idealize/doc-policy'
import * as vault from '@idealize/vault'
import * as skills from '@idealize/skills'
import * as setup from '../src/index.ts'
import { AliasProbeError } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the real composition over a scratch home; `web` adds the HTTP server. */
async function boot(web = false) {
  root = await mkdtemp(join(tmpdir(), 'idealize-setup-comp-'))
  const projects = join(root, 'projects')
  const docs = join(root, 'docs')
  await mkdir(projects, { recursive: true })
  await mkdir(docs, { recursive: true })

  const ctx = new Context()
  context = ctx
  await ctx.plugin(FileSettingsProvider, { path: join(root, 'settings.yaml'), watch: false })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('sessionPersistence', {
    list: async () => [],
    load: () => { throw new Error('unused') },
    inspect: () => { throw new Error('unused') },
  } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(docPolicy, {})
  await ctx.plugin(vault, {})
  await ctx.plugin(skills, {})
  if (web) await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(setup)

  // The alias service registers its settings section under inject; wait for it.
  const deadline = Date.now() + 5_000
  while (ctx.settings.get(settingsNamespace('idealize-setup')) === undefined) {
    if (Date.now() > deadline) throw new Error('idealize-setup settings section never registered')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return { ctx, projects, docs }
}

describe('orientation (SET-02/04/06)', () => {
  it('persists aliases, creates the first project, seeds doc-policy and vault, and scans', async () => {
    const { ctx, projects, docs } = await boot()

    const result = await ctx.workspaceAliases.orient({
      projectsFolder: projects,
      documentationFolder: docs,
      projectName: 'My first project',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected orientation success')
    expect(result.project?.path).toBe(join(projects, 'My first project'))

    // The project folder exists and is a registered workspace.
    const registered = ctx.workspaceRegistry.list().find(workspace => workspace.id === result.project?.workspaceId)
    expect(registered).toBeDefined()

    // The section carries both aliases and the orientation seed.
    const section = ctx.settings.get(settingsNamespace('idealize-setup')) as setup.SetupSettings
    expect(section.orientationDone).toBe(true)
    expect(section.aliases).toEqual({ projectsRoot: projects, documentation: docs })

    // Seeds landed in the dependent sections (SET-06) …
    expect((ctx.settings.get(settingsNamespace('idealize-docs')) as { documentationFolder?: string }).documentationFolder).toBe(docs)
    expect((ctx.settings.get(settingsNamespace('idealize-vault')) as { projectsRoot?: string }).projectsRoot).toBe(projects)

    // … and the kicked scan scaffolded + indexed the vault.
    expect(ctx.docPolicy.folder()).toBe(docs)
    const state = ctx.docPolicy.state()
    expect(state.configured).toBe(true)
    expect(state.lastScan).toBeDefined()
    expect((await readFile(join(root!, 'settings.yaml'), 'utf8'))).toContain('idealize-setup')

    // state() reports the components + live-probed aliases.
    const setupState = await ctx.workspaceAliases.state()
    expect(setupState.components.orientation.done).toBe(true)
    expect(setupState.components.models.done).toBe(false)
    expect(setupState.aliases.projectsRoot).toMatchObject({ path: projects, accessState: 'ok' })
    expect(setupState.aliases.documentation).toMatchObject({ path: docs, accessState: 'ok' })
  }, 30_000)

  it('refuses a broken folder with a plain reason and persists nothing (SET-04)', async () => {
    const { ctx, docs } = await boot()
    const gone = join(root!, 'not-there')

    const result = await ctx.workspaceAliases.orient({ projectsFolder: gone, documentationFolder: docs })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected orientation failure')
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ field: 'projectsFolder', accessState: 'missing' })
    expect(result.failures[0]!.reason).toContain(gone)
    expect(result.failures[0]!.reason).toContain('There is no folder at')

    const section = ctx.settings.get(settingsNamespace('idealize-setup')) as setup.SetupSettings
    expect(section.orientationDone).not.toBe(true)
    expect(ctx.docPolicy.folder()).toBeUndefined()
  }, 30_000)

  it('refuses a multi-segment project name', async () => {
    const { ctx, projects, docs } = await boot()
    const result = await ctx.workspaceAliases.orient({
      projectsFolder: projects,
      documentationFolder: docs,
      projectName: 'a/b',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.failures[0]).toMatchObject({ field: 'projectName' })
  }, 30_000)
})

describe('the workspace-alias seam', () => {
  it('resolve() reports the live access state of a stored alias', async () => {
    const { ctx, projects, docs } = await boot()
    await ctx.workspaceAliases.orient({ projectsFolder: projects, documentationFolder: docs })

    await rm(docs, { recursive: true, force: true })
    const alias = await ctx.workspaceAliases.resolve('documentation')
    expect(alias).toMatchObject({ name: 'documentation', path: docs, accessState: 'missing' })
    expect(alias?.reason).toContain(docs)
    expect(await ctx.workspaceAliases.resolve('projectsRoot')).toMatchObject({ accessState: 'ok' })
  }, 30_000)

  it('set() re-points an alias, re-seeds its dependent section, and rescans', async () => {
    const { ctx, projects, docs } = await boot()
    await ctx.workspaceAliases.orient({ projectsFolder: projects, documentationFolder: docs })

    const moved = join(root!, 'docs-moved')
    await mkdir(moved, { recursive: true })
    const alias = await ctx.workspaceAliases.set('documentation', moved)
    expect(alias).toEqual({ name: 'documentation', path: moved, accessState: 'ok' })
    expect(ctx.docPolicy.folder()).toBe(moved)
    // The sibling alias survived the merge write.
    expect(await ctx.workspaceAliases.resolve('projectsRoot')).toMatchObject({ path: projects })
  }, 30_000)

  it("set('skills') seeds the idealize-skills section and reports through state()", async () => {
    const { ctx } = await boot()
    const folder = join(root!, 'skills')
    await mkdir(folder, { recursive: true })
    const alias = await ctx.workspaceAliases.set('skills', folder)
    expect(alias).toEqual({ name: 'skills', path: folder, accessState: 'ok' })
    expect(ctx.settings.get(settingsNamespace('idealize-skills'))).toMatchObject({ skillsFolder: folder })
    expect((await ctx.workspaceAliases.state()).aliases.skills).toMatchObject({ path: folder, accessState: 'ok' })
  }, 30_000)

  it('set() rejects a failing folder with the probe verdict and stores nothing', async () => {
    const { ctx, projects, docs } = await boot()
    await ctx.workspaceAliases.orient({ projectsFolder: projects, documentationFolder: docs })

    const gone = join(root!, 'gone')
    const rejection = await ctx.workspaceAliases.set('documentation', gone).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(AliasProbeError)
    expect((rejection as AliasProbeError).accessState).toBe('missing')
    expect((rejection as AliasProbeError).message).toContain(gone)
    expect(ctx.docPolicy.folder()).toBe(docs)
  }, 30_000)
})

describe('the /idealize/setup routes', () => {
  it('serves state, fences mutations, and runs orientation over HTTP', async () => {
    const { ctx, projects, docs } = await boot(true)
    const origin = `http://127.0.0.1:${ctx.webServer.port}`

    // GET state before orientation.
    const before = await (await fetch(`${origin}/idealize/setup/state`)).json() as setup.SetupState
    expect(before.components.orientation.done).toBe(false)
    expect(before.aliases).toEqual({})

    // The mutation demands the auth header.
    const unfenced = await fetch(`${origin}/idealize/setup/orientation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectsFolder: projects, documentationFolder: docs }),
    })
    expect(unfenced.status).toBe(403)

    const headers = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

    // Wire-boundary refusals name the offending field.
    const badWire = await fetch(`${origin}/idealize/setup/orientation`, {
      method: 'POST', headers, body: JSON.stringify({ projectsFolder: projects }),
    })
    expect(badWire.status).toBe(400)
    expect(((await badWire.json()) as { error: string }).error).toContain('documentationFolder')

    // A failing folder answers 400 with the plain per-field reasons.
    const badFolder = await fetch(`${origin}/idealize/setup/orientation`, {
      method: 'POST', headers, body: JSON.stringify({ projectsFolder: join(root!, 'nope'), documentationFolder: docs }),
    })
    expect(badFolder.status).toBe(400)
    const failure = await badFolder.json() as { ok: boolean; failures: { field: string; reason: string }[] }
    expect(failure.ok).toBe(false)
    expect(failure.failures[0]!.reason).toContain('There is no folder at')

    // The happy path persists and reports the created project.
    const happy = await fetch(`${origin}/idealize/setup/orientation`, {
      method: 'POST', headers, body: JSON.stringify({ projectsFolder: projects, documentationFolder: docs, projectName: 'Alpha' }),
    })
    expect(happy.status).toBe(200)
    const outcome = await happy.json() as { ok: boolean; project?: { workspaceId: string; path: string } }
    expect(outcome.ok).toBe(true)
    expect(outcome.project?.path).toBe(join(projects, 'Alpha'))

    // The alias route is a mutation: without the header it never reaches the seam.
    const unheaded = await fetch(`${origin}/idealize/setup/alias`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'documentation', path: docs }),
    })
    expect(unheaded.status).toBe(403)

    // The alias route re-points the documentation folder (the Reconnect flow).
    const moved = join(root!, 'docs-two')
    await mkdir(moved)
    const reconnect = await fetch(`${origin}/idealize/setup/alias`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'documentation', path: moved }),
    })
    expect(reconnect.status).toBe(200)
    expect(ctx.docPolicy.folder()).toBe(moved)

    const refused = await fetch(`${origin}/idealize/setup/alias`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'documentation', path: join(root!, 'gone') }),
    })
    expect(refused.status).toBe(400)
    const refusal = await refused.json() as { ok: boolean; failure: { accessState: string; reason: string } }
    expect(refusal.failure.accessState).toBe('missing')
    expect(refusal.failure.reason).toContain('There is no folder at')
  }, 30_000)
})

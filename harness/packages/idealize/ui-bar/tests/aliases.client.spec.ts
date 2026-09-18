/**
 * The Files pane's four tabs and the fence behind them. Over a real settings
 * document, workspace registry, alias seam and web server,
 * `GET /idealize/bar/aliases` reports the current project, the projects root
 * and the documentation vault with their live access state, and the listing
 * fence widens to the captured alias folders and to nothing else.
 *
 * Two collaborators stand in, both because their real implementations are
 * host-only packages a client-aggregate suite cannot compose: the workspace
 * registry (which needs the storage-domain stack) is a `list()` stub, and the
 * alias write `POST /idealize/setup/alias` — the Reconnect target, which
 * re-seeds the doc-policy and vault sections — is covered by @idealize/setup's
 * own suite. Everything the fence itself depends on is real.
 */
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as setup from '@idealize/setup'
import * as uiBar from '../src/index.ts'

/** One tab as the route reports it. */
interface AliasTabWire {
  id: string
  alias?: string
  roots: { name: string; path: string }[]
  state: string
  reason?: string
}

/**
 * The smallest real settings provider: the alias seam needs a registered
 * section to store into, and this suite needs no file on disk.
 */
class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const SETUP_NS = settingsNamespace(setup.SETUP_SETTINGS_NAMESPACE)

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot the composition over a scratch home. The scratch root is
 * realpath-resolved up front so the temp directory's own symlink (macOS puts
 * `/var/folders` behind `/private/var`) cannot be mistaken for a fence bug.
 */
async function boot() {
  root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-bar-aliases-')))
  const projects = join(root, 'projects')
  const project = join(projects, 'Alpha')
  const docs = join(root, 'vault')
  const skills = join(root, 'skills')
  const outside = join(root, 'outside')
  await mkdir(project, { recursive: true })
  await mkdir(docs, { recursive: true })
  await mkdir(skills, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(docs, 'CONVENTIONS.md'), '# vault\n')
  await writeFile(join(outside, 'secret.txt'), 'private\n')

  const ctx = new Context()
  context = ctx
  const workspaces: { title: string; path: string }[] = []
  await ctx.plugin(MemorySettings)
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(setup)
  await ctx.plugin(uiBar)

  const deadline = Date.now() + 5_000
  while (ctx.settings.get(SETUP_NS) === undefined) {
    if (Date.now() > deadline) throw new Error('idealize-setup settings section never registered')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return { ctx, workspaces, projects, project, docs, skills, outside, origin: `http://127.0.0.1:${ctx.webServer.port}` }
}

/**
 * Put the composition in its post-first-run state: one registered project and
 * every alias folder captured. Written straight to the durable section, since
 * `orient()` also seeds the doc-policy and vault sections this suite does not
 * compose.
 */
async function captureFirstRun(
  ctx: Context,
  workspaces: { title: string; path: string }[],
  paths: { project: string; projects: string; docs: string; skills: string },
): Promise<void> {
  workspaces.push({ title: 'Alpha', path: paths.project })
  await ctx.settings.update(SETUP_NS, {
    aliases: { projectsRoot: paths.projects, documentation: paths.docs, skills: paths.skills },
  })
}

/** The four tabs, keyed by id. */
async function tabsOf(origin: string): Promise<Record<string, AliasTabWire>> {
  const response = await fetch(`${origin}/idealize/bar/aliases`)
  expect(response.status).toBe(200)
  const body = await response.json() as { tabs: AliasTabWire[] }
  return Object.fromEntries(body.tabs.map(tab => [tab.id, tab]))
}

describe('GET /idealize/bar/aliases', () => {
  it('reports the four tabs, live-probed, before and after first run', async () => {
    const { ctx, workspaces, projects, project, docs, skills, origin } = await boot()

    // Before orientation every alias tab stands with nothing to browse.
    const cold = await tabsOf(origin)
    expect(Object.keys(cold)).toEqual(['project', 'projectsRoot', 'documentation', 'skills'])
    expect(cold.projectsRoot!.state).toBe('unset')
    expect(cold.projectsRoot!.alias).toBe('projectsRoot')
    expect(cold.documentation!.roots).toEqual([])
    expect(cold.skills!.state).toBe('unset')
    expect(cold.skills!.alias).toBe('skills')

    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })

    const warm = await tabsOf(origin)
    expect(warm.project!.roots.map(entry => entry.path)).toEqual([project])
    expect(warm.project!.alias).toBeUndefined()
    expect(warm.projectsRoot!.state).toBe('ok')
    expect(warm.projectsRoot!.roots).toEqual([{ name: 'projects', path: projects }])
    expect(warm.documentation!.roots).toEqual([{ name: 'vault', path: docs }])
    expect(warm.skills!.state).toBe('ok')
    expect(warm.skills!.roots).toEqual([{ name: 'skills', path: skills }])
  }, 30_000)

  it('keeps a dead alias tab with the plain reason the Reconnect card shows', async () => {
    const { ctx, workspaces, projects, project, docs, skills, origin } = await boot()
    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })
    await rm(docs, { recursive: true, force: true })

    const tabs = await tabsOf(origin)
    expect(tabs.documentation!.state).toBe('missing')
    expect(tabs.documentation!.alias).toBe('documentation')
    expect(tabs.documentation!.roots).toEqual([])
    expect(tabs.documentation!.reason).toContain('There is no folder at')
  }, 30_000)

  it('refuses a request that did not arrive on loopback', async () => {
    const { ctx } = await boot()
    // fetch() forbids overriding Host, so the off-loopback request goes out
    // over node:http, which does not.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: ctx.webServer.port,
        path: '/idealize/bar/aliases',
        headers: { host: 'evil.example' },
      }, (response) => { resolve(response.statusCode ?? 0); response.resume() })
      request.on('error', reject)
      request.end()
    })
    expect(status).toBe(403)
  }, 30_000)
})

describe('GET /idealize/bar/skills', () => {
  it('lists the skills folder\'s catalogue by subfolder, marking what the registry offers, and nothing without the catalogue', async () => {
    const { ctx, origin } = await boot()
    const cold = await fetch(`${origin}/idealize/bar/skills`)
    expect(cold.status).toBe(200)
    expect(await cold.json()).toEqual({ groups: [] })

    const summary = (name: string, provider: string, userInvocable = true) => ({
      name, description: `${name} description`, provider, invocation: { modelInvocable: true, userInvocable }, source: 'test',
    })
    const entry = (name: string, manifest = true) => ({ package: name, name, description: `${name} in folder`, manifest })
    ctx.provide('idealizeSkills', {
      catalogue: () => Promise.resolve([
        { folder: '', skills: [entry('alpha'), entry('hidden')] },
        { folder: 'Codex', skills: [entry('alpha'), entry('zeta')] },
        { folder: 'claude', skills: [entry('Bad Name', false)] },
      ]),
    } as never)
    // Without a registry every package is listed and none is offered.
    const unregistered = await (await fetch(`${origin}/idealize/bar/skills`)).json() as { groups: { skills: { invocable: boolean }[] }[] }
    expect(unregistered.groups.flatMap(group => group.skills.map(skill => skill.invocable))).toEqual([false, false, false, false, false])

    ctx.provide('skills', {
      list: () => Promise.resolve([
        summary('zeta', 'idealize-skills'),
        summary('global-one', 'skill-filesystem'),
        summary('alpha', 'idealize-skills'),
        summary('hidden', 'idealize-skills', false),
      ]),
    } as never)
    const warm = await fetch(`${origin}/idealize/bar/skills`)
    expect(await warm.json()).toEqual({
      groups: [
        { folder: '', skills: [
          { name: 'alpha', description: 'alpha in folder', invocable: true },
          { name: 'hidden', description: 'hidden in folder', invocable: false },
        ] },
        { folder: 'Codex', skills: [
          { name: 'alpha', description: 'alpha in folder', invocable: true },
          { name: 'zeta', description: 'zeta in folder', invocable: true },
        ] },
        { folder: 'claude', skills: [{ name: 'Bad Name', description: 'Bad Name in folder', invocable: false }] },
      ],
    })
  }, 30_000)
})

describe('the listing fence', () => {
  it('lists inside every alias and refuses everything outside them', async () => {
    const { ctx, workspaces, projects, project, docs, skills, outside, origin } = await boot()
    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })

    const list = (path: string) => fetch(`${origin}/idealize/bar/files?path=${encodeURIComponent(path)}`)

    // The workspace root, the projects root and the vault all list.
    for (const inside of [project, projects, docs]) {
      const response = await list(inside)
      expect([inside, response.status]).toEqual([inside, 200])
    }

    // A sibling folder under no alias and no workspace root is refused, as is
    // a file inside it through the viewer route.
    const refused = await list(outside)
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { error: string }).error).toContain('outside')

    const viewer = await fetch(`${origin}/idealize/bar/file?path=${encodeURIComponent(join(outside, 'secret.txt'))}`)
    expect(viewer.status).toBe(403)

    // The parent of every root is refused too: the fence is a prefix check on
    // the resolved path, not a containment test on the request.
    expect((await list(root!)).status).toBe(403)
    expect((await list('/')).status).toBe(403)
  }, 30_000)

  it('stays closed while no alias is captured', async () => {
    const { origin, docs } = await boot()
    const response = await fetch(`${origin}/idealize/bar/files?path=${encodeURIComponent(docs)}`)
    expect(response.status).toBe(403)
  }, 30_000)

  it('refuses a symlink that escapes every root, and follows one that does not', async () => {
    const { ctx, workspaces, projects, project, docs, skills, outside, origin } = await boot()
    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })
    await symlink(outside, join(docs, 'escape'), 'dir')
    await symlink(project, join(docs, 'sideways'), 'dir')

    const escape = await fetch(`${origin}/idealize/bar/files?path=${encodeURIComponent(join(docs, 'escape'))}`)
    expect(escape.status).toBe(403)

    const sideways = await fetch(`${origin}/idealize/bar/files?path=${encodeURIComponent(join(docs, 'sideways'))}`)
    expect(sideways.status).toBe(200)
  }, 30_000)

  it('writes, renames, duplicates and moves inside the fence, and refuses the rest', async () => {
    const { ctx, workspaces, projects, project, docs, skills, outside, origin } = await boot()
    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })
    const post = async (route: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
      const response = await fetch(`${origin}/idealize/bar/${route}`, {
        method: 'POST', headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() as Record<string, unknown> }
    }
    const note = join(project, 'note.txt')
    await writeFile(note, 'hello')
    // write: the size the editor loaded must still hold.
    expect((await post('write', { path: note, text: 'hello world', expectedSize: 5 })).status).toBe(200)
    expect(await readFile(note, 'utf8')).toBe('hello world')
    expect((await post('write', { path: note, text: 'x', expectedSize: 5 })).status).toBe(409)
    expect((await post('write', { path: join(outside, 'secret.txt'), text: 'x' })).status).toBe(403)
    // rename: one component, no climbing, no clobbering.
    expect((await post('rename', { path: note, name: '../escape.txt' })).status).toBe(422)
    const renamed = await post('rename', { path: note, name: 'ideas.txt' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.path).toBe(join(project, 'ideas.txt'))
    await writeFile(join(project, 'taken.txt'), '')
    expect((await post('rename', { path: join(project, 'ideas.txt'), name: 'taken.txt' })).status).toBe(409)
    // duplicate: `name copy`, then `name copy 2`.
    expect((await post('duplicate', { path: join(project, 'ideas.txt') })).body.path).toBe(join(project, 'ideas copy.txt'))
    expect((await post('duplicate', { path: join(project, 'ideas.txt') })).body.path).toBe(join(project, 'ideas copy 2.txt'))
    expect(await readFile(join(project, 'ideas copy 2.txt'), 'utf8')).toBe('hello world')
    // move: into a fenced folder (the vault), never into itself, never outside.
    const moved = await post('move', { path: join(project, 'ideas copy.txt'), parent: docs })
    expect(moved.status).toBe(200)
    expect(await readFile(join(docs, 'ideas copy.txt'), 'utf8')).toBe('hello world')
    await mkdir(join(project, 'nest'))
    expect((await post('move', { path: join(project, 'nest'), parent: join(project, 'nest') })).status).toBe(422)
    expect((await post('move', { path: join(project, 'ideas.txt'), parent: outside })).status).toBe(403)
    expect((await post('move', { path: join(outside, 'secret.txt'), parent: project })).status).toBe(403)
    // The capabilities row says whether the Finder is there to trash into.
    const capabilities = await (await fetch(`${origin}/idealize/bar/capabilities`)).json() as { trash: boolean }
    expect(capabilities.trash).toBe(process.platform === 'darwin')
  }, 30_000)

  it('demands the auth header on the mutating route the pane calls', async () => {
    const { ctx, workspaces, projects, project, docs, skills, origin } = await boot()
    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })

    const create = await fetch(`${origin}/idealize/bar/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent: docs, name: 'note.md', kind: 'file' }),
    })
    expect(create.status).toBe(403)
  }, 30_000)
})

describe("a project's documentation folder", () => {
  it('reports each project, lists a chosen folder outside the vault, and adds it to All documentation', async () => {
    const { ctx, workspaces, projects, project, docs, skills, outside, origin } = await boot()
    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })
    const read = async () => await (await fetch(`${origin}/idealize/bar/aliases`)).json() as {
      tabs: AliasTabWire[]
      projectDocs: { project: { name: string; path: string }; folder?: string; source?: string; state: string; reason?: string }[]
    }

    // No doc-policy in this composition and nothing chosen: the project has no folder yet.
    expect((await read()).projectDocs).toEqual([{ project: { name: 'Alpha', path: project }, state: 'unset' }])
    expect((await fetch(`${origin}/idealize/bar/files?path=${encodeURIComponent(outside)}`)).status).toBe(403)

    await ctx.workspaceAliases.setProjectDocumentation(project, outside)
    const chosen = await read()
    expect(chosen.projectDocs).toEqual([{ project: { name: 'Alpha', path: project }, folder: outside, source: 'chosen', state: 'ok' }])
    expect(chosen.tabs.find(tab => tab.id === 'documentation')!.roots).toEqual([
      { name: 'vault', path: docs },
      { name: 'Alpha · outside', path: outside },
    ])
    // The fence widens to the chosen folder, so its tree lists.
    const listed = await fetch(`${origin}/idealize/bar/files?path=${encodeURIComponent(outside)}`)
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { entries: { name: string }[] }).entries.map(entry => entry.name)).toEqual(['secret.txt'])

    // A chosen folder inside the vault is already under All documentation.
    await mkdir(join(docs, 'Projects', 'Alpha'), { recursive: true })
    await ctx.workspaceAliases.setProjectDocumentation(project, join(docs, 'Projects', 'Alpha'))
    expect((await read()).tabs.find(tab => tab.id === 'documentation')!.roots).toEqual([{ name: 'vault', path: docs }])

    // A chosen folder that dies keeps its path and says why.
    await ctx.workspaceAliases.setProjectDocumentation(project, outside)
    await rm(outside, { recursive: true, force: true })
    const dead = (await read()).projectDocs[0]!
    expect(dead).toMatchObject({ folder: outside, source: 'chosen', state: 'missing' })
    expect(dead.reason).toContain(outside)
  }, 30_000)
})

describe('POST /idealize/bar/open', () => {
  it.runIf(process.platform === 'darwin')('hands a fenced file to the default application and refuses what the system would run', async () => {
    const { ctx, workspaces, projects, project, docs, skills, outside, origin } = await boot()
    await captureFirstRun(ctx, workspaces, { project, projects, docs, skills })
    const opened: string[] = []
    const launcher = vi.spyOn(uiBar.defaultApplication, 'open').mockImplementation((target) => {
      opened.push(target)
      return Promise.resolve(target.endsWith('.nothing') ? 1 : 0)
    })
    const post = (path: string, headers: Record<string, string> = { 'x-idealize-auth': '1' }) =>
      fetch(`${origin}/idealize/bar/open`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ path }),
      })
    try {
      await writeFile(join(project, 'brief.pdf'), '%PDF')
      await writeFile(join(project, 'run.command'), '#!/bin/sh\n')
      await writeFile(join(project, 'tool'), '#!/bin/sh\n')
      await chmod(join(project, 'tool'), 0o755)
      await writeFile(join(project, 'LICENSE'), 'MIT\n')
      await writeFile(join(project, 'odd.nothing'), '')

      expect((await post(join(project, 'brief.pdf'), {})).status).toBe(403)
      expect((await post(join(project, 'brief.pdf'))).status).toBe(200)
      expect((await post(join(project, 'LICENSE'))).status).toBe(200)
      expect(opened).toEqual([join(project, 'brief.pdf'), join(project, 'LICENSE')])

      expect((await post(join(outside, 'secret.txt'))).status).toBe(403)
      expect((await post(join(project, 'run.command'))).status).toBe(422)
      expect((await post(join(project, 'tool'))).status).toBe(422)
      expect((await post(project)).status).toBe(422)
      expect(opened).toHaveLength(2)

      // No application claims the type: the pane falls back to its own viewer.
      expect((await post(join(project, 'odd.nothing'))).status).toBe(422)

      const capabilities = await (await fetch(`${origin}/idealize/bar/capabilities`)).json() as { openExternal: boolean }
      expect(capabilities.openExternal).toBe(true)
    } finally {
      launcher.mockRestore()
    }
  }, 30_000)
})

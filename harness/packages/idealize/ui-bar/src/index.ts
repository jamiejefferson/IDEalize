/**
 * @idealize/ui-bar — Host half of the IDEalize toggle bar.
 *
 * Serves the loopback JSON the browser half consumes:
 * - `GET  /idealize/bar/capabilities` — which optional destinations exist here
 *   (the desktop shell's terminal, macOS reveal-in-Finder).
 * - `GET  /idealize/bar/files[?path=]` — workspace file listing; without a
 *   path the workspace roots, with one the entries of a directory FENCED to
 *   the registered workspace roots PLUS the captured workspace-alias folders
 *   (realpath prefix check).
 * - `GET  /idealize/bar/aliases` — the Files pane's three tabs: the current
 *   project (workspace roots), the projects root, and the documentation
 *   vault, each with its live access state so a dead alias keeps its tab and
 *   offers Reconnect.
 * - `GET  /idealize/bar/browse[?path=]` — the second file window's listing:
 *   the home root without a path, a directory's entries with one, FENCED to
 *   home plus the workspace roots plus the alias folders.
 * - `GET  /idealize/bar/file?path=` — file content for the viewer (text as a
 *   JSON envelope, size-capped), same home-plus-roots fence.
 * - `GET  /idealize/bar/raw?path=` — raw image bytes for the viewer's img
 *   tags, image extensions only, same fence.
 * - `POST /idealize/bar/terminal` — open the desktop shell's terminal when
 *   its action service is composed (desktop app only).
 * - `POST /idealize/bar/reveal` — reveal a fenced path in the macOS Finder.
 * - `POST /idealize/bar/write` — overwrite a fenced text file (409 when its size moved).
 * - `POST /idealize/bar/rename`, `/duplicate`, `/move`, `/trash` — the Files
 *   pane's entry operations, every path checked against the viewer fence.
 * - `POST /idealize/bar/create` — create one file or folder inside a fenced
 *   parent directory (home-plus-roots fence; the name is a single validated
 *   path component).
 *
 * Same loopback + `x-idealize-auth` fence as the other /idealize routes.
 * @module @idealize/ui-bar
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { access, cp, mkdir, readFile, realpath, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
// Type-only: the `workspaceAliases` Context merge @idealize/setup declares.
import type {} from '@idealize/setup'
import type { WorkspaceAlias, WorkspaceAliasName } from '@idealize/setup'
import { SKILLS_PROVIDER_NAME, type IdealizeSkillsService } from '@idealize/skills'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** The desktop shell's settings section (restated; dsh-plugin-desktop owns the schema). */
const DESKTOP_NS = settingsNamespace('dsh-desktop')

/** Desktop shell presentation modes (restated from the desktop plugin; the pre-Askbar `mini` mode retired 2 Sep 2026). */
type ShellMode = 'compatibility' | 'advanced'

/** The desktop shell's narrow action face, present only under the Electron host. */
interface DesktopActionsLike {
  openTerminal(): void
  /** Move a path to the OS trash (Electron's `shell.trashItem`); absent on older shells. */
  trashItem?(path: string): Promise<void>
  /** Collapse the main window to the Askbar (the maxi→mini transform); absent on shells without the bar. */
  collapseToBar?(): Promise<void> | void
}

function refuse(req: IncomingMessage, res: ServerResponse, mutating: boolean): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

/** The host skill registry's face this package reads (structural: no dependency edge on dsh-skill). */
interface SkillRegistryLike {
  list(): Promise<readonly { name: string; description: string; provider: string; invocation: { userInvocable: boolean } }[]>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** One listed entry: directories first, then files, both name-sorted. */
interface FileEntry {
  name: string
  kind: 'dir' | 'file'
}

/** Viewer text cap: past this the envelope truncates rather than balloons. */
const TEXT_CAP_BYTES = 256 * 1024

/** Raw image cap: refuse anything larger outright. */
const RAW_CAP_BYTES = 20 * 1024 * 1024

/** Image extensions the raw route serves, with their MIME types. */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

/**
 * The Files pane's tabs, in header order. The project tab reads the workspace
 * registry; the other three read `ctx.workspaceAliases` (restated here — the
 * `WorkspaceAliasName` annotation fails the build if @idealize/setup's alias
 * vocabulary ever drifts from these three).
 */
const ALIAS_TABS: readonly WorkspaceAliasName[] = ['projectsRoot', 'documentation', 'skills']

/** One tab's tree roots, as the panel's `LazyTree` takes them. */
interface RootEntry {
  name: string
  path: string
}

/**
 * One Files tab. `state` is the live probe verdict for an alias-backed tab
 * and `'unset'` before first run captured it; the project tab is `'ok'` with
 * the registered workspaces as its roots. A tab whose state is not `ok`
 * still renders — the panel offers Reconnect against `alias`.
 */
interface AliasTab {
  id: 'project' | WorkspaceAliasName
  /** The alias behind the tab; absent on the project tab. */
  alias?: WorkspaceAliasName
  /** The tree roots; empty while the tab has nothing reachable to show. */
  roots: RootEntry[]
  /** Live access verdict, or `'unset'` when no folder has been captured. */
  state: WorkspaceAlias['accessState'] | 'unset'
  /** Plain-language explanation; present exactly when `state` is a failure. */
  reason?: string
}

/** Extensions that are binary but not images: no text preview attempted. */
const BINARY_EXT = new Set([
  '.zip', '.gz', '.tar', '.tgz', '.dmg', '.app', '.pdf', '.mp3', '.mp4', '.mov', '.wav', '.aac',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wasm', '.node', '.dylib', '.so', '.a', '.o',
  '.class', '.jar', '.exe', '.dll', '.bin', '.iso', '.sqlite', '.db', '.heic', '.psd', '.ai',
])

export function apply(ctx: Context): void {
  ctx.inject(['webServer', 'workspaceRegistry', 'settings'], (webCtx) => {
    /** Whether a realpath-resolved target sits at or under one of `roots`. */
    const insideRoots = (resolved: string, roots: readonly string[]): boolean =>
      roots.some(root => resolved === root || resolved.startsWith(root + sep))

    /**
     * The captured alias folders, realpath-resolved so a symlinked alias
     * fences its real location too. An unset alias, an alias whose folder is
     * gone, and a composition without @idealize/setup all contribute nothing:
     * the fence never widens past folders the user actually chose.
     */
    const aliasRoots = async (): Promise<string[]> => {
      const aliases = webCtx.get('workspaceAliases')
      if (aliases === undefined) return []
      const resolved = await Promise.all(ALIAS_TABS.map(name => aliases.resolve(name)))
      const roots: string[] = []
      for (const alias of resolved) {
        if (alias === undefined) continue
        try {
          roots.push(await realpath(alias.path))
        } catch {
          // Only a vanished or unreadable alias folder lands here; it fences
          // nothing, and its tab already shows Reconnect from the probe.
        }
      }
      return roots
    }

    /**
     * The project fence: the registered workspace roots plus the captured
     * alias folders (the Files tabs browse all three). Symlinks resolve
     * before the check, so a link that escapes every root is refused.
     */
    const fencedPath = async (raw: string): Promise<string | undefined> => {
      let resolved: string
      try {
        resolved = await realpath(raw)
      } catch {
        return undefined
      }
      const roots = [...webCtx.workspaceRegistry.list().map(workspace => workspace.path), ...await aliasRoots()]
      return insideRoots(resolved, roots) ? resolved : undefined
    }

    /**
     * The viewer/browse fence: home plus the workspace roots (a workspace can
     * live outside home) plus the alias folders (so a vault file opens in the
     * viewer). Symlinks resolve before the check, so a link that escapes them
     * all is refused.
     */
    const viewFencedPath = async (raw: string): Promise<string | undefined> => {
      let resolved: string
      try {
        resolved = await realpath(raw)
      } catch {
        return undefined
      }
      const roots = [
        homedir(),
        ...webCtx.workspaceRegistry.list().map(workspace => workspace.path),
        ...await aliasRoots(),
      ]
      return insideRoots(resolved, roots) ? resolved : undefined
    }

    /** Directory entries, dotfiles hidden, directories first. */
    const listEntries = async (target: string): Promise<FileEntry[]> => {
      const listed = await readdir(target, { withFileTypes: true })
      return listed
        .filter(entry => !entry.name.startsWith('.'))
        .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'dir' as const : 'file' as const }))
        .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)
    }

    type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
    const register = (path: string, mutating: boolean, handler: RouteHandler): void => {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            if (refuse(req, res, mutating)) return
            try {
              await handler(req, res)
            } catch (error) {
              sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        `idealize-bar: ${path}`,
      )
    }

    const desktopActions = (): DesktopActionsLike | undefined => {
      // ctx.get() is the sanctioned probe for a service this plugin does not
      // inject: plain property access on an undeclared service throws.
      const maybe = (webCtx as unknown as { get(name: string): unknown }).get('desktopActions')
      return typeof (maybe as DesktopActionsLike | undefined)?.openTerminal === 'function'
        ? maybe as DesktopActionsLike
        : undefined
    }

    /** Current desktop shell mode, or undefined outside the desktop shell. */
    const shellMode = (): ShellMode | undefined => {
      if (desktopActions() === undefined) return undefined
      const section = webCtx.settings.get(DESKTOP_NS) as { mode?: ShellMode } | undefined
      return section?.mode ?? 'compatibility'
    }

    register('/idealize/bar/capabilities', false, (_req, res) => {
      sendJson(res, 200, {
        terminal: desktopActions() !== undefined,
        reveal: process.platform === 'darwin',
        trash: typeof desktopActions()?.trashItem === 'function' || process.platform === 'darwin',
        shellMode: shellMode() ?? null,
      })
    })

    register('/idealize/bar/minimode', true, async (_req, res) => {
      // Mini mode IS the Askbar (JJ, 2 Sep 2026): the main window collapses
      // to the bar in place, no restart, no second window. Expanding back is
      // the bar's own affordance (`POST /idealize/askbar/transform`).
      const actions = desktopActions()
      if (actions?.collapseToBar === undefined) {
        sendJson(res, 409, { error: 'desktop shell with an Askbar not present' })
        return
      }
      await actions.collapseToBar()
      sendJson(res, 200, { ok: true })
    })

    register('/idealize/bar/terminal', true, (_req, res) => {
      const actions = desktopActions()
      if (actions === undefined) {
        sendJson(res, 409, { error: 'desktop shell not present' })
        return
      }
      actions.openTerminal()
      sendJson(res, 200, { ok: true })
    })

    register('/idealize/bar/reveal', true, async (req, res) => {
      if (process.platform !== 'darwin') {
        sendJson(res, 409, { error: 'reveal is macOS only' })
        return
      }
      const body = JSON.parse(await readBody(req)) as { path?: string }
      // The viewer fence, not the workspace fence: the browse pane's files
      // live under home and deserve the same reveal.
      const target = typeof body.path === 'string' ? await viewFencedPath(body.path) : undefined
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      spawn('/usr/bin/open', ['-R', target], { stdio: 'ignore', detached: true }).unref()
      sendJson(res, 200, { ok: true })
    })

    /** A single path component that cannot climb out of its parent (V0's createFolder rule). */
    const validName = (name: unknown): string | undefined => {
      if (typeof name !== 'string') return undefined
      const trimmed = name.trim()
      if (trimmed === '' || trimmed === '.' || trimmed === '..'
        || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) return undefined
      return trimmed
    }

    /** `name copy`, `name copy 2`, … keeping the extension: the first that does not exist. */
    const copyName = async (source: string): Promise<string> => {
      const parent = dirname(source)
      const isDir = (await stat(source)).isDirectory()
      const ext = isDir ? '' : extname(source)
      const stem = basename(source, ext)
      for (let n = 1; n < 1000; n += 1) {
        const candidate = join(parent, `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`)
        try {
          await access(candidate)
        } catch {
          // Nothing at that name: it is the copy's.
          return candidate
        }
      }
      throw new Error('no free copy name')
    }

    /**
     * Overwrite a fenced text file. `expectedSize` is the size the editor
     * loaded; a file that changed underneath it is refused with 409 so the
     * editor can reload instead of clobbering another writer.
     */
    register('/idealize/bar/write', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { path?: unknown; text?: unknown; expectedSize?: unknown }
      if (typeof body.path !== 'string' || typeof body.text !== 'string') {
        sendJson(res, 422, { error: 'expected { path, text, expectedSize? }' })
        return
      }
      const target = await viewFencedPath(body.path)
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      const before = await stat(target)
      if (!before.isFile()) {
        sendJson(res, 422, { error: 'not a file' })
        return
      }
      if (typeof body.expectedSize === 'number' && body.expectedSize !== before.size) {
        sendJson(res, 409, { error: 'the file changed on disk', size: before.size })
        return
      }
      await writeFile(target, body.text, 'utf8')
      sendJson(res, 200, { ok: true, size: Buffer.byteLength(body.text, 'utf8') })
    })

    /** Rename a fenced entry in place; the new name is one component. */
    register('/idealize/bar/rename', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { path?: unknown; name?: unknown }
      const name = validName(body.name)
      if (typeof body.path !== 'string' || name === undefined) {
        sendJson(res, 422, { error: 'expected { path, name }' })
        return
      }
      const target = await viewFencedPath(body.path)
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      const renamed = join(dirname(target), name)
      if (renamed === target) {
        sendJson(res, 200, { ok: true, path: target })
        return
      }
      try {
        await access(renamed)
        sendJson(res, 409, { error: 'already exists' })
        return
      } catch {
        // Nothing at the new name: the rename may proceed.
      }
      await rename(target, renamed)
      sendJson(res, 200, { ok: true, path: renamed })
    })

    /** Duplicate a fenced file or folder beside itself as `name copy`. */
    register('/idealize/bar/duplicate', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { path?: unknown }
      const target = typeof body.path === 'string' ? await viewFencedPath(body.path) : undefined
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      const copied = await copyName(target)
      await cp(target, copied, { recursive: true, errorOnExist: true, force: false })
      sendJson(res, 200, { ok: true, path: copied })
    })

    /** Move a fenced entry into a fenced folder (a drag between the trees). */
    register('/idealize/bar/move', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { path?: unknown; parent?: unknown }
      const source = typeof body.path === 'string' ? await viewFencedPath(body.path) : undefined
      const parent = typeof body.parent === 'string' ? await viewFencedPath(body.parent) : undefined
      if (source === undefined || parent === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      if (!(await stat(parent)).isDirectory()) {
        sendJson(res, 422, { error: 'parent is not a directory' })
        return
      }
      if (parent === source || parent.startsWith(`${source}${sep}`)) {
        sendJson(res, 422, { error: 'cannot move a folder into itself' })
        return
      }
      const moved = join(parent, basename(source))
      if (moved === source) {
        sendJson(res, 200, { ok: true, path: source })
        return
      }
      try {
        await access(moved)
        sendJson(res, 409, { error: 'already exists' })
        return
      } catch {
        // Nothing at the destination: the move may proceed.
      }
      await rename(source, moved)
      sendJson(res, 200, { ok: true, path: moved })
    })

    /**
     * Move a fenced entry to the OS trash, so it can be put back: through the
     * desktop shell's `trashItem` where the app runs in it, else by asking
     * the Finder (macOS only; the first call raises the automation prompt).
     */
    register('/idealize/bar/trash', true, async (req, res) => {
      const actions = desktopActions()
      if (typeof actions?.trashItem !== 'function' && process.platform !== 'darwin') {
        sendJson(res, 409, { error: 'no trash on this platform outside the desktop shell' })
        return
      }
      const body = JSON.parse(await readBody(req)) as { path?: unknown }
      const target = typeof body.path === 'string' ? await viewFencedPath(body.path) : undefined
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      if (typeof actions?.trashItem === 'function') {
        await actions.trashItem(target)
        sendJson(res, 200, { ok: true })
        return
      }
      const script = `tell application "Finder" to delete POSIX file ${JSON.stringify(target)}`
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/osascript', ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] })
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        child.on('error', reject)
        child.on('exit', (code) => {
          if (code === 0) resolve()
          else reject(new Error(stderr.trim() || `osascript exited ${String(code)}`))
        })
      })
      sendJson(res, 200, { ok: true })
    })

    register('/idealize/bar/create', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { parent?: string; name?: string; kind?: string }
      const { parent, name, kind } = body
      if (typeof parent !== 'string' || typeof name !== 'string' || (kind !== 'file' && kind !== 'dir')) {
        sendJson(res, 422, { error: 'expected { parent, name, kind: "file" | "dir" }' })
        return
      }
      // The name becomes a single path component — reject anything that
      // could climb out of the fenced parent (V0's createFolder rule).
      const trimmed = name.trim()
      if (trimmed === '' || trimmed === '.' || trimmed === '..'
        || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
        sendJson(res, 422, { error: 'invalid name' })
        return
      }
      const target = await viewFencedPath(parent)
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      if (!(await stat(target)).isDirectory()) {
        sendJson(res, 422, { error: 'parent is not a directory' })
        return
      }
      const created = `${target}${sep}${trimmed}`
      try {
        if (kind === 'dir') await mkdir(created)
        // 'wx' fails on an existing file instead of truncating it.
        else await writeFile(created, '', { flag: 'wx' })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') {
          sendJson(res, 409, { error: 'already exists' })
          return
        }
        throw error
      }
      sendJson(res, 200, { ok: true, path: created })
    })

    // The catalogue comes from the folder (every package, grouped by
    // subfolder, JJ 15 Sep 2026: "i need subdirectories for the models to
    // use"); the registry says which names a chat can actually run, since it
    // keeps one skill per name and drops a manifest it cannot read.
    register('/idealize/bar/skills', false, async (_req, res) => {
      const host = webCtx as unknown as { get(name: string): unknown }
      const catalogue = host.get('idealizeSkills') as IdealizeSkillsService | undefined
      if (catalogue === undefined) {
        sendJson(res, 200, { groups: [] })
        return
      }
      const registry = host.get('skills') as SkillRegistryLike | undefined
      const invocable = new Set((registry === undefined ? [] : await registry.list())
        .filter(skill => skill.provider === SKILLS_PROVIDER_NAME && skill.invocation.userInvocable)
        .map(skill => skill.name))
      const groups = (await catalogue.catalogue()).map(group => ({
        folder: group.folder,
        skills: group.skills.map(skill => ({ name: skill.name, description: skill.description, invocable: invocable.has(skill.name) })),
      }))
      sendJson(res, 200, { groups })
    })

    register('/idealize/bar/aliases', false, async (_req, res) => {
      const workspaceRoots = webCtx.workspaceRegistry.list().map(workspace => ({
        name: workspace.title,
        path: workspace.path,
      }))
      const aliases = webCtx.get('workspaceAliases')
      const resolved = aliases === undefined
        ? ALIAS_TABS.map(() => undefined)
        : await Promise.all(ALIAS_TABS.map(name => aliases.resolve(name)))
      const tabs: AliasTab[] = [
        {
          id: 'project',
          roots: workspaceRoots,
          state: workspaceRoots.length === 0 ? 'unset' : 'ok',
        },
        ...ALIAS_TABS.map((name, index): AliasTab => {
          const alias = resolved[index]
          if (alias === undefined) return { id: name, alias: name, roots: [], state: 'unset' }
          return {
            id: name,
            alias: name,
            // A failed alias keeps its path out of the tree: the tab shows
            // Reconnect instead of a root that cannot be listed.
            roots: alias.accessState === 'ok' ? [{ name: basename(alias.path), path: alias.path }] : [],
            state: alias.accessState,
            ...alias.reason === undefined ? {} : { reason: alias.reason },
          }
        }),
      ]
      sendJson(res, 200, { tabs })
    })

    register('/idealize/bar/files', false, async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const raw = url.searchParams.get('path')
      if (raw === null || raw === '') {
        const roots = webCtx.workspaceRegistry.list().map(workspace => ({
          name: workspace.title,
          path: workspace.path,
        }))
        sendJson(res, 200, { roots })
        return
      }
      const target = await fencedPath(raw)
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside workspace roots' })
        return
      }
      sendJson(res, 200, { path: target, entries: await listEntries(target) })
    })

    register('/idealize/bar/browse', false, async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const raw = url.searchParams.get('path')
      if (raw === null || raw === '') {
        const home = homedir()
        sendJson(res, 200, { root: { name: basename(home), path: home } })
        return
      }
      const target = await viewFencedPath(raw)
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      sendJson(res, 200, { path: target, entries: await listEntries(target) })
    })

    register('/idealize/bar/file', false, async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const raw = url.searchParams.get('path')
      const target = raw === null || raw === '' ? undefined : await viewFencedPath(raw)
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      const info = await stat(target)
      if (!info.isFile()) {
        sendJson(res, 422, { error: 'not a file' })
        return
      }
      const ext = extname(target).toLowerCase()
      const name = basename(target)
      if (IMAGE_MIME[ext] !== undefined) {
        sendJson(res, 200, { name, kind: 'image', size: info.size })
        return
      }
      if (BINARY_EXT.has(ext) || info.size > 8 * 1024 * 1024) {
        sendJson(res, 200, { name, kind: 'binary', size: info.size })
        return
      }
      const buffer = await readFile(target)
      const slice = buffer.subarray(0, TEXT_CAP_BYTES)
      // NUL bytes in the head mark a binary file the extension lists missed.
      if (slice.includes(0)) {
        sendJson(res, 200, { name, kind: 'binary', size: info.size })
        return
      }
      sendJson(res, 200, {
        name,
        kind: 'text',
        size: info.size,
        text: slice.toString('utf8'),
        truncated: buffer.length > TEXT_CAP_BYTES,
      })
    })

    register('/idealize/bar/raw', false, async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const raw = url.searchParams.get('path')
      const target = raw === null || raw === '' ? undefined : await viewFencedPath(raw)
      if (target === undefined) {
        sendJson(res, 403, { error: 'path outside home and workspace roots' })
        return
      }
      const mime = IMAGE_MIME[extname(target).toLowerCase()]
      if (mime === undefined) {
        sendJson(res, 415, { error: 'not an image' })
        return
      }
      const info = await stat(target)
      if (!info.isFile() || info.size > RAW_CAP_BYTES) {
        sendJson(res, 422, { error: 'not a servable file' })
        return
      }
      const body = await readFile(target)
      res.writeHead(200, {
        'content-type': mime,
        'content-length': body.length,
        // The viewer is the only consumer; keep the response uncacheable so a
        // rewritten file shows fresh on reopen.
        'cache-control': 'no-store',
      }).end(body)
    })
  })
}

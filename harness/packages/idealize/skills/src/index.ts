/**
 * @idealize/skills — the person's own skills folder as product settings.
 *
 * JJ (15 Sep 2026) asked for "a pre-defined skills folder, visible in files,
 * like projects and documentation", captured in setup and referenced from a
 * chat's + menu. This plugin owns the folder: settings section
 * `idealize-skills` keeps `skillsFolder`. The folder holds `.skill` packages
 * (zip archives with a SKILL.md at the root, the format skills are shared
 * in) and unpacked skill folders (a folder holding a SKILL.md, the layout
 * Claude Code and Codex keep), directly or in one level of subfolders, one per
 * model (JJ, 15 Sep 2026: "i need subdirectories for the models to use"). An
 * unpacked folder is accepted when no package beside it has the same name;
 * the package wins a clash (JJ, 16 Nov 2026, narrowing the 15 Sep rule that
 * ignored every unpacked folder). While the folder is a readable directory
 * the plugin stages each package and each accepted folder under
 * `unpackFolder` (one subfolder each, under the source subfolder's name when
 * it has one, staged again when the source changes, removed when the source
 * goes) and mounts one `skill-filesystem` provider over the unpack folder and
 * each of its subfolders (`includeDefaultRoots: false`, watching) into the
 * host skill registry's global layer. The registry keeps one skill per name,
 * so a name that appears in two subfolders resolves to the first subfolder by
 * name. The skills folder itself is watched, so a package or folder dropped
 * in or replaced reaches the catalogue without a restart. A changed folder or
 * a new subfolder re-mounts the provider; an unset or unreadable folder mounts
 * nothing. The `idealizeSkills` service answers the folder's catalogue,
 * grouped by subfolder, for the composer's skill selector.
 *
 * Two more registrations decide which skills one chat is offered. A registry
 * view filter keeps, for a chat whose brain's `preset.yml` carries a `skills`
 * list, only the listed skills of the person's folder ({@link brainSkillFilter}).
 * A second provider lists the `playbooks/` folder of the chat's project inside
 * the documentation folder ({@link PlaybooksProvider}).
 *
 * The plugin also closes the loop from use back to the skill. The
 * `skill_learning` tool appends what an agent learned about a skill to
 * `Reference/playbook-learnings/<skill>.md` in the documentation folder, a
 * standing prompt line says when to call it, and the `fold-learnings` skill
 * shipped in this package's `skills/` directory drafts a revision from those
 * lines for the person to review.
 *
 * `@idealize/setup` writes the folder when the `skills` alias is captured;
 * `@idealize/ui-bar`'s Files pane shows the folder as its Skills tab and its
 * Skills & Commands submenu lists the catalogue.
 *
 * @module @idealize/skills
 */

import { watch as watchDirectory, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@idealize/doc-policy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { brainSkillFilter } from './brain-filter.ts'
import {
  BUILT_IN_SKILLS_PROVIDER_NAME, builtInSkillsDir, LEARNINGS_GUIDANCE, LEARNINGS_SECTION_NAME, LEARNINGS_SECTION_ORDER, skillLearningTool,
} from './learnings.ts'
import { PLAYBOOKS_FOLDER, PlaybooksProvider, projectRootOf } from './playbooks.ts'

export { brainSkillFilter, presetOfScope } from './brain-filter.ts'
export {
  appendLearning, BUILT_IN_SKILLS_PROVIDER_NAME, builtInSkillsDir, LEARNING_MAX_LENGTH, learningAuthor, LEARNINGS_FOLDER,
  LEARNINGS_GUIDANCE, LEARNINGS_SECTION_NAME, LEARNINGS_SECTION_ORDER, SKILL_LEARNING_TOOL, skillLearningTool,
} from './learnings.ts'
export type { LearningInput, LearningRecord } from './learnings.ts'
export {
  PLAYBOOK_RANK, PLAYBOOK_SOURCE, PLAYBOOKS_FOLDER, PLAYBOOKS_PROVIDER_NAME, PlaybooksProvider, projectRootOf,
} from './playbooks.ts'

export const name = 'idealize-skills'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The skills folder's catalogue, grouped by subfolder. */
    idealizeSkills: IdealizeSkillsService
  }
}

/** One package or unpacked folder in the catalogue: what its manifest says, or its file name when the manifest cannot be read. */
export interface CatalogueSkill {
  /** The package's file name without its extension, or the unpacked folder's name. */
  readonly package: string
  /** The manifest's `name`, or the package name when the manifest is missing or unreadable. */
  readonly name: string
  /** The manifest's `description`, empty when it is missing or unreadable. */
  readonly description: string
  /** Whether the manifest was read; false leaves the package listed but not offered. */
  readonly manifest: boolean
}

/** One folder of the catalogue: the skills folder itself (`folder` empty) or one of its subfolders. */
export interface CatalogueGroup {
  /** The subfolder name; empty for packages directly in the skills folder. */
  readonly folder: string
  /** The folder's packages and accepted unpacked folders, sorted by name. */
  readonly skills: readonly CatalogueSkill[]
}

/** The service face: the folder's packages and accepted unpacked folders as they sit on disk, whether or not the registry accepted them. */
export interface IdealizeSkillsService {
  /**
   * The catalogue: the skills folder's own entries first, then each subfolder by name.
   * @returns the groups; empty when no folder is set or readable.
   */
  catalogue(): Promise<readonly CatalogueGroup[]>
}

/** The settings namespace this plugin owns. */
export const SKILLS_SETTINGS_NAMESPACE = 'idealize-skills'

const NS = settingsNamespace(SKILLS_SETTINGS_NAMESPACE)

/** The provider name the mounted `skill-filesystem` registers under. */
export const SKILLS_PROVIDER_NAME = 'idealize-skills'

/** The file extension of a skill package: a zip archive with a SKILL.md at its root. */
export const SKILL_PACKAGE_EXTENSION = '.skill'

/** The manifest file that makes a folder or an archive a skill. */
const MANIFEST_FILE = 'SKILL.md'

/** The marker file a staged skill carries: its source's change key, so an unchanged source is not staged again. */
const PACKAGE_MARKER = '.package'

/** How long the folder watcher waits after the last change before re-syncing. */
const WATCH_SETTLE_MS = 300

/** Plugin config, mirrored by the `idealize-skills` settings section. */
export interface SkillsConfig {
  /** Absolute directory holding the person's `.skill` packages and unpacked skill folders. */
  skillsFolder?: string
  /** Where packages are unpacked and folders copied for the provider to read; `<dsh home>/idealize/skill-packages` when unset. */
  unpackFolder?: string
}

export const Config: z<SkillsConfig> = z.object({
  skillsFolder: z.string(),
  unpackFolder: z.string(),
})

/**
 * The unpack folder for a config: the stored one, else the harness home default.
 * @param config - the plugin's settings.
 * @returns the absolute folder.
 */
export function resolveUnpackFolder(config: SkillsConfig): string {
  return config.unpackFolder !== undefined && config.unpackFolder !== '' ? config.unpackFolder : dshHomePath('idealize', 'skill-packages')
}

/** One skill source in the folder: a `.skill` package or an accepted unpacked folder. */
interface SkillPackage {
  /** The subfolder it sits in; empty for a source directly in the skills folder. */
  readonly group: string
  /** The subfolder name it is staged under: the package's file name without its extension, or the folder's name. */
  readonly id: string
  readonly path: string
  /** The change key: `size:mtimeMs` for a package, a digest of every file's path, size and mtime for a folder. */
  readonly key: string
  /** Whether the source is a zip archive to unpack or a folder to copy. */
  readonly kind: 'archive' | 'folder'
}

/** Folder-name order: case-insensitive, so `Codex` and `claude` sort together; names differing by case alone fall back to plain order. */
function compareNames(a: string, b: string): number {
  /* v8 ignore next -- the fallback separates names that differ by case alone,
     which a case-insensitive filesystem cannot hold side by side. */
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b)
}

/** Where a source is staged. */
function unpackTarget(unpackFolder: string, pkg: Pick<SkillPackage, 'group' | 'id'>): string {
  return pkg.group === '' ? join(unpackFolder, pkg.id) : join(unpackFolder, pkg.group, pkg.id)
}

/** Whether a path names a file. */
async function isFile(path: string): Promise<boolean> {
  return await stat(path).then(info => info.isFile(), () => false)
}

/** The `.skill` packages directly inside one directory (other files ignored). */
async function packagesIn(directory: string, group: string): Promise<SkillPackage[]> {
  const packages: SkillPackage[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(SKILL_PACKAGE_EXTENSION)) continue
    const path = join(directory, entry.name)
    const info = await stat(path)
    packages.push({
      group, id: entry.name.slice(0, -SKILL_PACKAGE_EXTENSION.length), path, key: `${info.size}:${info.mtimeMs}`, kind: 'archive',
    })
  }
  return packages
}

/** A folder's change key: a digest over every file's relative path, size and mtime, so any edit inside it stages the folder again. */
async function folderKey(directory: string): Promise<string> {
  const lines: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    const info = await stat(path)
    lines.push(`${relative(directory, path)}:${info.size}:${info.mtimeMs}`)
  }
  return `folder:${createHash('sha256').update(lines.sort().join('\n')).digest('hex')}`
}

/**
 * The skill sources in the folder and in each of its visible subfolders: the
 * folder's own packages, then its unpacked skill folders, then each subfolder
 * by name with its packages before its unpacked folders. A visible folder
 * holding a SKILL.md and no package is an unpacked skill; any other visible
 * folder directly in the skills folder is a subfolder of skills. An unpacked
 * folder is left out when a package beside it carries its name (compared
 * without case, because both would be staged under that name). Deeper folders
 * and everything else are ignored.
 */
async function listPackages(folder: string): Promise<SkillPackage[]> {
  const own = await packagesIn(folder, '')
  const unpacked: SkillPackage[] = []
  const grouped: SkillPackage[] = []
  const visible = async (directory: string): Promise<string[]> => (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort(compareNames)
  /** Adds `directory/name` to `into` when it is an unpacked skill no package in `beside` names. */
  const accept = async (
    directory: string, group: string, name: string, beside: readonly SkillPackage[], into: SkillPackage[],
  ): Promise<void> => {
    const path = join(directory, name)
    if (beside.some(pkg => pkg.id.toLowerCase() === name.toLowerCase()) || !await isFile(join(path, MANIFEST_FILE))) return
    into.push({ group, id: name, path, key: await folderKey(path), kind: 'folder' })
  }
  for (const name of await visible(folder)) {
    const directory = join(folder, name)
    const packages = await packagesIn(directory, name)
    if (packages.length === 0 && await isFile(join(directory, MANIFEST_FILE))) {
      await accept(folder, '', name, own, unpacked)
      continue
    }
    grouped.push(...packages)
    for (const child of await visible(directory)) await accept(directory, name, child, packages, grouped)
  }
  return [...own, ...unpacked, ...grouped]
}

/**
 * The archive entries to write for one package, keyed by their path under
 * the unpack subfolder. The SKILL.md may sit at the archive root or under one
 * top-level folder; entries outside that folder, directory entries, and any
 * path that escapes the subfolder are dropped. Zip names separate with `/`
 * only, so a name holding `\` is dropped too: Windows reads it as a separator,
 * and `..\` inside one `/` segment would otherwise climb out.
 * @param archive - the package bytes.
 * @returns the files, or undefined when the archive holds no SKILL.md.
 */
export function packageFiles(archive: Uint8Array): ReadonlyMap<string, Uint8Array> | undefined {
  const entries = unzipSync(archive)
  const manifests = Object.keys(entries).filter(key => basename(key) === MANIFEST_FILE && !key.endsWith('/'))
  const root = manifests.map(key => dirname(key)).filter(dir => dir === '.' || !dir.includes('/')).sort((a, b) => a.length - b.length)[0]
  if (root === undefined) return undefined
  const prefix = root === '.' ? '' : `${root}/`
  const files = new Map<string, Uint8Array>()
  for (const [key, data] of Object.entries(entries)) {
    if (key.endsWith('/') || key.includes('\\') || !key.startsWith(prefix)) continue
    const relative = key.slice(prefix.length)
    const segments = relative.split('/')
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..') || /^[a-zA-Z]:/.test(relative)) continue
    files.set(segments.join(sep), data)
  }
  return files
}

/** What a sync leaves behind. */
export interface SyncResult {
  /** The packages and folders that could not be staged, with the reason. */
  readonly failures: readonly { id: string; reason: string }[]
  /** The subfolders holding at least one skill source, by name: the provider's roots beside the unpack folder itself. */
  readonly groups: readonly string[]
}

/** Whether a directory is a staged skill of ours (carries the marker). */
async function owned(directory: string): Promise<boolean> {
  return await stat(join(directory, PACKAGE_MARKER)).then(() => true, () => false)
}

/**
 * Write one source's files under `target`: a folder is copied whole, a package is unpacked.
 * @returns the reason nothing usable was written, or undefined on success.
 */
async function stage(pkg: SkillPackage, target: string): Promise<string | undefined> {
  if (pkg.kind === 'folder') {
    await cp(pkg.path, target, { recursive: true, dereference: true })
    return undefined
  }
  const files = packageFiles(new Uint8Array(await readFile(pkg.path)))
  if (files === undefined) return 'no SKILL.md in the package'
  for (const [path, data] of files) {
    const file = join(target, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, data)
  }
  return undefined
}

/**
 * Bring the unpack folder in step with the skills folder: stage new or changed
 * packages and accepted unpacked folders, leave unchanged ones alone, and
 * remove staged subfolders whose source is gone. Only subfolders carrying the
 * marker are ever removed; a group folder goes once it holds nothing and its
 * source subfolder has no skill sources. A source that cannot be staged leaves
 * no partial copy behind.
 * @param folder - the skills folder holding the `.skill` packages and unpacked skill folders.
 * @param unpackFolder - where each source is staged, one subfolder each.
 * @returns the failures and the group folders in use.
 */
export async function syncPackages(folder: string, unpackFolder: string): Promise<SyncResult> {
  await mkdir(unpackFolder, { recursive: true })
  const packages = await listPackages(folder)
  const failures: { id: string; reason: string }[] = []
  const wanted = new Set(packages.map(pkg => `${pkg.group}/${pkg.id}`))
  const groups = [...new Set(packages.map(pkg => pkg.group).filter(group => group !== ''))].sort(compareNames)
  for (const pkg of packages) {
    const target = unpackTarget(unpackFolder, pkg)
    const marker = join(target, PACKAGE_MARKER)
    const current = await readFile(marker, 'utf8').catch(() => undefined)
    if (current === pkg.key) continue
    await rm(target, { recursive: true, force: true })
    let reason: string | undefined
    try {
      reason = await stage(pkg, target)
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    if (reason !== undefined) {
      await rm(target, { recursive: true, force: true })
      failures.push({ id: pkg.id, reason })
      continue
    }
    await writeFile(marker, pkg.key)
  }
  for (const entry of await readdir(unpackFolder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(unpackFolder, entry.name)
    if (await owned(directory)) {
      if (!wanted.has(`/${entry.name}`)) await rm(directory, { recursive: true, force: true })
      continue
    }
    // A group folder: prune the skills it no longer holds, then the folder
    // itself once nothing is left and the source subfolder has no skill sources.
    for (const sub of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, sub.name)
      if (sub.isDirectory() && !wanted.has(`${entry.name}/${sub.name}`) && await owned(target)) await rm(target, { recursive: true, force: true })
    }
    if (!groups.includes(entry.name) && (await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true })
  }
  return { failures, groups }
}

/** The `name` and `description` of a manifest's frontmatter; undefined when either is missing or the frontmatter does not parse. */
function manifestFields(raw: string): { name: string; description: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (match === null) return undefined
  let data: unknown
  try {
    data = parseYaml(match[1] ?? '')
  } catch {
    // Invalid YAML: the provider warns about it; the catalogue lists the package by file name.
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const { name, description } = data as Record<string, unknown>
  return typeof name === 'string' && typeof description === 'string' ? { name, description } : undefined
}

/**
 * The folder's catalogue from the skill sources on disk and their staged
 * manifests: the folder's own entries first (`folder` empty), then each
 * subfolder by name, each group's entries sorted by name. A source whose
 * staged manifest is missing or unreadable is listed by its file or folder
 * name with `manifest: false`.
 * @param folder - the skills folder.
 * @param unpackFolder - where the sources are staged.
 * @returns the groups, omitting a subfolder without skill sources.
 */
export async function readCatalogue(folder: string, unpackFolder: string): Promise<CatalogueGroup[]> {
  const byGroup = new Map<string, CatalogueSkill[]>()
  for (const pkg of await listPackages(folder)) {
    const raw = await readFile(join(unpackTarget(unpackFolder, pkg), MANIFEST_FILE), 'utf8').catch(() => undefined)
    const fields = raw === undefined ? undefined : manifestFields(raw)
    const skill: CatalogueSkill = fields === undefined
      ? { package: pkg.id, name: pkg.id, description: '', manifest: false }
      : { package: pkg.id, name: fields.name, description: fields.description, manifest: true }
    const list = byGroup.get(pkg.group)
    if (list === undefined) byGroup.set(pkg.group, [skill])
    else list.push(skill)
  }
  return [...byGroup.entries()].map(([group, skills]) => ({ folder: group, skills: skills.sort((a, b) => compareNames(a.name, b.name)) }))
}

/** The folder when it names a readable directory; undefined otherwise. */
async function readableDirectory(folder: string | undefined): Promise<string | undefined> {
  if (folder === undefined || folder === '') return undefined
  try {
    return (await stat(folder)).isDirectory() ? folder : undefined
  } catch {
    // ENOENT/EACCES: the folder is gone or unreadable, so nothing is mounted.
    return undefined
  }
}

export function apply(ctx: Context, config: SkillsConfig): void {
  let source: () => SkillsConfig = () => config
  let notify: () => void = () => {}

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (next) => { source = next },
    onChange: () => { notify() },
  })

  ctx.effect(() => ctx.provide('idealizeSkills', {
    catalogue: async () => {
      const folder = await readableDirectory(source().skillsFolder)
      return folder === undefined ? [] : await readCatalogue(folder, resolveUnpackFolder(source()))
    },
  }), 'idealize-skills: idealizeSkills')

  // A brain's `skills` list narrows the folder's skills for chats on that brain.
  ctx.inject(['skills', 'agentPresets'], (fctx) => {
    fctx.skills.registerFilter(brainSkillFilter(fctx, SKILLS_PROVIDER_NAME))
  })

  // The playbooks of the chat's project, found through the documentation folder.
  ctx.inject(['skills', 'docPolicy'], (pctx) => {
    let provider!: PlaybooksProvider
    pctx.skills.registerProvider((control) => {
      provider = new PlaybooksProvider(pctx, control, async (cwd) => {
        const found = await pctx.docPolicy.projectFolder(await projectRootOf(cwd))
        return found === undefined ? undefined : join(found.path, PLAYBOOKS_FOLDER)
      })
      return provider
    })
    pctx.effect(() => async () => { await provider.dispose() }, 'idealize-skills: playbooks watchers')
  })

  // The skills this package ships, read from its own `skills/` directory.
  ctx.inject(['skills'], (bctx) => {
    bctx.plugin(SkillFileSystem, {
      providerName: BUILT_IN_SKILLS_PROVIDER_NAME,
      includeDefaultRoots: false,
      bundledSkillDir: builtInSkillsDir(),
      watch: false,
    })
  })

  // Learnings: the tool that records one, and the standing line that says when.
  ctx.inject(['skills', 'docPolicy', 'tools', 'systemPrompt'], (lctx) => {
    lctx.tools.register(skillLearningTool(lctx))
    lctx.effect(() => lctx.systemPrompt.section({
      name: LEARNINGS_SECTION_NAME,
      order: LEARNINGS_SECTION_ORDER,
      text: LEARNINGS_GUIDANCE,
    }), 'idealize-skills: learnings prompt section')
  })

  ctx.inject(['skills'], (sctx) => {
    let mounted: { folder: string; roots: string; fiber: Fiber } | undefined
    let watcher: { folder: string; handle: FSWatcher; timer: NodeJS.Timeout | undefined } | undefined
    // One reconcile at a time: a burst of settings or folder changes settles
    // in order, so the last stored folder is the one left mounted.
    let chain: Promise<void> = Promise.resolve()

    const stopWatching = (): void => {
      if (watcher === undefined) return
      if (watcher.timer !== undefined) clearTimeout(watcher.timer)
      watcher.handle.close()
      watcher = undefined
    }

    const unmount = async (): Promise<void> => {
      stopWatching()
      if (mounted === undefined) return
      const { fiber } = mounted
      mounted = undefined
      await fiber.dispose()
    }

    // Changes to a package or an unpacked folder, in the folder or its
    // subfolders, re-sync after a short settle; the mounted provider watches
    // the unpack folders itself and refreshes the catalogue from what the
    // sync wrote.
    const watchFolder = (folder: string): void => {
      if (watcher?.folder === folder) return
      stopWatching()
      try {
        const handle = watchDirectory(folder, { persistent: false, recursive: true }, () => {
          if (watcher === undefined) return
          if (watcher.timer !== undefined) clearTimeout(watcher.timer)
          watcher.timer = setTimeout(() => { if (watcher !== undefined) { watcher.timer = undefined; notify() } }, WATCH_SETTLE_MS)
        })
        handle.on('error', () => { stopWatching() })
        watcher = { folder, handle, timer: undefined }
      } catch (error) {
        // A platform without directory watching: packages sync on settings changes and restarts.
        sctx.logger.warn(`idealize-skills: not watching the skills folder: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const reconcile = async (): Promise<void> => {
      const folder = await readableDirectory(source().skillsFolder)
      if (folder === undefined) {
        await unmount()
        return
      }
      const unpackFolder = resolveUnpackFolder(source())
      const { failures, groups } = await syncPackages(folder, unpackFolder)
      for (const failure of failures) sctx.logger.warn(`idealize-skills: "${failure.id}" skipped: ${failure.reason}`)
      // The unpack folder first, then each group folder by name: the registry
      // keeps the first root's skill when a name repeats.
      const customSkillDirs = [unpackFolder, ...groups.map(group => join(unpackFolder, group))]
      const roots = customSkillDirs.join('\n')
      if (mounted?.folder !== folder || mounted.roots !== roots) {
        await unmount()
        const fiber = await sctx.plugin(SkillFileSystem, {
          providerName: SKILLS_PROVIDER_NAME,
          includeDefaultRoots: false,
          customSkillDirs,
          watch: true,
        })
        mounted = { folder, roots, fiber }
      }
      watchFolder(folder)
    }

    notify = () => {
      chain = chain.then(reconcile).catch((error: unknown) => {
        sctx.logger.warn(`idealize-skills: could not mount the skills folder: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    sctx.effect(() => {
      notify()
      return () => {
        notify = () => {}
        chain = chain.then(unmount)
      }
    })
  })
}

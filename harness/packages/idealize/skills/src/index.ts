/**
 * @idealize/skills — the person's own skills folder as product settings.
 *
 * JJ (15 Sep 2026) asked for "a pre-defined skills folder, visible in files,
 * like projects and documentation", captured in setup and referenced from a
 * chat's + menu. This plugin owns the folder: settings section
 * `idealize-skills` keeps `skillsFolder`. The folder holds `.skill` packages
 * (zip archives with a SKILL.md at the root, the format skills are shared
 * in), directly or in one level of subfolders, one per model (JJ, later on
 * 15 Sep: "i need subdirectories for the models to use"); anything else,
 * including unpacked copies of the same skills, is ignored (JJ: "the folders
 * in skills should be ignored as they aren't the actual skill files - they're
 * the unpackaged skills"). While the folder is a readable directory the
 * plugin unpacks each package into `unpackFolder` (one subfolder per package,
 * under the package's own subfolder name when it has one, re-extracted when
 * the package's size or mtime changes, removed when the package goes) and
 * mounts one `skill-filesystem` provider over the unpack folder and each of
 * its subfolders (`includeDefaultRoots: false`, watching) into the host
 * skill registry's global layer, which every agent's catalogue and
 * `skill.list` read. The registry keeps one skill per name, so a name that
 * appears in two subfolders resolves to the first subfolder by name. The
 * skills folder itself is watched, so a package dropped in or replaced
 * reaches the catalogue without a restart. A changed folder or a new
 * subfolder re-mounts the provider; an unset or unreadable folder mounts
 * nothing. The `idealizeSkills` service answers the folder's catalogue,
 * grouped by subfolder, package by package, for the composer's skill
 * selector.
 *
 * `@idealize/setup` writes the folder when the `skills` alias is captured;
 * `@idealize/ui-bar`'s Files pane shows the folder as its Skills tab and its
 * Skills & Commands submenu lists the catalogue.
 *
 * @module @idealize/skills
 */

import { watch as watchDirectory, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'

export const name = 'idealize-skills'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The skills folder's catalogue, grouped by subfolder. */
    idealizeSkills: IdealizeSkillsService
  }
}

/** One package in the catalogue: what its manifest says, or its file name when the manifest cannot be read. */
export interface CatalogueSkill {
  /** The package's file name without its extension. */
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
  /** The folder's packages, sorted by name. */
  readonly skills: readonly CatalogueSkill[]
}

/** The service face: the folder's packages as they sit on disk, whether or not the registry accepted them. */
export interface IdealizeSkillsService {
  /**
   * The catalogue: packages in the skills folder first, then each subfolder by name.
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

/** The marker file an unpacked package carries: the source package's size and mtime, so an unchanged package is not re-extracted. */
const PACKAGE_MARKER = '.package'

/** How long the folder watcher waits after the last change before re-syncing. */
const WATCH_SETTLE_MS = 300

/** Plugin config, mirrored by the `idealize-skills` settings section. */
export interface SkillsConfig {
  /** Absolute directory holding the person's `.skill` packages. */
  skillsFolder?: string
  /** Where the packages are unpacked for the provider to read; `<dsh home>/idealize/skill-packages` when unset. */
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

/** One `.skill` package in the folder. */
interface SkillPackage {
  /** The subfolder it sits in; empty for a package directly in the skills folder. */
  readonly group: string
  /** The subfolder name it unpacks to: the file name without its extension. */
  readonly id: string
  readonly path: string
  /** `size:mtimeMs`, the re-extraction key. */
  readonly key: string
}

/** Folder-name order: case-insensitive, so `Codex` and `claude` sort together; names differing by case alone fall back to plain order. */
function compareNames(a: string, b: string): number {
  /* v8 ignore next -- the fallback separates names that differ by case alone,
     which a case-insensitive filesystem cannot hold side by side. */
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b)
}

/** Where a package unpacks to. */
function unpackTarget(unpackFolder: string, pkg: Pick<SkillPackage, 'group' | 'id'>): string {
  return pkg.group === '' ? join(unpackFolder, pkg.id) : join(unpackFolder, pkg.group, pkg.id)
}

/** The `.skill` packages directly inside one directory (other files ignored). */
async function packagesIn(directory: string, group: string): Promise<SkillPackage[]> {
  const packages: SkillPackage[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(SKILL_PACKAGE_EXTENSION)) continue
    const path = join(directory, entry.name)
    const info = await stat(path)
    packages.push({ group, id: entry.name.slice(0, -SKILL_PACKAGE_EXTENSION.length), path, key: `${info.size}:${info.mtimeMs}` })
  }
  return packages
}

/**
 * The `.skill` packages in the folder and in each of its visible subfolders,
 * the folder's own first, then the subfolders by name. Deeper folders and
 * everything that is not a package are ignored.
 */
async function listPackages(folder: string): Promise<SkillPackage[]> {
  const packages = await packagesIn(folder, '')
  const groups = (await readdir(folder, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort(compareNames)
  for (const group of groups) packages.push(...await packagesIn(join(folder, group), group))
  return packages
}

/**
 * The archive entries to write for one package, keyed by their path under
 * the unpack subfolder. The SKILL.md may sit at the archive root or under one
 * top-level folder; entries outside that folder, directory entries, and any
 * path that escapes the subfolder are dropped.
 * @param archive - the package bytes.
 * @returns the files, or undefined when the archive holds no SKILL.md.
 */
export function packageFiles(archive: Uint8Array): ReadonlyMap<string, Uint8Array> | undefined {
  const entries = unzipSync(archive)
  const manifests = Object.keys(entries).filter(key => basename(key) === 'SKILL.md' && !key.endsWith('/'))
  const root = manifests.map(key => dirname(key)).filter(dir => dir === '.' || !dir.includes('/')).sort((a, b) => a.length - b.length)[0]
  if (root === undefined) return undefined
  const prefix = root === '.' ? '' : `${root}/`
  const files = new Map<string, Uint8Array>()
  for (const [key, data] of Object.entries(entries)) {
    if (key.endsWith('/') || !key.startsWith(prefix)) continue
    const relative = key.slice(prefix.length)
    const segments = relative.split('/')
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..') || /^[a-zA-Z]:/.test(relative)) continue
    files.set(segments.join(sep), data)
  }
  return files
}

/** What a sync leaves behind. */
export interface SyncResult {
  /** The packages that could not be unpacked, with the reason. */
  readonly failures: readonly { id: string; reason: string }[]
  /** The subfolders holding at least one package, by name: the provider's roots beside the unpack folder itself. */
  readonly groups: readonly string[]
}

/** Whether a directory is an unpacked package of ours (carries the marker). */
async function owned(directory: string): Promise<boolean> {
  return await stat(join(directory, PACKAGE_MARKER)).then(() => true, () => false)
}

/**
 * Bring the unpack folder in step with the packages: extract new or changed
 * packages, leave unchanged ones alone, and remove unpacked subfolders whose
 * package is gone. Only subfolders carrying the marker are ever removed; a
 * group folder goes once it holds nothing and its source subfolder has no
 * packages.
 * @param folder - the skills folder holding the `.skill` packages.
 * @param unpackFolder - where each package unpacks to, one subfolder per package.
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
    let files: ReadonlyMap<string, Uint8Array> | undefined
    try {
      files = packageFiles(new Uint8Array(await readFile(pkg.path)))
    } catch (error) {
      failures.push({ id: pkg.id, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (files === undefined) {
      failures.push({ id: pkg.id, reason: 'no SKILL.md in the package' })
      continue
    }
    for (const [relative, data] of files) {
      const path = join(target, relative)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
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
    // A group folder: prune the packages it no longer holds, then the folder
    // itself once nothing is left and the source subfolder has no packages.
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
 * The folder's catalogue from the packages on disk and their unpacked
 * manifests: the folder's own packages first (`folder` empty), then each
 * subfolder by name, each group's packages sorted by name. A package whose
 * unpacked manifest is missing or unreadable is listed by its file name with
 * `manifest: false`.
 * @param folder - the skills folder.
 * @param unpackFolder - where the packages are unpacked.
 * @returns the groups, omitting a subfolder without packages.
 */
export async function readCatalogue(folder: string, unpackFolder: string): Promise<CatalogueGroup[]> {
  const byGroup = new Map<string, CatalogueSkill[]>()
  for (const pkg of await listPackages(folder)) {
    const raw = await readFile(join(unpackTarget(unpackFolder, pkg), 'SKILL.md'), 'utf8').catch(() => undefined)
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

    // Package changes inside the folder or its subfolders re-sync after a
    // short settle; the mounted provider watches the unpack folders itself
    // and refreshes the catalogue from what the sync wrote.
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
      for (const failure of failures) sctx.logger.warn(`idealize-skills: package "${failure.id}" skipped: ${failure.reason}`)
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

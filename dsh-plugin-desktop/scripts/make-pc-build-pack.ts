/**
 * Assemble the PC build pack: the committed source, the Windows build
 * launcher, and a README, zipped for a colleague's Windows machine.
 * The pack mirrors the release workflow's Windows job (`yarn install
 * --immutable`, `yarn dist:win`, `yarn dist:win-portable`) and needs no git,
 * GitHub access, or project knowledge on the machine that runs it.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { readWindowsProductManifest } from './verify-win-installer.ts'

/** Files copied from `pc-build-pack/` to the root of every pack, with CRLF line endings. */
export const PACK_TEMPLATES = ['Build-IDEalize.cmd', 'build.ps1', 'README.txt'] as const

/** Tracked paths left out of the source export: the build never reads them. */
export const SOURCE_EXCLUDES = ['.idealize'] as const

/** Paths that must exist under `source/` in a pack for the Windows build to run. */
export const REQUIRED_SOURCE_ENTRIES = [
  'package.json',
  'yarn.lock',
  '.yarnrc.yml',
  'dsh-plugin-desktop/package.json',
  'dsh-plugin-desktop/scripts/package-win.ts',
  'vendor/freellmapi/server.mjs',
] as const

/** Injectable pack assembly boundary used by focused tests. */
export interface PcBuildPackOptions {
  /** Repository root the source export describes. */
  readonly workspaceRoot: string
  /** Desktop package root containing package.json. */
  readonly desktopRoot: string
  /** Directory holding the launcher, build script, and README templates. */
  readonly templatesDir: string
  /** Directory the zip is written to. */
  readonly outputDir: string
  /** Empty directory the pack is staged in before zipping; removed afterwards. */
  readonly stageDir: string
  /** Commit the source export is taken from. */
  readonly gitHead: () => string
  /** Working-tree paths that differ from that commit; warned about, never packed. */
  readonly gitDirty: () => readonly string[]
  /** Write the committed source, minus `SOURCE_EXCLUDES`, to `<stageDir>/source`. */
  readonly exportSource: (stageDir: string) => void
  /** Clock for the pack manifest. */
  readonly now: () => Date
  /** Report non-secret progress. */
  readonly log: (message: string) => void
}

/** What `buildPcBuildPack` produced. */
export interface PcBuildPackResult {
  /** Absolute path of the zip. */
  readonly zipPath: string
  /** Folder name the zip unpacks to. */
  readonly folderName: string
  /** Commit the source came from. */
  readonly commit: string
  /** Desktop package version the pack builds. */
  readonly version: string
}

/** Pack manifest written as `PACK.json`; the build script copies it beside its outputs. */
export interface PcBuildPackManifest {
  readonly version: string
  readonly productName: string
  readonly commit: string
  readonly builtAt: string
  readonly sourceExcludes: readonly string[]
  readonly expectedOutputs: readonly string[]
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  return result.stdout
}

/** Export the committed tree through `git archive` and `tar`, prefixed `source/`. */
export function exportCommittedSource(workspaceRoot: string, stageDir: string): void {
  const archive = join(stageDir, 'source.tar')
  run(
    'git',
    ['archive', '--format=tar', '--prefix=source/', '-o', archive, 'HEAD', '--', '.', ...SOURCE_EXCLUDES.map(path => `:!${path}`)],
    workspaceRoot,
  )
  run('tar', ['-xf', archive, '-C', stageDir], stageDir)
  rmSync(archive)
}

/** Create the real options: git and tar on this machine, output under `dist/pc-build-pack`. */
export function createPcBuildPackOptions(): PcBuildPackOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  return {
    workspaceRoot,
    desktopRoot,
    templatesDir: join(desktopRoot, 'pc-build-pack'),
    outputDir: join(desktopRoot, 'dist', 'pc-build-pack'),
    stageDir: mkdtempSync(join(tmpdir(), 'idealize-pc-build-pack-')),
    gitHead: () => run('git', ['rev-parse', 'HEAD'], workspaceRoot).trim(),
    gitDirty: () => run('git', ['status', '--porcelain'], workspaceRoot).split('\n').filter(line => line.length > 0),
    exportSource: stageDir => exportCommittedSource(workspaceRoot, stageDir),
    now: () => new Date(),
    log: message => console.log(message),
  }
}

/** Assert a staged pack holds everything the Windows build reads and nothing it excludes. */
export function assertPackContents(stageDir: string): void {
  for (const name of [...PACK_TEMPLATES, 'PACK.json']) {
    if (!existsSync(join(stageDir, name))) throw new Error(`pack is missing ${name}`)
  }
  for (const entry of REQUIRED_SOURCE_ENTRIES) {
    if (!existsSync(join(stageDir, 'source', entry))) throw new Error(`pack source is missing ${entry}`)
  }
  for (const excluded of SOURCE_EXCLUDES) {
    if (existsSync(join(stageDir, 'source', excluded))) throw new Error(`pack source must not carry ${excluded}`)
  }
}

/**
 * Stage and zip one pack.
 * @param options - Assembly boundary; `createPcBuildPackOptions()` for the real machine.
 * @returns The zip path, folder name, commit, and version.
 */
export function buildPcBuildPack(options: PcBuildPackOptions): PcBuildPackResult {
  const { version, productName } = readWindowsProductManifest(options.desktopRoot)
  const commit = options.gitHead()
  const dirty = options.gitDirty()
  if (dirty.length > 0) {
    options.log(`Warning: ${dirty.length} working-tree change(s) are not in the pack; it carries commit ${commit.slice(0, 10)} exactly.`)
  }
  const folderName = `IDEalize-PC-build-pack-${version}`
  const zipPath = join(options.outputDir, `${folderName}-${commit.slice(0, 10)}.zip`)

  mkdirSync(options.stageDir, { recursive: true })
  options.exportSource(options.stageDir)
  for (const name of PACK_TEMPLATES) {
    const text = readFileSync(join(options.templatesDir, name), 'utf8')
    writeFileSync(join(options.stageDir, name), text.replace(/\r?\n/gu, '\r\n'))
  }
  const manifest: PcBuildPackManifest = {
    version,
    productName,
    commit,
    builtAt: options.now().toISOString(),
    sourceExcludes: SOURCE_EXCLUDES,
    expectedOutputs: [
      `IDEalize-${version}-x64-Setup.exe`,
      'IDEalize-V1-Setup.exe',
      `IDEalize-${version}-x64-Portable.zip`,
      'SHA256SUMS-windows.txt',
      'build-log.txt',
    ],
  }
  writeFileSync(join(options.stageDir, 'PACK.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  assertPackContents(options.stageDir)

  mkdirSync(options.outputDir, { recursive: true })
  const zip = new AdmZip()
  zip.addLocalFolder(options.stageDir, folderName)
  zip.writeZip(zipPath)
  rmSync(options.stageDir, { recursive: true, force: true })
  options.log(`PC build pack written: ${zipPath}`)
  return { zipPath, folderName, commit, version }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    buildPcBuildPack(createPcBuildPackOptions())
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

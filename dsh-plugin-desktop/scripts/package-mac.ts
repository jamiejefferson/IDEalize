/**
 * Build an unsigned universal macOS DMG on a native macOS host: the CI smoke
 * by default, or with `--public` the artifact the public release ships. The
 * two are the same build with different output directories, because IDEalize
 * V1 ships self-signed (no Apple Developer ID; the installer clears the
 * quarantine flag, as the V0 app's did).
 */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withoutMacReleaseSecrets } from './release-preflight.ts'
import { prepareInstalledMacUniversalRuntime } from './mac-universal.ts'

/** Injectable native macOS packaging boundary used by focused tests. */
export interface MacSmokePackageOptions {
  /** Environment inherited by the packaging command. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the package build. */
  readonly platform: NodeJS.Platform
  /** Node architecture executing the package build. */
  readonly arch: string
  /** Node version executing the package build. */
  readonly nodeVersion: string
  /** Repository root containing the Yarn workspace. */
  readonly workspaceRoot: string
  /** Desktop package root containing electron-builder configuration. */
  readonly desktopRoot: string
  /** Dedicated smoke output directory, isolated from signed release artifacts. */
  readonly outputDir: string
  /** Remove only the dedicated generated smoke output before packaging. */
  readonly resetOutput: () => void
  /** Validate and prepare both architecture-specific runtime trees. */
  readonly prepareRuntime: () => void
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Absolute packaged-DMG verification script. */
  readonly verifier: string
  /** Node executable used to run package-local scripts. */
  readonly nodeExecutable: string
  /** Fail unless the packaged app in the output directory carries a sealed signature. */
  readonly verifySignature: () => void
  /** Execute one packaging command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Report non-secret packaging progress. */
  readonly log: (message: string) => void
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

/** The output directory name for one flavour of the build. */
export function macOutputName(argv: readonly string[]): 'mac-public' | 'mac-smoke' {
  return argv.includes('--public') ? 'mac-public' : 'mac-smoke'
}

function defaultOptions(): MacSmokePackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  const outputDir = resolve(desktopRoot, 'dist', macOutputName(process.argv))
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    outputDir,
    resetOutput: () => rmSync(outputDir, { recursive: true, force: true }),
    prepareRuntime: () => prepareInstalledMacUniversalRuntime(desktopRoot),
    builderCli: require.resolve('electron-builder/cli.js'),
    verifier: fileURLToPath(new URL('./verify-mac-smoke.ts', import.meta.url)),
    nodeExecutable: process.execPath,
    verifySignature: () => {
      const app = resolve(outputDir, 'mac-universal', 'IDEalize V1.app')
      run('codesign', ['--verify', '--deep', '--strict', app], desktopRoot, process.env)
    },
    run,
    log: message => console.log(message),
  }
}

/**
 * Run the headless release gates and package one unsigned macOS DMG smoke.
 *
 * The signed and notarized release stays a manual step on a credentialed
 * machine; this smoke exists so macOS packaging regressions fail in CI before
 * a manual release. The universal target exercises both Intel and Apple
 * Silicon packaging in one artifact.
 * @param options - Injectable process and command boundaries.
 */
export function packageMacSmoke(options: MacSmokePackageOptions = defaultOptions()): void {
  if (options.platform !== 'darwin') {
    throw new Error('macOS DMG smoke must be built on a native macOS host')
  }
  if (options.arch !== 'x64' && options.arch !== 'arm64') {
    throw new Error(`macOS DMG smoke requires x64 or arm64 Node; received ${options.arch}`)
  }
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    throw new Error(
      `macOS DMG smoke requires Node 22.19+ or Node 24.x with bundled Corepack; received ${options.nodeVersion}`,
    )
  }

  const cleanEnvironment = withoutMacReleaseSecrets(options.env)
  const publicBuild = options.outputDir.endsWith('mac-public')
  options.log(publicBuild
    ? 'Building the ad-hoc signed universal macOS DMG the public release ships; the installer clears its quarantine flag.'
    : 'Building an unsigned macOS DMG smoke; signing and notarization are release-only steps.')
  options.run(
    'corepack',
    ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:mac-package'],
    options.workspaceRoot,
    cleanEnvironment,
  )
  options.resetOutput()
  options.prepareRuntime()
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
      '--mac',
      'dmg',
      '--universal',
      '--publish',
      'never',
      '--config.mac.notarize=false',
      '--config.npmRebuild=false',
      `--config.directories.output=${options.outputDir}`,
      // The public app carries a sealed ad-hoc signature. With no signature at
      // all macOS cannot tell which app a folder grant belongs to, so it asked
      // again on every access (JJ, 18 Sep 2026: "dozens of 'IDEalize would like
      // to access files' modals"). Ad-hoc needs no certificate; the hardened
      // runtime stays off, as it is in the locally signed build (package-dir.mjs).
      ...publicBuild ? ['--config.mac.identity=-', '--config.mac.hardenedRuntime=false'] : [],
    ],
    options.desktopRoot,
    publicBuild
      ? cleanEnvironment
      : { ...cleanEnvironment, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  )
  if (publicBuild) options.verifySignature()
  options.run(
    options.nodeExecutable,
    [options.verifier, options.outputDir],
    options.desktopRoot,
    cleanEnvironment,
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageMacSmoke()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

/**
 * The release check: refuse to publish a macOS build that is not hardened, is
 * not signed by the release certificate, or is a proof build.
 *
 *   node scripts/verify-release-shape.ts <disk image>               # the release: the pin must hold
 *   node scripts/verify-release-shape.ts --app <app> --any-certificate   # a local build, shape only
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { PROOF_BUILD_MARKER } from '../src/debug-switches.ts'
import { RELEASE_APP_FOLDER, RELEASE_REQUIREMENT, verifyMacUpdate } from '../src/update-verify.ts'
import { assertCertificateRequirement, assertHardened } from './sign-with-certificate.ts'

/** Electron's bytes for a fuse's state (`FuseState`, which the package does not export). */
const FUSE_ON = 49
const FUSE_OFF = 48

/** The entitlements every release must carry for the app to run at all. */
const REQUIRED_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.device.audio-input',
] as const

/** Entitlements that would reopen what the hardened runtime closes. */
const FORBIDDEN_ENTITLEMENTS = [
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.get-task-allow',
] as const

/** What the shape check reads from one app. */
export interface AppFacts {
  readonly proofMarker: boolean
  readonly displayReport: string
  readonly requirementReport: string
  readonly entitlements: string
  readonly transportSecurity: string
  readonly fuses: Readonly<Record<number, number | undefined>>
}

/**
 * @param facts - what was read from the app.
 * @param options - whether the release certificate's pin applies.
 * @returns every way the build fails the check; empty when it passes.
 */
export function releaseShapeProblems(facts: AppFacts, options: { readonly pinned: boolean }): readonly string[] {
  const problems: string[] = []
  const attempt = (check: () => void): void => {
    try {
      check()
    } catch (cause) {
      problems.push(cause instanceof Error ? cause.message : String(cause))
    }
  }
  if (facts.proofMarker) problems.push(`this is a proof build (it carries ${PROOF_BUILD_MARKER}), so its debugging switches work and it must not ship`)
  attempt(() => { assertHardened(facts.displayReport) })
  attempt(() => { assertCertificateRequirement(facts.requirementReport) })
  if (options.pinned && !facts.requirementReport.includes(`designated => ${RELEASE_REQUIREMENT}`)) {
    problems.push('the designated requirement does not name the release certificate')
  }
  for (const key of REQUIRED_ENTITLEMENTS) {
    if (!facts.entitlements.includes(key)) problems.push(`the app lacks the entitlement ${key}`)
  }
  for (const key of FORBIDDEN_ENTITLEMENTS) {
    if (facts.entitlements.includes(key)) problems.push(`the app carries the entitlement ${key}`)
  }
  const transport = /"NSAllowsArbitraryLoads"\s*:\s*(true|false)/u.exec(facts.transportSecurity)?.[1]
  if (transport !== 'false') problems.push('NSAllowsArbitraryLoads is not false')
  if (!/"NSAllowsLocalNetworking"\s*:\s*true/u.test(facts.transportSecurity)) problems.push('NSAllowsLocalNetworking is not true')
  const expectFuse = (fuse: FuseV1Options, name: string, state: number): void => {
    if (facts.fuses[fuse] !== state) problems.push(`the fuse ${name} should read ${state === FUSE_ON ? 'on' : 'off'}`)
  }
  expectFuse(FuseV1Options.EnableNodeOptionsEnvironmentVariable, 'EnableNodeOptionsEnvironmentVariable', FUSE_OFF)
  expectFuse(FuseV1Options.EnableNodeCliInspectArguments, 'EnableNodeCliInspectArguments', FUSE_OFF)
  // The command-line shim and the free-tokens engine start the app's binary in Node mode.
  expectFuse(FuseV1Options.RunAsNode, 'RunAsNode', FUSE_ON)
  return problems
}

function capture(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return `${result.stdout}${result.stderr}`
}

/** Read the check's facts from an app on disk. */
export async function readAppFacts(app: string): Promise<AppFacts> {
  const wire = await getCurrentFuseWire(app) as unknown as Record<number, number | undefined>
  return {
    proofMarker: existsSync(join(app, 'Contents', 'Resources', PROOF_BUILD_MARKER)),
    displayReport: capture('/usr/bin/codesign', ['--display', '--verbose=2', app]),
    requirementReport: capture('/usr/bin/codesign', ['--display', '--requirements', '-', app]),
    entitlements: capture('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', app]),
    transportSecurity: capture('/usr/bin/plutil', ['-extract', 'NSAppTransportSecurity', 'json', '-o', '-', join(app, 'Contents', 'Info.plist')]),
    fuses: wire,
  }
}

async function checkDiskImage(dmg: string): Promise<readonly string[]> {
  // The updater's own check, so a release that passes here passes on people's Macs.
  await verifyMacUpdate({ dmgPath: dmg, currentVersion: '0.0.0' })
  const mount = mkdtempSync(join(tmpdir(), 'idealize-release-shape-'))
  const attached = spawnSync('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, '-quiet'])
  if (attached.status !== 0) throw new Error(`hdiutil could not open ${dmg}`)
  try {
    return releaseShapeProblems(await readAppFacts(join(mount, RELEASE_APP_FOLDER)), { pinned: true })
  } finally {
    spawnSync('/usr/bin/hdiutil', ['detach', mount, '-force', '-quiet'])
    rmSync(mount, { recursive: true, force: true })
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const appIndex = argv.indexOf('--app')
  const problems = appIndex >= 0
    ? releaseShapeProblems(await readAppFacts(resolve(argv[appIndex + 1] ?? '')), { pinned: !argv.includes('--any-certificate') })
    : await checkDiskImage(resolve(argv[0] ?? ''))
  if (problems.length > 0) {
    console.error(`Release check failed:\n${problems.map(problem => `- ${problem}`).join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log('Release check passed.')
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
}

/**
 * AfterPack hook: check the packaged runtime, then set what makes a macOS build
 * the release shape. Electron Builder flips its own configured fuses after this
 * hook and signs after that, so the signature covers everything done here.
 *
 * Windows packages pass through untouched: `electronFuses` in the manifest has
 * no per-platform form, and JJ decides any Windows change.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses'
import { PROOF_BUILD_MARKER } from '../src/debug-switches.ts'
import { afterPack as verifyPackagedRuntime, type PackagedRuntimeContext } from './verify-packaged-runtime.ts'

/**
 * Cookie encryption asks macOS for a Keychain item, and it is one-way: cookies
 * written after it is on cannot be read once it is off. JJ deferred it to 1.0.20
 * with the move of keys into the Keychain, after the hardened build has proved
 * itself on people's Macs. Turn this on for that change.
 */
export const ENABLE_COOKIE_ENCRYPTION = false

/** Electron Builder's stable enum value for a universal target. */
const UNIVERSAL_ARCH = 4

/** Whether this packaging run is a proof build, which agents test through its debugging switches. */
export function isProofBuildRun(env: NodeJS.ProcessEnv): boolean {
  return env.IDEALIZE_PROOF_BUILD === '1'
}

/**
 * The fuses a macOS build sets beyond the manifest's `runAsNode`.
 * @param proofBuild - whether the debugging routes stay open.
 * @returns the fuse values.
 */
export function macFuses(proofBuild: boolean): Partial<Record<FuseV1Options, boolean>> {
  return {
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: proofBuild,
    [FuseV1Options.EnableNodeCliInspectArguments]: proofBuild,
    [FuseV1Options.EnableCookieEncryption]: ENABLE_COOKIE_ENCRYPTION,
  }
}

/** Seams for tests. */
export interface HardenMacPackageSeams {
  readonly env?: NodeJS.ProcessEnv
  readonly flip?: (path: string, fuses: Partial<Record<FuseV1Options, boolean>>) => Promise<void>
  readonly plutil?: (args: readonly string[]) => void
}

function runPlutil(args: readonly string[]): void {
  const result = spawnSync('/usr/bin/plutil', args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`plutil ${args.join(' ')} exited with ${String(result.status)}`)
}

/**
 * Set the release-shape fuses on one packed macOS app and mark a proof build.
 * A universal build sets them on each architecture's app before the merge, so
 * the merged pass has nothing left to do.
 * @param context - Electron Builder's afterPack context.
 * @param seams - replacement environment and fuse writer.
 */
export async function hardenMacPackage(context: PackagedRuntimeContext, seams: HardenMacPackageSeams = {}): Promise<void> {
  if (context.electronPlatformName !== 'darwin' || context.arch === UNIVERSAL_ARCH) return
  const proofBuild = isProofBuildRun(seams.env ?? process.env)
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const flip = seams.flip ?? (async (path, fuses) => {
    await flipFuses(path, { version: FuseVersion.V1, resetAdHocDarwinSignature: false, ...fuses })
  })
  await flip(app, macFuses(proofBuild))
  // Electron Builder writes NSAllowsArbitraryLoads=true over whatever extendInfo
  // says, so the setting has to follow its plist step. Its loopback exceptions stay.
  const plutil = seams.plutil ?? runPlutil
  const plist = join(app, 'Contents', 'Info.plist')
  plutil(['-replace', 'NSAppTransportSecurity.NSAllowsArbitraryLoads', '-bool', 'false', plist])
  plutil(['-replace', 'NSAppTransportSecurity.NSAllowsLocalNetworking', '-bool', 'true', plist])
  if (proofBuild) {
    const resources = join(app, 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, PROOF_BUILD_MARKER), 'Proof build for testing. The debugging switches work in this build, so it must never ship.\n')
    console.log('Proof build: the debugging switches stay open and the marker is written. A release check refuses this build.')
  }
}

/** The hook Electron Builder runs. */
export default async function afterPack(context: PackagedRuntimeContext): Promise<void> {
  await verifyPackagedRuntime(context)
  await hardenMacPackage(context)
}

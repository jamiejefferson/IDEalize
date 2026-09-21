/**
 * AfterSign hook: re-sign the macOS app with the release certificate when one is named.
 *
 * macOS ties a folder grant to the app's designated requirement. An ad-hoc
 * signature is a new identity on every build, so each update re-asked for
 * every folder. A self-signed certificate gives `identifier + certificate
 * leaf`, which stays the same across updates (JJ, 21 Sep 2026: no paid
 * certificate for a build that goes to colleagues). Without
 * `IDEALIZE_MAC_SIGN_IDENTITY` the hook does nothing and the ad-hoc seal stays.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/** AfterSign fields consumed without importing Electron Builder's incomplete declaration graph. */
export interface SignContext {
  /** Completed platform application directory. */
  readonly appOutDir: string
  /** Electron target platform selected by the packager. */
  readonly electronPlatformName: string
  /** Product metadata used to locate the macOS application bundle. */
  readonly packager: {
    readonly appInfo: {
      readonly productFilename: string
    }
  }
}

/**
 * The identity to sign with, or undefined when this pass keeps its ad-hoc seal.
 *
 * A universal build signs its two per-architecture `-temp` apps before the
 * merge; only the merged app ships, so only that one is re-signed.
 * @param context - Electron Builder's afterSign context.
 * @param env - Environment that may name the identity.
 */
export function certificateIdentity(context: SignContext, env: NodeJS.ProcessEnv): string | undefined {
  const identity = env.IDEALIZE_MAC_SIGN_IDENTITY?.trim()
  if (identity === undefined || identity === '') return undefined
  if (context.electronPlatformName !== 'darwin') return undefined
  if (context.appOutDir.endsWith('-temp')) return undefined
  return identity
}

/**
 * Re-sign the packaged app and check the seal.
 * @param context - Electron Builder's afterSign context.
 */
export default function signWithCertificate(context: SignContext): void {
  const identity = certificateIdentity(context, process.env)
  if (identity === undefined) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  for (const args of [
    ['--force', '--deep', '--sign', identity, app],
    ['--verify', '--deep', '--strict', app],
  ]) {
    const result = spawnSync('codesign', args, { stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`codesign ${args[0] ?? ''} exited with ${String(result.status)}`)
  }
  console.log(`Signed with the release certificate ${identity}.`)
}

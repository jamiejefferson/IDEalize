/**
 * AfterSign hook: re-sign the macOS app with the release certificate when one is named.
 *
 * macOS ties a folder grant to the app's designated requirement. An ad-hoc
 * signature is a new identity on every build, so each update re-asked for
 * every folder. A self-signed certificate gives `identifier + certificate
 * root`, which stays the same across updates (JJ, 21 Sep 2026: no paid
 * certificate for a build that goes to colleagues). Without
 * `IDEALIZE_MAC_SIGN_IDENTITY` the hook does nothing and the ad-hoc seal stays.
 *
 * The app signs inside-out with the hardened runtime. `codesign --deep` applies
 * entitlements unreliably to helpers and skips native code under Resources, so
 * every piece of code gets its own pass and the entitlements reach exactly the
 * app and its helper apps.
 */

import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** The entitlements the app and its helper apps carry. */
export const MAC_ENTITLEMENTS_PATH = fileURLToPath(new URL('../build/idealize-mac.entitlements.plist', import.meta.url))

/** The `codesign` flag bit that marks the hardened runtime. */
const RUNTIME_FLAG = 0x10000

/** One finished signing command. */
export interface SignCommandResult {
  readonly status: number
  readonly output: string
}

/** Run one signing command. */
export type SignCommand = (args: readonly string[]) => SignCommandResult

function runCodesign(args: readonly string[]): SignCommandResult {
  const result = spawnSync('codesign', args, { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` }
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

const MH_EXECUTE = 2
const MH_DYLIB = 6
const MH_BUNDLE = 8
const MAX_FAT_ARCHITECTURES = 16

/** Whether a file is code the loader can run: an executable, a library or a loadable module. */
export function isLoadableMachO(path: string): boolean {
  const descriptor = openSync(path, 'r')
  try {
    const header = Buffer.alloc(32)
    if (readSync(descriptor, header, 0, header.byteLength, 0) < 16) return false
    const magic = header.readUInt32BE(0)
    if (magic === 0xcffaedfe || magic === 0xcefaedfe) return loadableFileType(header.readUInt32LE(12))
    if (magic !== 0xcafebabe && magic !== 0xcafebabf) return false
    // A Java class shares this magic; its next field reads far above any real slice count.
    const slices = header.readUInt32BE(4)
    if (slices === 0 || slices > MAX_FAT_ARCHITECTURES) return false
    const offset = magic === 0xcafebabe ? header.readUInt32BE(16) : Number(header.readBigUInt64BE(16))
    const slice = Buffer.alloc(16)
    if (readSync(descriptor, slice, 0, slice.byteLength, offset) < 16) return false
    return loadableFileType(slice.readUInt32LE(12))
  } finally {
    closeSync(descriptor)
  }
}

function loadableFileType(fileType: number): boolean {
  return fileType === MH_EXECUTE || fileType === MH_DYLIB || fileType === MH_BUNDLE
}

/** One signing pass: the code's path, and whether it takes the entitlements. */
export interface SignStep {
  readonly path: string
  readonly entitled: boolean
}

/**
 * The bundle's main executable signs with its bundle, so it takes no pass of its own.
 * @param file - a file path under the app.
 * @returns true for `X.app/Contents/MacOS/X` and `X.framework/Versions/V/X`.
 */
function isBundleMainExecutable(file: string): boolean {
  const name = basename(file)
  const parent = dirname(file)
  if (basename(parent) === 'MacOS' && basename(dirname(parent)) === 'Contents') {
    return basename(dirname(dirname(parent))) === `${name}.app`
  }
  return basename(dirname(parent)) === 'Versions' && basename(dirname(dirname(parent))) === `${name}.framework`
}

/**
 * Every signing pass an app needs, innermost first, with the app itself last.
 * @param app - the app bundle.
 * @param isCode - whether one file is loadable code; replaced in tests.
 * @returns the ordered passes.
 */
export function macSigningPlan(app: string, isCode: (path: string) => boolean = isLoadableMachO): readonly SignStep[] {
  const steps: SignStep[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        visit(path)
        if (entry.name.endsWith('.app')) steps.push({ path, entitled: true })
        else if (entry.name.endsWith('.framework')) steps.push({ path, entitled: false })
      } else if (entry.isFile() && !isBundleMainExecutable(path) && isCode(path)) {
        steps.push({ path, entitled: false })
      }
    }
  }
  visit(join(app, 'Contents'))
  const depth = (path: string): number => path.split(sep).length
  // The sort is stable, so a bundle stays after the code the walk found inside it.
  steps.sort((left, right) => depth(right.path) - depth(left.path))
  return [...steps, { path: app, entitled: true }]
}

/**
 * Sign one app inside-out with the hardened runtime and prove the result.
 * @param app - the app bundle.
 * @param identity - the certificate's name or SHA-1.
 * @param options - replacement entitlements path, command runner and plan, for tests.
 */
export function signMacApp(
  app: string,
  identity: string,
  options: { readonly run?: SignCommand; readonly plan?: readonly SignStep[] } = {},
): void {
  const run = options.run ?? runCodesign
  const must = (args: readonly string[]): string => {
    const result = run(args)
    if (result.status !== 0) {
      throw new Error(`codesign ${args.join(' ')} exited with ${String(result.status)}: ${result.output.trim()}`)
    }
    return result.output
  }
  for (const step of options.plan ?? macSigningPlan(app)) {
    must([
      '--force',
      '--options', 'runtime',
      ...step.entitled ? ['--entitlements', MAC_ENTITLEMENTS_PATH] : [],
      '--sign', identity,
      step.path,
    ])
  }
  must(['--verify', '--deep', '--strict', app])
  assertHardened(must(['--display', '--verbose=2', app]))
  assertCertificateRequirement(must(['--display', '--requirements', '-', app]))
}

/** Fail unless a `codesign --display` report carries the hardened-runtime flag. */
export function assertHardened(report: string): void {
  const flags = /flags=0x([0-9a-f]+)/iu.exec(report)?.[1]
  if (flags === undefined || (Number.parseInt(flags, 16) & RUNTIME_FLAG) === 0) {
    throw new Error(`the app was signed without the hardened runtime: ${report.trim()}`)
  }
}

/**
 * Fail unless the designated requirement keeps the form macOS ties folder
 * grants to. Any other form costs every user a round of folder prompts. The
 * release certificate reads `certificate root` and the local one `certificate
 * leaf`; both pin one certificate, and the release check pins the exact text.
 */
export function assertCertificateRequirement(report: string): void {
  if (!/designated => identifier "[^"]+" and certificate (?:root|leaf) = H"[0-9a-f]{40}"/iu.test(report)) {
    throw new Error(`the designated requirement changed form: ${report.trim()}`)
  }
}

/**
 * Re-sign the packaged app and check the seal.
 * @param context - Electron Builder's afterSign context.
 */
export default function signWithCertificate(context: SignContext): void {
  const identity = certificateIdentity(context, process.env)
  if (identity === undefined) return
  signMacApp(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`), identity)
  console.log(`Signed with the release certificate ${identity}.`)
}

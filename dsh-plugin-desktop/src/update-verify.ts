/**
 * Who may ship IDEalize to a Mac: the check that stands between a downloaded
 * disk image and the person's Applications folder.
 *
 * The pin names the release certificate as a fixed value and never reads the
 * running app's own signature. A build JJ landed locally is signed by a second
 * certificate ("IDEalize Local Signing"), and it must still accept a release
 * signed by the release certificate. Replacing the certificate needs one
 * release that accepts both before any release is signed by the new one.
 *
 * The requirement reads `certificate root`, because a self-signed leaf is its
 * own root.
 */

import { spawn } from 'node:child_process'
import { lstat, mkdtemp, readdir, readlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareSemVerVersions, parseSemVer } from './update-checker.ts'
import { UpdateDownloadError } from './update-download.ts'

/** SHA-1 of the self-signed "IDEalize Signing" certificate, which signs every public macOS release. */
export const RELEASE_CERTIFICATE_SHA1 = '39aa065ec4f9a9025aaad0dda3d74c8c1111fcd3'

/** The bundle identifier every release carries. */
export const RELEASE_BUNDLE_ID = 'ai.projject.idealize.v1'

/** The app's folder name on the disk image. */
export const RELEASE_APP_FOLDER = 'IDEalize V1.app'

/** The code requirement a genuine release satisfies; `install.sh` holds the same text. */
export const RELEASE_REQUIREMENT = `identifier "${RELEASE_BUNDLE_ID}" and certificate root = H"${RELEASE_CERTIFICATE_SHA1}"`

const ATTACH_TIMEOUT_MS = 2 * 60_000
/** A full check of the 1.0.18 image took 29 seconds on an Apple Silicon laptop. */
const CODESIGN_TIMEOUT_MS = 5 * 60_000
const READ_TIMEOUT_MS = 15_000
const DETACH_TIMEOUT_MS = 30_000
const TOOL_ENVIRONMENT = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }

/** One finished command. */
export interface VerifyCommandResult {
  readonly status: number
  readonly stdout: string
}

/** Run one system command with its arguments and a time limit. */
export type VerifyCommand = (
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
) => Promise<VerifyCommandResult>

/** What one disk image check needs. */
export interface VerifyMacUpdateOptions {
  /** Absolute path to the downloaded disk image. */
  readonly dmgPath: string
  /** The version this app is running, which the update must beat. */
  readonly currentVersion: string
  /** Cancellation owned by the update coordinator. */
  readonly signal?: AbortSignal
  /** Replaces the system command runner in tests. */
  readonly run?: VerifyCommand
  /** Replaces the private mount folder in tests. */
  readonly makeMountPoint?: () => Promise<string>
}

/** What a passed check learned about the update. */
export interface VerifiedMacUpdate {
  /** The version the signed app inside the image declares. */
  readonly version: string
}

const runSystemCommand: VerifyCommand = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    env: TOOL_ENVIRONMENT,
    // No stdin: a disk image carrying a licence prompt must fail, never wait.
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
    ...options.signal === undefined ? {} : { signal: options.signal },
  })
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.once('error', reject)
  child.once('close', (status) => { resolve({ status: status ?? -1, stdout }) })
})

function untrusted(reason: string): UpdateDownloadError {
  return new UpdateDownloadError('untrusted-artifact', `The update was refused: ${reason}.`)
}

/**
 * Only the app and the shortcut to Applications may show in the image's
 * window. The image itself carries no signature, so anything else there, such
 * as a decoy installer beside a genuine app, would escape the app's check.
 */
async function assertImageContents(mountPoint: string): Promise<string> {
  const appPath = join(mountPoint, RELEASE_APP_FOLDER)
  for (const name of await readdir(mountPoint)) {
    if (name.startsWith('.')) continue
    if (name === RELEASE_APP_FOLDER) continue
    if (name === 'Applications') {
      const entry = await lstat(join(mountPoint, name))
      if (entry.isSymbolicLink() && await readlink(join(mountPoint, name)) === '/Applications') continue
    }
    throw untrusted(`the disk image carries an unexpected item, ${JSON.stringify(name)}`)
  }
  const app = await lstat(appPath).catch(() => undefined)
  if (app === undefined || !app.isDirectory() || app.isSymbolicLink()) {
    throw untrusted(`the disk image does not carry ${RELEASE_APP_FOLDER}`)
  }
  return appPath
}

/**
 * Mount a disk image read-only and refuse it unless the app inside is signed
 * by the release certificate and is newer than the running version.
 *
 * Fails closed: a check that cannot finish counts as a refusal. Nothing here
 * touches the running app, and the image is detached before this returns.
 * @param options - the image, the running version and the injectable seams.
 * @returns the version the signed app declares.
 * @throws {UpdateDownloadError} `untrusted-artifact` or `not-newer`.
 */
export async function verifyMacUpdate(options: VerifyMacUpdateOptions): Promise<VerifiedMacUpdate> {
  const run = options.run ?? runSystemCommand
  const signal = options.signal
  const mountPoint = await (options.makeMountPoint ?? (() => mkdtemp(join(tmpdir(), 'idealize-update-'))))()
  const timed = (timeoutMs: number) => ({ timeoutMs, ...signal === undefined ? {} : { signal } })
  let mounted = false
  try {
    const attached = await run('/usr/bin/hdiutil', [
      'attach', options.dmgPath, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint, '-quiet',
    ], timed(ATTACH_TIMEOUT_MS))
    if (attached.status !== 0) throw untrusted('the disk image could not be opened')
    mounted = true

    const appPath = await assertImageContents(mountPoint)
    const checked = await run('/usr/bin/codesign', [
      '--verify', '--deep', '--strict', `--test-requirement==${RELEASE_REQUIREMENT}`, appPath,
    ], timed(CODESIGN_TIMEOUT_MS))
    if (checked.status !== 0) throw untrusted('the app is not signed by the IDEalize release certificate')

    const read = await run('/usr/bin/plutil', [
      '-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist'),
    ], timed(READ_TIMEOUT_MS))
    const version = read.stdout.trim()
    const parsed = parseSemVer(version)
    if (read.status !== 0 || parsed === null || parsed.prerelease.length > 0 || parsed.version !== version) {
      throw untrusted('the app does not state a release version')
    }
    const comparison = compareSemVerVersions(version, options.currentVersion)
    if (comparison === null) throw untrusted('the running version could not be compared')
    if (comparison <= 0) {
      throw new UpdateDownloadError(
        'not-newer',
        `The update was refused: ${version} is not newer than the running ${options.currentVersion}.`,
      )
    }
    return { version }
  } catch (cause) {
    if (cause instanceof UpdateDownloadError) throw cause
    if (signal?.aborted === true || (cause as { name?: unknown }).name === 'AbortError') throw cause
    throw new UpdateDownloadError('untrusted-artifact', 'The update was refused: the check could not finish.', { cause })
  } finally {
    if (mounted) await detach(run, mountPoint)
    await rmdir(mountPoint).catch(() => undefined)
  }
}

async function detach(run: VerifyCommand, mountPoint: string): Promise<void> {
  const first = await run('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet'], { timeoutMs: DETACH_TIMEOUT_MS })
    .catch(() => ({ status: -1, stdout: '' }))
  if (first.status === 0) return
  await run('/usr/bin/hdiutil', ['detach', mountPoint, '-force', '-quiet'], { timeoutMs: DETACH_TIMEOUT_MS })
    .catch(() => undefined)
}

/** The words a refused update shows, in plain language with the next step. */
export function updateRefusalMessage(code: 'untrusted-artifact' | 'not-newer'): { title: string; message: string; detail: string } {
  if (code === 'not-newer') {
    return {
      title: 'Update Not Installed',
      message: 'This update is not newer than the version you have, so IDEalize did not install it.',
      detail: 'The download has been deleted and your copy of IDEalize has not changed. You can keep working, and IDEalize will offer the next version when it is ready.',
    }
  }
  return {
    title: 'Update Not Installed',
    message: 'IDEalize could not confirm this update is genuine, so it did not install it.',
    detail: 'The download has been deleted and your copy of IDEalize has not changed, so you can keep working. To update, download IDEalize from idealize.projject.ai.',
  }
}

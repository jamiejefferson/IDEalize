/**
 * Folder access probes for the first-run orientation and the workspace-alias
 * seam. A probe answers whether IDEalize can actually use a folder — it
 * exists, is a directory, lists, and accepts a file write — and, when it
 * cannot, explains why in a plain sentence the setup overlay shows verbatim
 * (SET-04).
 * @module @idealize/setup/probe
 */

import { randomBytes } from 'node:crypto'
import { readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/**
 * Access verdict for one probed folder. `ok` means the folder exists, is a
 * directory, and passed both the read and the write probe; every other state
 * names the first failed check.
 */
export type AliasAccessState = 'ok' | 'missing' | 'not-a-directory' | 'unreadable' | 'unwritable'

/** One probe's verdict; `reason` is present exactly when `state` is not `ok`. */
export interface FolderProbe {
  /** The access verdict. */
  state: AliasAccessState
  /** Plain-language explanation of the failure, shown to the user verbatim. */
  reason?: string
}

/** The errno code of a Node fs failure, or undefined for non-errno errors. */
function codeOf(error: unknown): string | undefined {
  /* v8 ignore next 3 -- an fs rejection always carries an errno code; the guard only types the read. */
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

/**
 * Probe one folder: absolute path, exists, is a directory, lists (read), and
 * accepts creating and deleting a throwaway dotfile (write). Stops at the
 * first failed check and explains it plainly.
 * @param path - the folder to probe, expected absolute.
 * @returns the verdict with a plain-language reason on failure.
 */
export async function probeFolder(path: string): Promise<FolderProbe> {
  if (!isAbsolute(path)) {
    return {
      state: 'missing',
      reason: `"${path}" is not a full folder path. Use one that starts at the root, like /Users/you/Projects.`,
    }
  }
  let info
  try {
    info = await stat(path)
  } catch (error) {
    if (codeOf(error) === 'EACCES' || codeOf(error) === 'EPERM') {
      return {
        state: 'unreadable',
        reason: `IDEalize is not allowed to look at ${path}. Check the folder's permissions, or grant access under System Settings → Privacy & Security → Files and Folders.`,
      }
    }
    return {
      state: 'missing',
      reason: `There is no folder at ${path}. Check the location still exists (is the drive connected?), or pick a different folder.`,
    }
  }
  if (!info.isDirectory()) {
    return {
      state: 'not-a-directory',
      reason: `${path} is a file, not a folder. Pick a folder instead.`,
    }
  }
  try {
    await readdir(path)
  } catch {
    return {
      state: 'unreadable',
      reason: `IDEalize cannot read inside ${path}. Check the folder's permissions, or grant access under System Settings → Privacy & Security → Files and Folders.`,
    }
  }
  const probeFile = join(path, `.idealize-probe-${randomBytes(6).toString('hex')}`)
  try {
    await writeFile(probeFile, '', { flag: 'wx' })
  } catch {
    return {
      state: 'unwritable',
      reason: `IDEalize cannot save files inside ${path}. Check the folder's permissions, or pick a folder you own.`,
    }
  }
  try {
    await unlink(probeFile)
  } catch {
    // Only the deletion of the just-created probe dotfile can land here (a
    // permission flip mid-probe); a leftover empty dotfile is harmless and
    // the write itself already proved the folder writable.
  }
  return { state: 'ok' }
}

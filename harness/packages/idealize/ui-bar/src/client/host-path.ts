/**
 * Host paths as the browser meets them. The host names every path in its own
 * platform's form: a Mac writes `/Users/jj/proj`, a Windows PC writes
 * `C:\Users\jj\proj`. The Files pane joins and compares these strings, so
 * each join uses the host's separator and each comparison accepts either
 * separator, and a Windows path compares without case, as NTFS does.
 */

/** Whether a path is written the Windows way: a drive letter or a UNC share. */
function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/** The separator a host path is written with. */
export function separatorOf(path: string): string {
  return isWindowsPath(path) || (path.includes('\\') && !path.includes('/')) ? '\\' : '/'
}

/**
 * One child path under a host folder, written with the folder's own separator.
 * @param parent - the host folder.
 * @param relative - a name, or a `/`-separated relative path.
 * @returns the joined path.
 */
export function joinHostPath(parent: string, relative: string): string {
  const sep = separatorOf(parent)
  const tail = sep === '\\' ? relative.replace(/\//g, '\\') : relative
  return parent.endsWith(sep) ? `${parent}${tail}` : `${parent}${sep}${tail}`
}

/** A path in the form two host paths are compared in: one separator, and no case on Windows. */
function comparable(path: string): string {
  if (!isWindowsPath(path)) return path.replace(/\/+$/, '') || '/'
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * Whether `path` sits strictly beneath the folder `root`.
 * @param root - the host folder.
 * @param path - the candidate path.
 */
export function isBeneath(root: string, path: string): boolean {
  const base = comparable(root)
  const candidate = comparable(path)
  const sep = isWindowsPath(root) ? '\\' : '/'
  return candidate.startsWith(base.endsWith(sep) ? base : `${base}${sep}`) && candidate !== base
}

/**
 * Whether `path` is the folder `root` itself or sits beneath it.
 * @param root - the host folder.
 * @param path - the candidate path.
 */
export function isAtOrBeneath(root: string, path: string): boolean {
  return comparable(root) === comparable(path) || isBeneath(root, path)
}

/** Labels that name Finder or the Trash, each with the wording a Windows PC uses. */
type FileManagerKey = 'files.reveal' | 'files.revealFailed' | 'files.trash' | 'files.trashConfirm' | 'files.trashed' | 'files.trashFailed'

/**
 * The label key for this computer's file manager: Explorer and the Recycle Bin
 * on Windows, Finder and the Trash everywhere else.
 * @param key - the macOS key.
 * @param userAgent - the browser's user agent, which names Windows on a PC.
 */
export function fileManagerKey<K extends FileManagerKey>(
  key: K,
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): K | `${K}.windows` {
  return /Windows/.test(userAgent) ? `${key}.windows` : key
}

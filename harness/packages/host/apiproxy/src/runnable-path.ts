/**
 * Whether opening a path with its default application would run it. macOS
 * LaunchServices runs a script bundle, an app or an installer, and an
 * extension-less executable opens in Terminal and runs; Windows runs its
 * script and installer types. `host.openPath` refuses these, matching the
 * Files pane's own open route (security audit, 9 Oct 2026).
 */

import { stat } from 'node:fs/promises'
import { extname } from 'node:path'

const RUNS_WHEN_OPENED = new Set([
  '.command', '.tool', '.app', '.workflow', '.action', '.terminal', '.scpt', '.scptd', '.applescript', '.pkg', '.mpkg',
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.msi', '.msp',
  '.scr', '.pif', '.cpl', '.lnk', '.url', '.reg', '.jar', '.appref-ms', '.application', '.msc', '.inf',
])

/**
 * @param path - the absolute path about to be opened.
 * @returns true when opening it would run code.
 */
export async function runsWhenOpened(path: string): Promise<boolean> {
  if (RUNS_WHEN_OPENED.has(extname(path).toLowerCase())) return true
  try {
    const info = await stat(path)
    return info.isFile() && extname(path) === '' && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

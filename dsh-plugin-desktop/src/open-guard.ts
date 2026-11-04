/**
 * What the app may hand to the operating system to open. Powell's Open button
 * takes its target from a model's reply, so a poisoned reply could otherwise
 * name a script to run, or a link in any scheme.
 *
 * Holds the same list as the Host's own check (`runnable-path` in
 * `@deepseek-ai/dsh-host-apiproxy`), which that package does not export.
 */

import { stat } from 'node:fs/promises'
import { extname } from 'node:path'

const RUNS_WHEN_OPENED: ReadonlySet<string> = new Set([
  '.command', '.tool', '.app', '.workflow', '.action', '.terminal', '.scpt', '.scptd', '.applescript', '.pkg', '.mpkg',
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.msi', '.msp',
  '.scr', '.pif', '.cpl', '.lnk', '.url', '.reg', '.jar', '.appref-ms', '.application', '.msc', '.inf',
  // The disk images and installers macOS mounts or runs on opening.
  '.dmg', '.iso', '.sh', '.zsh', '.bash', '.webloc', '.inetloc', '.fileloc',
])

const SCHEME = /^[a-z][a-z0-9+.-]*:/iu

/** What opening one target came to. */
export type OpenDecision =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * Whether opening a path with its default application would run it.
 * @param path - the absolute path about to be opened.
 * @returns true when opening it would run code. An extension-less executable counts, because macOS opens it in Terminal and runs it.
 */
export async function runsWhenOpened(path: string): Promise<boolean> {
  // A trailing dot or slash must not hide the real type.
  const name = path.replace(/[./\\\s]+$/u, '')
  if (RUNS_WHEN_OPENED.has(extname(name).toLowerCase())) return true
  try {
    const info = await stat(path)
    return info.isFile() && extname(name) === '' && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/**
 * Decide what opening one target may do: an https link goes to the browser, a
 * path that would not run goes to its app, and everything else is refused.
 * @param target - the URL or absolute path asked for.
 * @returns the decision.
 */
export async function decideOpen(target: string): Promise<OpenDecision> {
  if (/^[a-z]:[\\/]/iu.test(target) === false && SCHEME.test(target)) {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      return { kind: 'refused', reason: 'that address could not be read' }
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return { kind: 'refused', reason: 'only https links can be opened from here' }
    }
    return { kind: 'url', url: url.href }
  }
  if (await runsWhenOpened(target)) {
    return { kind: 'refused', reason: 'that file would run as a program, so it was not opened' }
  }
  return { kind: 'path', path: target }
}

/** The operating system's two ways of opening something. */
export interface OpenActions {
  readonly openPath: (path: string) => Promise<string>
  readonly openExternal: (url: string) => Promise<void>
}

/**
 * Open one target under these rules.
 * @param target - the URL or absolute path asked for.
 * @param actions - Electron's `shell`, or a stand-in.
 * @returns an empty string on success, or the reason, as `shell.openPath` reports it.
 */
export async function openGuarded(target: string, actions: OpenActions): Promise<string> {
  const decision = await decideOpen(target)
  if (decision.kind === 'refused') return decision.reason
  if (decision.kind === 'path') return await actions.openPath(decision.path)
  await actions.openExternal(decision.url)
  return ''
}

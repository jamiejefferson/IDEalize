/**
 * What Powell's Open button may reach. The target comes from a model's reply, or
 * from a provider's error text, and a hidden instruction in a page can put
 * anything there: `[open: /path/x.command]` would run a script, and any URL
 * scheme could hand the link to another app. So the button opens https pages,
 * and files or folders inside a project, and nothing that runs when opened.
 * @module @idealize/powell/open-target
 */

import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, sep } from 'node:path'
import { runsWhenOpened } from '@deepseek-ai/dsh-host-apiproxy'

/** A target that passed, in the form to open. */
export type OpenTarget = { kind: 'url'; url: string } | { kind: 'path'; path: string }

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Decide whether Powell may open a target.
 * @param target - the URL or absolute path from a reply.
 * @param roots - the project folders a path may sit in.
 * @returns the target to open; undefined when it is refused.
 */
export async function checkOpenTarget(target: string, roots: readonly string[]): Promise<OpenTarget | undefined> {
  if (SCHEME.test(target)) {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      return undefined
    }
    // `https://bank.example@elsewhere.test` shows one site and opens another.
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
    return { kind: 'url', url: url.href }
  }
  if (!isAbsolute(target)) return undefined
  // Resolve first: a harmless name in a project can be a link to a script elsewhere.
  let path: string
  try {
    path = await realpath(target)
  } catch {
    return undefined
  }
  const real = await Promise.all(roots.map(root => realpath(root).catch(() => undefined)))
  const inside = real.some(root => root !== undefined && (path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)))
  if (!inside || await runsWhenOpened(path)) return undefined
  return { kind: 'path', path }
}

/**
 * The button's words, naming where it goes.
 * @param target - the URL or path.
 * @returns "Open example.com", or "Open notes.md".
 */
export function openButtonLabel(target: string): string {
  if (SCHEME.test(target)) {
    try {
      return `Open ${new URL(target).hostname}`
    } catch {
      return 'Open'
    }
  }
  return `Open ${basename(target)}`
}

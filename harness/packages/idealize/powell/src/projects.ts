/**
 * The project index Powell switches between (spec §4: active project is
 * explicit state). Three sources merge by name: the projects IDEalize has
 * opened (the workspace registry), the folders under the projects root, and
 * the project notes in the documentation vault. A project keeps its working
 * folder and its notes folder side by side, so "the Idealize docs" and "the
 * Idealize repo" resolve to the same entry.
 * @module @idealize/powell/projects
 */

import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** One project Powell can set as active. */
export interface ProjectEntry {
  /** Display name. */
  name: string
  /** The working folder (repository or project folder), when one is known. */
  path?: string
  /** The project's notes folder in the documentation vault, when it has one. */
  notes?: string
}

/**
 * The matching key for a project name: lower case, letters and digits only.
 * @param name - a project or folder name, or what the user said.
 * @returns the key.
 */
export function projectKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Merge the three sources into one list, by name.
 * @param known - folders IDEalize has opened as projects.
 * @param rootFolders - folders under the projects root.
 * @param noteFolders - project folders in the vault's `Projects/`.
 * @returns entries sorted by name.
 */
export function mergeProjects(known: readonly string[], rootFolders: readonly string[], noteFolders: readonly string[]): ProjectEntry[] {
  const byKey = new Map<string, ProjectEntry>()
  const add = (folder: string, kind: 'path' | 'notes'): void => {
    const name = basename(folder)
    if (name === '' || name.startsWith('.') || name.startsWith('_')) return
    const key = projectKey(name)
    if (key === '') return
    const entry = byKey.get(key) ?? { name }
    if (kind === 'path' && entry.path === undefined) entry.path = folder
    if (kind === 'notes' && entry.notes === undefined) entry.notes = folder
    byKey.set(key, entry)
  }
  for (const folder of known) add(folder, 'path')
  for (const folder of rootFolders) add(folder, 'path')
  for (const folder of noteFolders) add(folder, 'notes')
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Find the project a spoken or typed name means. Exact key first, then a
 * unique prefix, then a unique substring; speech recognisers drop and merge
 * words ("idea lies" for IDEalize), so spaces never matter.
 * @param projects - the index.
 * @param said - what the user called it.
 * @returns the match, the candidates when it is ambiguous, or nothing.
 */
export function resolveProject(projects: readonly ProjectEntry[], said: string): { match?: ProjectEntry; candidates: ProjectEntry[] } {
  const key = projectKey(said)
  if (key === '') return { candidates: [] }
  const exact = projects.find(project => projectKey(project.name) === key)
  if (exact !== undefined) return { match: exact, candidates: [exact] }
  const prefixed = projects.filter(project => projectKey(project.name).startsWith(key) || key.startsWith(projectKey(project.name)))
  if (prefixed.length === 1) return { match: prefixed[0] as ProjectEntry, candidates: prefixed }
  if (prefixed.length > 1) return { candidates: prefixed }
  const contained = projects.filter(project => projectKey(project.name).includes(key))
  if (contained.length === 1) return { match: contained[0] as ProjectEntry, candidates: contained }
  if (contained.length > 1) return { candidates: contained }
  // Close spellings last ("idea lies" for IDEalize): a quarter of the name may differ.
  const scored = projects
    .map(project => ({ project, distance: editDistance(projectKey(project.name), key) }))
    .filter(entry => entry.distance <= Math.max(1, Math.floor(projectKey(entry.project.name).length / 4)))
    .sort((a, b) => a.distance - b.distance)
  const best = scored[0]
  const clear = best !== undefined && (scored[1] === undefined || scored[1].distance > best.distance)
  if (clear) return { match: best.project, candidates: [best.project] }
  return { candidates: scored.map(entry => entry.project) }
}

/**
 * Levenshtein distance between two keys.
 * @param a - one key.
 * @param b - the other.
 * @returns the number of single-character edits between them.
 */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/**
 * The subfolders of a folder, absolute; nothing when it cannot be read.
 * @param folder - the parent.
 * @returns absolute child folder paths.
 */
export async function subfolders(folder: string | undefined): Promise<string[]> {
  if (folder === undefined || folder === '') return []
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(folder, entry.name))
  } catch {
    return []
  }
}

export { readProjectSwitch, type ProjectSwitch } from './switch.ts'

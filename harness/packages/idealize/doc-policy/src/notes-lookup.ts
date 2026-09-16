/**
 * Structure-reading project-note lookup: find the `Projects/<name>/_index.md`
 * whose `repo:` frontmatter names a given repository. Moved here from
 * `@idealize/vault` because the `_index.md`/`repo:` convention is canonical
 * structure this package owns; vault keeps the commit-evidence writes built
 * on top of these lookups.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'

const run = promisify(execFile)

/** One project note: its path and parsed pointers. */
export interface ProjectNote {
  path: string
  repo: string
  lastTouched: string | undefined
}

/**
 * Resolve a working directory to its git toplevel.
 * @param cwd - any directory.
 * @returns the repository toplevel through realpath, or `undefined` outside a repo.
 */
export async function gitToplevel(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])
    return await realpath(stdout.trim())
  } catch {
    return undefined
  }
}

/**
 * Parse the `repo:` and `last_touched:` pointers of one note.
 * @param markdown - complete note text.
 * @returns the pointer fields present in the note's frontmatter.
 */
export function parseNotePointers(markdown: string): { repo?: string; lastTouched?: string } {
  const { fields } = parseFrontmatter(markdown)
  const pointers: { repo?: string; lastTouched?: string } = {}
  if (fields.repo !== undefined && fields.repo !== '') pointers.repo = fields.repo
  const touched = fields.last_touched
  if (touched !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(touched)) pointers.lastTouched = touched
  return pointers
}

/**
 * Scan each project folder under the vault's Projects/ for an `_index.md` carrying `repo:`.
 * @param folder - absolute path of the documentation folder.
 * @returns every project note with a repo pointer.
 */
export async function projectNotes(folder: string): Promise<ProjectNote[]> {
  const projectsDir = join(folder, 'Projects')
  let entries: string[]
  try {
    entries = await readdir(projectsDir)
  } catch {
    return []
  }
  const notes: ProjectNote[] = []
  for (const entry of entries) {
    const notePath = join(projectsDir, entry, '_index.md')
    let markdown: string
    try {
      markdown = await readFile(notePath, 'utf8')
    } catch {
      continue
    }
    const { repo, lastTouched } = parseNotePointers(markdown)
    if (repo === undefined) continue
    notes.push({ path: notePath, repo, lastTouched })
  }
  return notes
}

/**
 * The note whose `repo:` names this repository, resolved through realpath.
 * @param folder - absolute path of the documentation folder.
 * @param repoToplevel - realpath'd repository toplevel.
 * @returns the matching note, or `undefined`.
 */
export async function noteForRepo(folder: string, repoToplevel: string): Promise<ProjectNote | undefined> {
  for (const note of await projectNotes(folder)) {
    try {
      if (await realpath(note.repo) === repoToplevel) return note
    } catch {
      // A note pointing at a moved/deleted repo cannot match a live cwd.
    }
  }
  return undefined
}

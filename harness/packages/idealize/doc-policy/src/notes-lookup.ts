/**
 * Structure-reading project-note lookup: find the `Projects/<name>/_index.md`
 * whose `repo:` frontmatter names a given repository. Moved here from
 * `@idealize/vault` because the `_index.md`/`repo:` convention is canonical
 * structure this package owns; vault keeps the commit-evidence writes built
 * on top of these lookups.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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
 * The checkout paths a hand-written `repo:` pointer names. People annotate the
 * field (`/dev/app (V1); V0 frozen at /old/app`), and an annotated pointer read
 * as one path matches no repository, so the project silently loses its
 * documentation context. Each `;`-separated part yields the text from its first
 * `/` or `~/`, as written and with a trailing parenthetical removed.
 * @param pointer - the raw `repo:` value.
 * @returns candidate absolute paths, most literal first.
 */
export function repoPaths(pointer: string): string[] {
  const paths: string[] = []
  for (const part of pointer.split(';')) {
    const start = part.search(/~\/|\//)
    if (start === -1) continue
    const written = part.slice(start).trim()
    for (const candidate of [written, written.replace(/\s+\([^)]*\)$/, '')]) {
      const path = candidate.startsWith('~/') ? join(homedir(), candidate.slice(2)) : candidate
      if (path !== '' && !paths.includes(path)) paths.push(path)
    }
  }
  return paths
}

/**
 * The note whose `repo:` names this repository, resolved through realpath.
 * @param folder - absolute path of the documentation folder.
 * @param repoToplevel - realpath'd repository toplevel.
 * @returns the matching note, or `undefined`.
 */
export async function noteForRepo(folder: string, repoToplevel: string): Promise<ProjectNote | undefined> {
  for (const note of await projectNotes(folder)) {
    for (const path of repoPaths(note.repo)) {
      try {
        if (await realpath(path) === repoToplevel) return note
      } catch {
        // A pointer at a moved/deleted repo cannot match a live cwd.
      }
    }
  }
  return undefined
}

/** Where a project's documentation folder was found. */
export interface ProjectDocsFolder {
  /** Absolute path of the project's folder inside the documentation folder. */
  path: string
  /** `note`: its `_index.md` names the project in `repo:`; `name`: `Projects/<name>` matches the project folder's name. */
  source: 'note' | 'name'
}

/**
 * The folder holding one project's documentation. The project note's `repo:`
 * pointer decides first, because a note can sit under any name; a project
 * with no note falls back to the `Projects/` entry whose name equals the
 * project folder's, compared without case.
 * @param folder - absolute path of the documentation folder.
 * @param projectPath - absolute path of the project's own folder.
 * @returns the project's documentation folder, or `undefined` when the documentation folder holds none.
 */
export async function projectDocsFolder(folder: string, projectPath: string): Promise<ProjectDocsFolder | undefined> {
  let resolved: string
  try {
    resolved = await realpath(projectPath)
  } catch {
    // A project folder that has gone matches no note and no name.
    return undefined
  }
  const note = await noteForRepo(folder, await gitToplevel(resolved) ?? resolved)
  if (note !== undefined) return { path: dirname(note.path), source: 'note' }
  const projectsDir = join(folder, 'Projects')
  let entries: string[]
  try {
    entries = await readdir(projectsDir)
  } catch {
    // No Projects/ folder: nothing to match by name.
    return undefined
  }
  const wanted = basename(resolved).toLowerCase()
  const match = entries.find(entry => entry.toLowerCase() === wanted)
  if (match === undefined) return undefined
  const path = join(projectsDir, match)
  return (await stat(path)).isDirectory() ? { path, source: 'name' } : undefined
}

/**
 * Vault commit-evidence mechanics: the session log append and the staleness
 * reconcile, built on the project-note lookups `@idealize/doc-policy` owns.
 * Pure filesystem + git functions so the plugin body stays a thin listener.
 *
 * Contract carried over from V0's session-close hook: writes happen only on
 * commit evidence, the backfill window starts at the note's own
 * `last_touched`, commits already present in the note are never re-appended,
 * and failures are reported to the caller's logger — never thrown into
 * session teardown.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { projectNotes } from '@idealize/doc-policy'
import type { ProjectNote } from '@idealize/doc-policy'

const run = promisify(execFile)

/** One appended commit line. */
export interface CommitLine {
  hash: string
  date: string
  subject: string
}

/**
 * Commits in one repo since a date (exclusive of merges), oldest first.
 * @param repo - repository toplevel.
 * @param sinceDate - inclusive ISO start date, or `undefined` for all history.
 * @returns parsed commit lines.
 */
export async function commitsSince(repo: string, sinceDate: string | undefined): Promise<CommitLine[]> {
  // %x1f expands to the unit-separator byte, which cannot appear in a hash,
  // a short date, or (realistically) a subject line.
  const SEP = '\u001f'
  const args = ['-C', repo, 'log', '--reverse', '--no-merges', '--date=short', '--pretty=format:%h%x1f%ad%x1f%s']
  if (sinceDate !== undefined) args.push(`--since=${sinceDate} 00:00:00`)
  const { stdout } = await run('git', args)
  return stdout.split('\n').filter(line => line.includes(SEP)).map((line) => {
    const [hash = '', date = '', subject = ''] = line.split(SEP)
    return { hash, date, subject }
  })
}

/**
 * Append commit evidence to one note's session log and advance
 * `last_touched`. Returns the commits actually appended: commits whose hash
 * already appears anywhere in the note are skipped, and with nothing new the
 * note is left byte-identical (the no-evidence-no-write rule).
 * @param note - the target project note.
 * @param commits - candidate commits, oldest first.
 * @param today - ISO date stamped into `last_touched` on a write.
 * @returns the commits actually appended.
 */
export async function appendSessionLog(
  note: ProjectNote,
  commits: CommitLine[],
  today: string,
): Promise<CommitLine[]> {
  const markdown = await readFile(note.path, 'utf8')
  const fresh = commits.filter(commit => !markdown.includes(commit.hash))
  if (fresh.length === 0) return []
  const lines = fresh.map(commit => `- ${commit.date} \`${commit.hash}\` ${commit.subject}`).join('\n')
  const heading = '## Session log'
  let next = markdown.includes(heading)
    ? markdown.replace(heading, `${heading}\n${lines}`)
    : `${markdown.trimEnd()}\n\n${heading}\n${lines}\n`
  next = next.replace(/^last_touched:\s*\d{4}-\d{2}-\d{2}\s*$/m, `last_touched: ${today}`)
  await writeFile(note.path, next)
  return fresh
}

/** One reconcile row: a note whose repo moved ahead of it. */
export interface StaleNote {
  note: string
  repo: string
  lastTouched: string | undefined
  commitsBehind: number
}

/**
 * Notes-vs-repos staleness: notes whose repos hold commits after `last_touched`.
 * @param folder - absolute path of the documentation folder.
 * @returns stale notes; `commitsBehind: -1` marks an unreadable repo pointer.
 */
export async function reconcile(folder: string): Promise<StaleNote[]> {
  const stale: StaleNote[] = []
  for (const note of await projectNotes(folder)) {
    let toplevel: string
    try {
      toplevel = await realpath(note.repo)
    } catch {
      stale.push({ note: note.path, repo: note.repo, lastTouched: note.lastTouched, commitsBehind: -1 })
      continue
    }
    try {
      const commits = await commitsSince(toplevel, note.lastTouched)
      const noteText = await readFile(note.path, 'utf8')
      const unrecorded = commits.filter(commit => !noteText.includes(commit.hash))
      if (unrecorded.length > 0) {
        stale.push({ note: note.path, repo: note.repo, lastTouched: note.lastTouched, commitsBehind: unrecorded.length })
      }
    } catch {
      stale.push({ note: note.path, repo: note.repo, lastTouched: note.lastTouched, commitsBehind: -1 })
    }
  }
  return stale
}

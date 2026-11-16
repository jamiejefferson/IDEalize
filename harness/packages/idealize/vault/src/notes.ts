/**
 * Vault commit-evidence mechanics: the session log append (into the project's
 * `log.md`, see `./log.ts`), the opt-in move of a legacy log section, and the
 * staleness reconcile, built on the project-note lookups `@idealize/doc-policy` owns.
 * Pure filesystem + git functions so the plugin body stays a thin listener.
 *
 * Contract carried over from V0's session-close hook: writes happen only on
 * commit evidence, the backfill window starts at the note's own
 * `last_touched`, commits already present in the note or its log are never re-appended,
 * and failures are reported to the caller's logger — never thrown into
 * session teardown.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { projectNotes } from '@idealize/doc-policy'
import type { ProjectNote } from '@idealize/doc-policy'
import { LEGACY_LOG_HEADING, LEGACY_LOG_POINTER, addToLog, legacyLog, logPathFor, newLog, readLog } from './log.ts'

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
 * A commit subject as quoted text. Anyone who can commit to a repository writes
 * these, and the note they land in reaches every chat in that project, so a
 * subject has to read as a record of what someone wrote and cannot open a new
 * line or a heading of its own.
 * @param subject - the subject as git reports it.
 * @returns the subject in double quotes, on one line.
 */
export function quotedSubject(subject: string): string {
  return JSON.stringify(subject.replaceAll(/\s+/g, ' ').trim())
}

/**
 * Append commit evidence to a project's `log.md`, beside the note, and advance
 * the note's `last_touched`. Each commit is one line under the heading of its
 * day, with the short hash first. A commit whose hash already appears in the
 * log or anywhere in the note (a legacy `## Session log` section included) is
 * skipped, and with nothing new both files are left byte-identical (the
 * no-evidence-no-write rule). The log is created on the first entry. The note
 * changes only in its `last_touched` line.
 * @param note - the target project note.
 * @param commits - candidate commits, oldest first.
 * @param today - ISO date stamped into `last_touched`, and into a new log's `created`.
 * @returns the commits actually appended.
 */
export async function appendSessionLog(
  note: ProjectNote,
  commits: CommitLine[],
  today: string,
): Promise<CommitLine[]> {
  const markdown = await readFile(note.path, 'utf8')
  const logPath = logPathFor(note.path)
  const existing = await readLog(logPath)
  const fresh = commits.filter(commit => !markdown.includes(commit.hash) && existing?.includes(commit.hash) !== true)
  if (fresh.length === 0) return []
  let log = existing ?? newLog(note.path, markdown, today)
  for (const commit of fresh) log = addToLog(log, commit.date, [`- \`${commit.hash}\` ${quotedSubject(commit.subject)}`])
  await writeFile(logPath, log)
  const next = markdown.replace(/^last_touched:\s*\d{4}-\d{2}-\d{2}\s*$/m, `last_touched: ${today}`)
  if (next !== markdown) await writeFile(note.path, next)
  return fresh
}

/** What {@link migrateSessionLog} did. */
export interface LogMigration {
  /** How many lines moved out of the note. */
  moved: number
  /** The log file the lines are in. */
  log: string
}

/**
 * Move a note's legacy `## Session log` section into the project's `log.md`,
 * leaving the heading with a link to the log. The section's list items are
 * the log: a dated one (`- YYYY-MM-DD …`) goes under its day, any other under
 * `## Undated`, word for word. An item whose commit hash the log already holds
 * is dropped from the note and not added twice. Other lines a person wrote in
 * the section stay in the note, above the link; the two lines the template
 * shipped there are removed. A note with no such section, or with no list
 * items in it, is left byte-identical. This runs only when a person asks for it.
 * @param notePath - the project's `_index.md`.
 * @param today - ISO date stamped into a new log's `created`.
 * @returns how many lines moved, and where to.
 */
export async function migrateSessionLog(notePath: string, today: string): Promise<LogMigration> {
  const markdown = await readFile(notePath, 'utf8')
  const logPath = logPathFor(notePath)
  const section = legacyLog(markdown)
  if (section === undefined || section.entries.length === 0) return { moved: 0, log: logPath }
  let log = await readLog(logPath) ?? newLog(notePath, markdown, today)
  let moved = 0
  for (const entry of section.entries) {
    const hash = /`([0-9a-f]{7,40})`/.exec(entry)?.[1]
    if (hash !== undefined && log.includes(hash)) continue
    // `- YYYY-MM-DD rest`: the day is characters 2 to 12 and the rest starts at 13.
    log = /^- \d{4}-\d{2}-\d{2} \S/.test(entry)
      ? addToLog(log, entry.slice(2, 12), [`- ${entry.slice(13)}`])
      : addToLog(log, 'Undated', [entry])
    moved += 1
  }
  // The log is written first: a failure between the two writes leaves every line in at least one file.
  await writeFile(logPath, log)
  const { rows, start, end, prose } = section
  const rest = rows.slice(end)
  const kept = [...rows.slice(0, start), LEGACY_LOG_HEADING, '', ...prose.length === 0 ? [] : [...prose, ''], LEGACY_LOG_POINTER]
  await writeFile(notePath, [...kept, ...rest.length === 0 ? [''] : ['', ...rest]].join('\n'))
  return { moved, log: logPath }
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
      const recorded = `${await readFile(note.path, 'utf8')}\n${await readLog(logPathFor(note.path)) ?? ''}`
      const unrecorded = commits.filter(commit => !recorded.includes(commit.hash))
      if (unrecorded.length > 0) {
        stale.push({ note: note.path, repo: note.repo, lastTouched: note.lastTouched, commitsBehind: unrecorded.length })
      }
    } catch {
      stale.push({ note: note.path, repo: note.repo, lastTouched: note.lastTouched, commitsBehind: -1 })
    }
  }
  return stale
}

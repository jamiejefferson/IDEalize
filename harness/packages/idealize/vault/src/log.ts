/**
 * A project's session log as its own file: `log.md` beside the project's
 * `_index.md`, with one `## YYYY-MM-DD` heading per day and one line per
 * entry. The index stays short enough to hand to a chat whole, and the log
 * can grow without limit.
 *
 * Every function here edits text by inserting lines. Nothing already in a log
 * is rewritten or reordered, so a line a person added by hand stays where they
 * put it.
 */

import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { PROJECT_LOG_FILE, parseFrontmatter } from '@idealize/doc-policy'

/** The heading a project index once kept its log under. */
export const LEGACY_LOG_HEADING = '## Session log'
/** What a migrated index keeps under that heading. */
export const LEGACY_LOG_POINTER = `The session log is in [${PROJECT_LOG_FILE}](${PROJECT_LOG_FILE}).`

const DAY_HEADING = /^## (\d{4}-\d{2}-\d{2})\s*$/

/**
 * The log file that belongs to a project index.
 * @param notePath - the project's `_index.md`.
 * @returns the path of `log.md` in the same folder.
 */
export function logPathFor(notePath: string): string {
  return join(dirname(notePath), PROJECT_LOG_FILE)
}

/**
 * A log file's text, when the file exists.
 * @param path - the log file.
 * @returns its text, or `undefined` when there is no such file.
 */
export async function readLog(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // No log yet: the first entry creates it.
    return undefined
  }
}

/**
 * The text a new log file opens with.
 * @param notePath - the project's `_index.md`, which names the project.
 * @param index - the index's text.
 * @param created - the ISO date the log is created on.
 * @returns frontmatter (`type: log`, `project`, `created`), a title and one line saying who writes the file.
 */
export function newLog(notePath: string, index: string, created: string): string {
  const named = parseFrontmatter(index).fields.project?.replaceAll(/\s+/g, ' ').trim()
  const project = named === undefined || named === '' ? basename(dirname(notePath)) : named
  return `---\ntype: log\nproject: ${project}\ncreated: ${created}\n---\n# ${project} log\n\n`
    + 'IDEalize adds a line here for each commit a chat ends with, and for each chat that ends with changed files and no commit.\n'
}

/**
 * Add lines under a heading of a log, creating the heading when the log has
 * none of that name. A new `## YYYY-MM-DD` heading goes before the first later
 * day, so days stay in order; any other new heading goes at the end.
 * @param log - the log's text.
 * @param heading - the heading's text without `## `: a day, or a name such as `Undated`.
 * @param lines - the lines to add, in order.
 * @returns the log with the lines added at the end of that heading's section.
 */
export function addToLog(log: string, heading: string, lines: readonly string[]): string {
  const rows = log.replace(/\n+$/, '').split('\n')
  const at = rows.findIndex(row => row.trimEnd() === `## ${heading}`)
  if (at !== -1) {
    let next = rows.findIndex((row, index) => index > at && row.startsWith('## '))
    if (next === -1) next = rows.length
    let end = next
    while (rows[end - 1]?.trim() === '') end -= 1
    // One blank line after the heading of an empty section, and one before the heading that follows.
    rows.splice(end, next - end, ...end === at + 1 ? [''] : [], ...lines, ...next < rows.length ? [''] : [])
    return `${rows.join('\n')}\n`
  }
  const later = /^\d{4}-\d{2}-\d{2}$/.test(heading)
    ? rows.findIndex(row => (DAY_HEADING.exec(row)?.[1] ?? '') > heading)
    : -1
  if (later === -1) return `${rows.join('\n')}\n\n## ${heading}\n\n${lines.join('\n')}\n`
  rows.splice(later, 0, `## ${heading}`, '', ...lines, '')
  return `${rows.join('\n')}\n`
}

/**
 * The two lines the project-index template shipped under `## Session log`.
 * They describe a log kept in the index, so a migration removes them.
 */
const LEGACY_LOG_BOILERPLATE: readonly string[] = [
  'Maintained automatically by `scripts/session-close.py`. Commits land here with',
  'their short hashes; nothing else should be written in this section by hand.',
]

/** A project index's legacy log section, located in the index's lines. */
export interface LegacyLog {
  /** The index's lines. */
  rows: string[]
  /** The line the `## Session log` heading is on. */
  start: number
  /** The line after the section's last. */
  end: number
  /** The section's list items: the log's lines. */
  entries: string[]
  /** The section's other lines that a person wrote, which stay in the index. */
  prose: string[]
}

/**
 * Find the `## Session log` section of a project index.
 * @param index - the index's text.
 * @returns the section, or `undefined` when the index has none.
 */
export function legacyLog(index: string): LegacyLog | undefined {
  const rows = index.split('\n')
  const start = rows.findIndex(row => row.trimEnd().toLowerCase() === LEGACY_LOG_HEADING.toLowerCase())
  if (start === -1) return undefined
  let end = rows.findIndex((row, at) => at > start && /^##? /.test(row))
  if (end === -1) end = rows.length
  const written = rows.slice(start + 1, end).map(row => row.trimEnd()).filter(row => row !== '')
  const entries = written.filter(row => /^[-*] /.test(row))
  const prose = written.filter(row => !/^[-*] /.test(row) && row !== LEGACY_LOG_POINTER && !LEGACY_LOG_BOILERPLATE.includes(row))
  return { rows, start, end, entries, prose }
}

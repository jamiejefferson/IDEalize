/**
 * Evidence for a chat that changes files and commits nothing. IDEalize is
 * built for designers, who often work without committing, and commit
 * evidence alone left those chats with no line in the project's log.
 *
 * The working tree is read when a chat is first seen and again on later
 * saves. A file counts as changed when it is uncommitted now and its git
 * status, size or modification time differs from the first reading, so a
 * file that was already uncommitted and that the chat left alone counts for
 * nothing. Everything here is git and the filesystem: no model is asked.
 */

import { execFile } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { addToLog } from './log.ts'
import { quotedSubject } from './notes.ts'

const run = promisify(execFile)

/** The words every such line carries, which also identify it in a log. */
export const UNCOMMITTED_MARK = '(uncommitted)'

/** One reading of a repository's working tree. */
export interface WorkingState {
  /** The commit `HEAD` names, or `undefined` in a repository with no commit yet. */
  head: string | undefined
  /** Each uncommitted path with its git status, size and modification time. */
  files: Map<string, string>
}

/**
 * Read a repository's `HEAD` and its uncommitted files. `git status` runs
 * with `GIT_OPTIONAL_LOCKS=0`, so the reading never takes the index lock and
 * cannot hold up a git command the person or an agent is running.
 * @param repo - the repository toplevel.
 * @param exclude - a folder inside the repository, relative with `/` separators, whose files are left out
 *   (the documentation folder, when it lives in the repository, since IDEalize writes there itself).
 * @returns the reading.
 */
export async function workingState(repo: string, exclude?: string): Promise<WorkingState> {
  let head: string | undefined
  try {
    head = (await run('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', 'HEAD'])).stdout.trim()
  } catch {
    // A repository with no commit yet has no HEAD to name; its files still count.
  }
  const { stdout } = await run('git', ['-C', repo, 'status', '--porcelain=v1', '-z'], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 32 * 1024 * 1024,
  })
  const files = new Map<string, string>()
  let origin = false
  for (const entry of stdout.split('\0')) {
    // A rename or copy is followed by the path it came from, which is no entry of its own.
    if (origin) {
      origin = false
      continue
    }
    if (entry.length < 4) continue
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    origin = /[RC]/.test(status)
    // An untracked folder is one entry that ends with `/`, and may hold the excluded folder.
    if (exclude !== undefined && (path === exclude || path.startsWith(`${exclude}/`) || `${exclude}/`.startsWith(path))) continue
    const stamp = await lstat(join(repo, path)).then(info => `${String(info.size)}:${String(info.mtimeMs)}`, () => 'gone')
    files.set(path, `${status}:${stamp}`)
  }
  return { head, files }
}

/**
 * Count the files a chat changed and left uncommitted.
 * @param before - the reading taken when the chat was first seen.
 * @param now - the current reading.
 * @returns how many files are uncommitted now and differ from the first reading.
 */
export function changedSince(before: WorkingState, now: WorkingState): number {
  let changed = 0
  for (const [path, stamp] of now.files) {
    if (before.files.get(path) !== stamp) changed += 1
  }
  return changed
}

/**
 * The log line for a chat with uncommitted changes.
 * @param title - the chat's title, or `undefined` before it has one.
 * @param changed - how many files changed.
 * @param transcript - the chat's Markdown copy, as a path relative to the log, when one was written.
 * @returns one line: the quoted title, the count, `(uncommitted)`, and a link to the copy.
 */
export function uncommittedLine(title: string | undefined, changed: number, transcript: string | undefined): string {
  const files = `${String(changed)} ${changed === 1 ? 'file' : 'files'} changed ${UNCOMMITTED_MARK}`
  const link = transcript === undefined ? '' : ` [Transcript](${encodeURI(transcript)})`
  return `- ${quotedSubject(title ?? 'Untitled chat')}: ${files}.${link}`
}

/** What {@link recordUncommitted} needs to place one chat's line. */
export interface UncommittedEntry {
  /** The ISO date whose heading a new line goes under. */
  day: string
  /** The line to record. */
  line: string
  /** The line this run of the app last wrote for the chat, when it wrote one. */
  previous: string | undefined
  /** Text only this chat's line holds (the end of its transcript's file name), when the line has a link. */
  marker: string | undefined
}

/**
 * Put a chat's uncommitted line in a log, keeping one line per chat. The line
 * this run wrote before is replaced where it stands. A line an earlier run of
 * the app wrote for the same chat is kept as it is, and so is the log when a
 * person removed the chat's line.
 * @param log - the log's text.
 * @param entry - the line and how to recognise the chat's earlier one.
 * @returns the new log text, or `undefined` when the log already says what it should.
 */
export function recordUncommitted(log: string, entry: UncommittedEntry): string | undefined {
  const rows = log.split('\n')
  if (entry.previous !== undefined) {
    const at = rows.indexOf(entry.previous)
    if (at === -1) return undefined
    rows[at] = entry.line
    return rows.join('\n')
  }
  const { marker } = entry
  if (marker !== undefined && rows.some(row => row.includes(marker) && row.includes(UNCOMMITTED_MARK))) return undefined
  return addToLog(log, entry.day, [entry.line])
}

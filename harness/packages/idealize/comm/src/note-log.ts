/**
 * The note log: one JSON line for every note, brief and refused attempt, kept
 * after an inbox is read. A mailbox is drained on reading, so before this the
 * only copy of a note went when its reader read it, and a chat that misbehaved
 * left no record of what it said or tried (F5, security audit, 9 Oct 2026).
 *
 * Nothing rewrites the file: entries are appended under one chain, so a burst
 * cannot interleave half a line. It holds what chats said, so it is private to
 * the person (mode 0600 where the platform has modes) and reached by the app
 * through `GET /idealize/comm/notes`, or by a chat for its own lines through
 * `idealize notes`.
 * @module @idealize/comm/note-log
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** One logged act. */
export interface NoteLogEntry {
  /** ISO-8601 instant. */
  at: string
  /** A note delivered, a brief that started a chat, or an attempt the host refused. */
  kind: 'note' | 'brief' | 'refused'
  /** The session the host proved, or the app's sender id. */
  from: string
  fromLabel?: string
  /** The recipient's session, or the started chat's. */
  to?: string
  toLabel?: string
  body?: string
  /** The command that was refused. */
  command?: string
  /** Why it was refused, as the caller was told. */
  reason?: string
}

/**
 * Where the log lives under one harness home.
 * @param dshHome - the harness home directory.
 * @returns the absolute path of `idealize/notes.jsonl` under it.
 */
export function noteLogPath(dshHome: string): string {
  return join(dshHome, 'idealize', 'notes.jsonl')
}

/** The append-only note log. */
export class NoteLog {
  private chain: Promise<void> = Promise.resolve()

  constructor(readonly path: string) {}

  /**
   * Append one entry; resolves when it is on disk.
   * @param entry - the act to record.
   */
  append(entry: NoteLogEntry): Promise<void> {
    const next = this.chain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await appendFile(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    })
    this.chain = next.catch(() => undefined)
    return next
  }

  /**
   * The newest entries, oldest first; a torn or foreign line is skipped.
   * @param limit - how many to return.
   * @param session - keep only this session's own lines (sent, received or refused).
   * @returns the entries.
   */
  async read(limit: number, session?: string): Promise<NoteLogEntry[]> {
    await this.chain
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return []
    }
    const entries: NoteLogEntry[] = []
    for (const line of text.split('\n')) {
      if (line === '') continue
      try {
        const entry = JSON.parse(line) as NoteLogEntry
        if (session === undefined || entry.from === session || entry.to === session) entries.push(entry)
      } catch {
        // A torn tail from a crash: the rest of the log still reads.
      }
    }
    return entries.slice(-limit)
  }
}

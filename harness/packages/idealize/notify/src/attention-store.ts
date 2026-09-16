/**
 * The two records this package owns, on one durable file: where the person
 * has read to in each project's Studio timeline, and what happened to every
 * alert that left the app. The third record of the spec's trio — whether a
 * request was actually answered — belongs to `@idealize/studio`'s fold and is
 * never written here, which is what keeps a dismissed alert from resolving
 * anything (FR-P0-19).
 *
 * One JSON file under the harness home, rewritten whole through a single
 * chain, so a concurrent read-modify-write cannot lose a record. A file that
 * is not this ledger refuses loudly rather than starting empty over the top
 * of it.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PolicyRow } from './attention.ts'

/**
 * Where a harness home keeps the ledger.
 * @param dshHome - the harness home directory.
 * @returns the absolute path of `idealize/notify/attention.json` under it.
 */
export function attentionLedgerPath(dshHome: string): string {
  return join(dshHome, 'idealize', 'notify', 'attention.json')
}

/** Newest alerts kept; older records fall off the head. */
const RECORD_CAP = 500

/** What has happened to one alert since it was raised. */
export type NotificationState = 'sent' | 'opened' | 'dismissed'

/** One alert that left the app, and what became of it. */
export interface NotificationRecord {
  /** The Studio event the alert was raised for. */
  event: string
  /** The resolved project folder that event belongs to. */
  project: string
  /** The MVP table row that raised it. */
  row: PolicyRow
  /** ISO-8601 instant it was raised. */
  at: string
  state: NotificationState
  /** ISO-8601 instant of the last state change, once the person acted. */
  changedAt?: string
}

/** The whole ledger, as it is served and stored. */
export interface AttentionLedger {
  /** Newest seq the person has viewed, per resolved project folder. */
  read: Record<string, number>
  /** Alerts raised, oldest first, capped at the newest {@link RECORD_CAP}. */
  notifications: NotificationRecord[]
}

const NOTIFICATION_STATES: readonly string[] = ['sent', 'opened', 'dismissed']

function isRecord(value: unknown): value is NotificationRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<NotificationRecord>
  return typeof row.event === 'string' && typeof row.project === 'string'
    && typeof row.row === 'string' && typeof row.at === 'string'
    && typeof row.state === 'string' && NOTIFICATION_STATES.includes(row.state)
}

function parseLedger(text: string, path: string): AttentionLedger {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${path} is not JSON — the attention ledger is corrupt`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${path} is not an attention ledger — the file holds ${typeof parsed}`)
  }
  const { read, notifications } = parsed as { read?: unknown; notifications?: unknown }
  if (typeof read !== 'object' || read === null || Array.isArray(read)) {
    throw new Error(`${path} carries no read positions — the attention ledger is corrupt`)
  }
  for (const [project, seq] of Object.entries(read)) {
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      throw new Error(`${path} carries a read position for ${project} that is not a seq — the attention ledger is corrupt`)
    }
  }
  if (!Array.isArray(notifications) || !notifications.every(isRecord)) {
    throw new Error(`${path} carries a malformed notification record — the attention ledger is corrupt`)
  }
  return { read: read as Record<string, number>, notifications }
}

/** The read-position and notification-delivery records, on one rewritten file. */
export class AttentionStore {
  private ledger: AttentionLedger | undefined
  private loading: Promise<AttentionLedger> | undefined
  private chain: Promise<unknown> = Promise.resolve()

  constructor(readonly path: string) {}

  /**
   * The ledger, read from disk once. A missing file is an empty ledger; any
   * other unreadable content refuses.
   * @returns the loaded ledger.
   */
  load(): Promise<AttentionLedger> {
    this.loading ??= this.read()
    return this.loading
  }

  private async read(): Promise<AttentionLedger> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      this.ledger = { read: {}, notifications: [] }
      return this.ledger
    }
    this.ledger = parseLedger(text, this.path)
    return this.ledger
  }

  /** Serialise one read-modify-write and persist the result. */
  private change<T>(mutate: (ledger: AttentionLedger) => T): Promise<T> {
    const chained = this.chain.then(async (): Promise<T> => {
      const ledger = await this.load()
      const answer = mutate(ledger)
      if (ledger.notifications.length > RECORD_CAP) {
        ledger.notifications.splice(0, ledger.notifications.length - RECORD_CAP)
      }
      // Write beside the file and rename, so a crash mid-write leaves the
      // previous ledger rather than a half-written one.
      const staging = `${this.path}.writing`
      try {
        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(staging, `${JSON.stringify(ledger, null, 2)}\n`)
        await rename(staging, this.path)
      } catch (error) {
        // The mutation already happened in memory. A failed write must not
        // leave the cache ahead of the file, so the next read comes off disk.
        this.ledger = undefined
        this.loading = undefined
        throw error
      }
      return answer
    })
    this.chain = chained.then(() => undefined, () => undefined)
    return chained
  }

  /**
   * Move a project's read position. It never goes backwards: a stale view
   * settling after a newer one must not re-unread what the person has seen.
   * @param project - the resolved project folder.
   * @param seq - the newest seq the person has viewed.
   * @returns the stored read position after the change.
   */
  markRead(project: string, seq: number): Promise<number> {
    return this.change((ledger) => {
      const stored = ledger.read[project] ?? 0
      if (seq > stored) ledger.read[project] = seq
      return ledger.read[project] ?? 0
    })
  }

  /**
   * Record that an alert was raised. A second raise for the same event keeps
   * the first record, so a re-read of the timeline cannot re-alert.
   * @param input - the event, its project and the row that raised it.
   * @returns the stored record, and whether this call is the one that raised it.
   */
  recordSent(input: { event: string; project: string; row: PolicyRow }): Promise<{ record: NotificationRecord; raised: boolean }> {
    return this.change((ledger) => {
      const existing = ledger.notifications.find(record => record.event === input.event)
      if (existing !== undefined) return { record: existing, raised: false }
      const record: NotificationRecord = { ...input, at: new Date().toISOString(), state: 'sent' }
      ledger.notifications.push(record)
      return { record, raised: true }
    })
  }

  /**
   * Record what the person did with an alert. Opening or dismissing changes
   * this record and nothing else — the task's attention is the fold's.
   * @param event - the Studio event id the alert named.
   * @param state - `opened` or `dismissed`.
   * @returns the updated record, or undefined when no alert was raised for it.
   */
  markState(event: string, state: NotificationState): Promise<NotificationRecord | undefined> {
    return this.change((ledger) => {
      const record = ledger.notifications.find(row => row.event === event)
      if (record === undefined) return undefined
      record.state = state
      record.changedAt = new Date().toISOString()
      return record
    })
  }
}

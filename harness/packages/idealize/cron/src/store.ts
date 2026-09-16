/**
 * Durable cron state: one JSON document under the Harness home holding the
 * task list and a capped run history. Whole-document atomic writes (temp +
 * rename); a torn write can never half-record a task.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Schedule } from './schedule.ts'

/** The document's filename directly under the harness home. */
export const CRON_STORE_FILENAME = 'idealize-cron.json'

/**
 * Where the document lives under one harness home.
 * @param dshHome - the harness home directory.
 * @returns the absolute document path.
 */
export function cronStorePath(dshHome: string): string {
  return join(dshHome, CRON_STORE_FILENAME)
}

/** One scheduled task as stored. */
export interface CronTask {
  id: string
  name: string
  schedule: Schedule
  /**
   * The user message each run submits. Empty for a reminder that runs no
   * agent: the fire only raises the desktop notification.
   */
  prompt: string
  /** Absolute workspace directory the run executes in. */
  cwd: string
  /** Raise a desktop notification (title = name, body = the time) at each fire, beside any agent run. */
  remind?: boolean
  /**
   * The instant a one-off (`at`) task fired. A done task stays listed so the
   * person sees it happened, arms no timer, and never fires again.
   */
  done?: string
  /** Pinned provider route; absent = the deployment default. */
  provider?: string
  /** Pinned model id; absent = the deployment default. */
  model?: string
  /** A disabled task keeps its record but arms no timer. */
  enabled: boolean
  createdAt: string
}

/** How one fire ended: ran, failed, was missed while the host was down, or was skipped because the task was still running. */
export type RunStatus = 'ok' | 'error' | 'missed' | 'skipped-busy'

/** One fire of a task as recorded in the run history. */
export interface CronRun {
  taskId: string
  firedAt: string
  status: RunStatus
  /** The session the run executed in, absent when no session was started. */
  sessionId?: string
  durationMs?: number
  /** The error line for `error`, or a note for `missed`/`skipped-busy`. */
  detail?: string
}

interface CronDocument {
  tasks: CronTask[]
  runs: CronRun[]
}

const RUN_HISTORY_CAP = 500

/**
 * The cron document: every read and write goes through one serialised chain, so callers never observe a half-written list.
 * `onTasksChanged` runs after every committed task-list write (upsert, delete), never after a run record.
 */
export class CronStore {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly path: string, private readonly onTasksChanged: () => void = () => {}) {}

  private async readAll(): Promise<CronDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<CronDocument>
      return { tasks: parsed.tasks ?? [], runs: parsed.runs ?? [] }
    } catch {
      return { tasks: [], runs: [] }
    }
  }

  private async writeAll(document: CronDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify(document, null, 2))
    await rename(tmp, this.path)
  }

  /** Serialize every mutation through one chain (single document). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task)
    this.chain = next.catch(() => undefined)
    return next
  }

  /**
   * Every stored task.
   * @returns the task list in stored order; empty when no document exists.
   */
  tasks(): Promise<CronTask[]> {
    return this.enqueue(async () => (await this.readAll()).tasks)
  }

  /**
   * The retained run history, oldest first.
   * @param taskId - restrict to one task; absent returns every run.
   * @returns at most the last 500 runs recorded.
   */
  runs(taskId?: string): Promise<CronRun[]> {
    return this.enqueue(async () => {
      const { runs } = await this.readAll()
      return taskId === undefined ? runs : runs.filter(run => run.taskId === taskId)
    })
  }

  /**
   * Insert a task, or replace the stored task with the same id.
   * @param task - the complete task record.
   */
  upsertTask(task: CronTask): Promise<void> {
    return this.enqueue(async () => {
      const document = await this.readAll()
      const at = document.tasks.findIndex(candidate => candidate.id === task.id)
      if (at === -1) document.tasks.push(task)
      else document.tasks[at] = task
      await this.writeAll(document)
      this.onTasksChanged()
    })
  }

  /**
   * Remove a task; its run history stays.
   * @param id - the task id.
   * @returns true when a task was removed, false when none had that id (nothing is written).
   */
  deleteTask(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const document = await this.readAll()
      const before = document.tasks.length
      document.tasks = document.tasks.filter(task => task.id !== id)
      if (document.tasks.length === before) return false
      await this.writeAll(document)
      this.onTasksChanged()
      return true
    })
  }

  /**
   * Append one run, dropping the oldest beyond the 500-run cap.
   * @param run - the run record.
   */
  recordRun(run: CronRun): Promise<void> {
    return this.enqueue(async () => {
      const document = await this.readAll()
      document.runs.push(run)
      if (document.runs.length > RUN_HISTORY_CAP) {
        document.runs = document.runs.slice(-RUN_HISTORY_CAP)
      }
      await this.writeAll(document)
    })
  }
}

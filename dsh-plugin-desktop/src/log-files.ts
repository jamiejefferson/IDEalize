import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import type { LogType } from './log-level.ts'
import { isErrorType } from './log-level.ts'
import { maskSecrets } from './mask-secrets.ts'

const OWNED_LOG_FILE = /^dsh-\d{4}-\d{2}-\d{2}(?:\.error)?(?:\.\d+)?\.log$/u

/** Return whether a leaf name belongs to the desktop diagnostic log set. */
export function isDesktopLogFileName(name: string): boolean {
  return OWNED_LOG_FILE.test(name)
}

interface OwnedLogFile {
  readonly name: string
  readonly path: string
  readonly bytes: number
  readonly modifiedAt: number
}

function rotationSegment(name: string): number {
  return Number(/\.(\d+)\.log$/u.exec(name)?.[1] ?? 0)
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  let bytes = 0
  let end = 0
  for (const character of text) {
    const next = Buffer.byteLength(character)
    if (bytes + next > maxBytes) break
    bytes += next
    end += character.length
  }
  return text.slice(0, end)
}

/** Sink configuration with its size ceilings. */
export interface LogFileSinkOptions {
  readonly maxFileBytes: number
  readonly maxDirectoryBytes: number
  /**
   * Milliseconds `info`, `warn` and `debug` lines may wait so one burst costs
   * one append per file. Absent or `0` appends every line as it arrives.
   * `error` lines, `flush()` and `close()` always write what is waiting first.
   */
  readonly coalesceMs?: number
}

interface PendingLine {
  readonly kind: 'all' | 'error'
  readonly line: string
}

function localDateSuffix(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Build the file name for one date, level kind, and rotation segment. */
export function logFileName(suffix: string, error: boolean, segment: number): string {
  const base = `dsh-${suffix}${error ? '.error' : ''}`
  return segment === 0 ? `${base}.log` : `${base}.${segment}.log`
}

/**
 * Per-day file sink with synchronous appends, size rotation, and a directory
 * cap. Every append blocks its caller, and the Host logs from Electron's main
 * thread, so `coalesceMs` batches a burst into one append per file.
 */
export class LogFileSink {
  private readonly directory: string
  private readonly maxFileBytes: number
  private readonly maxDirectoryBytes: number
  private currentDate: string | undefined
  private allBytes = 0
  private errorBytes = 0
  private allSegment = 0
  private errorSegment = 0
  private directoryBytes: number
  private readonly coalesceMs: number
  private pending: PendingLine[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(directory: string, options: LogFileSinkOptions) {
    this.directory = directory
    this.maxFileBytes = options.maxFileBytes
    this.maxDirectoryBytes = options.maxDirectoryBytes
    this.coalesceMs = options.coalesceMs ?? 0
    if (this.maxFileBytes < 2 || this.maxDirectoryBytes < 1) {
      throw new Error('dsh-plugin-desktop: log size limits must be positive')
    }
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
    const directoryStats = lstatSync(directory)
    if (directoryStats.isSymbolicLink()) {
      throw new Error('dsh-plugin-desktop: refusing linked log directory')
    }
    if (!directoryStats.isDirectory()) {
      throw new Error('dsh-plugin-desktop: log path is not a directory')
    }
    this.directoryBytes = this.measureDirectoryBytes()
  }

  /** Append one rendered line, routing by level and rotating on size/date. */
  write(type: LogType, line: string): void {
    const suffix = localDateSuffix(new Date())
    if (suffix !== this.currentDate) this.rollDate(suffix)
    const masked = maskSecrets(line)
    if (this.coalesceMs <= 0) {
      this.append('all', masked)
      if (isErrorType(type)) this.append('error', masked)
      if (this.directoryBytes > this.maxDirectoryBytes) this.enforceDirectoryCap()
      return
    }
    this.pending.push({ kind: 'all', line: masked })
    if (isErrorType(type)) this.pending.push({ kind: 'error', line: masked })
    // An error may be the last line before the process dies: it never waits.
    if (type === 'error') {
      this.flush()
      return
    }
    if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => { this.flush() }, this.coalesceMs)
      // Pending log lines must not keep the process alive; exit paths flush.
      this.flushTimer.unref()
    }
  }

  /** Append every waiting line now, in arrival order per file. */
  flush(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (this.pending.length === 0) return
    const lines = this.pending
    this.pending = []
    const suffix = localDateSuffix(new Date())
    if (suffix !== this.currentDate) this.rollDate(suffix)
    for (const kind of ['all', 'error'] as const) {
      let batch: string[] = []
      let batchBytes = 0
      const bytes = (): number => (kind === 'all' ? this.allBytes : this.errorBytes)
      for (const entry of lines) {
        if (entry.kind !== kind) continue
        const rendered = truncateUtf8(entry.line, this.maxFileBytes - 1)
        const lineBytes = Buffer.byteLength(rendered) + 1
        // A batch ends where the per-file cap would rotate, so rotation
        // lands on the same line it would with one append per line.
        if (batch.length > 0 && bytes() + batchBytes + lineBytes > this.maxFileBytes) {
          this.append(kind, batch.join('\n'))
          batch = []
          batchBytes = 0
        }
        batch.push(rendered)
        batchBytes += lineBytes
      }
      if (batch.length > 0) this.append(kind, batch.join('\n'))
    }
    if (this.directoryBytes > this.maxDirectoryBytes) this.enforceDirectoryCap()
  }

  /** Write a startup header line to the current full-log file (before ordinary lines). */
  writeHeader(line: string): void {
    this.flush()
    const suffix = localDateSuffix(new Date())
    if (suffix !== this.currentDate) this.rollDate(suffix)
    this.append('all', line)
    if (this.directoryBytes > this.maxDirectoryBytes) this.enforceDirectoryCap()
  }

  /** Delete log files modified more than `days` days ago. */
  purgeOlderThan(days: number): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    for (const entry of this.ownedFiles()) {
      if (entry.modifiedAt >= cutoff) continue
      try {
        unlinkSync(entry.path)
      } catch {
        // Locked logs remain eligible for the next startup cleanup.
      }
    }
    this.directoryBytes = this.measureDirectoryBytes()
  }

  /** Delete every file in the directory and reset the rotation state. */
  clear(): void {
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.pending = []
    for (const entry of this.ownedFiles()) {
      try {
        unlinkSync(entry.path)
      } catch {
        // A viewer may keep one Windows log locked; leave it in place.
      }
    }
    this.directoryBytes = this.measureDirectoryBytes()
    this.resetState()
  }

  /** Reset the in-memory date/rotation state (files are closed after every append). */
  close(): void {
    this.flush()
    this.resetState()
  }

  /** Delete oldest files until the directory is under the cap. */
  enforceDirectoryCap(): void {
    const entries = this.ownedFiles().sort((a, b) =>
      a.modifiedAt - b.modifiedAt || rotationSegment(a.name) - rotationSegment(b.name),
    )
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    let deleted = false
    for (const entry of entries) {
      if (total <= this.maxDirectoryBytes) break
      try {
        unlinkSync(entry.path)
        total -= entry.bytes
        deleted = true
      } catch {
        // Continue with other old segments when one Windows file is locked.
      }
    }
    this.directoryBytes = total
    if (deleted && this.currentDate !== undefined) this.rollDate(this.currentDate)
  }

  private resetState(): void {
    this.currentDate = undefined
    this.allBytes = 0
    this.errorBytes = 0
    this.allSegment = 0
    this.errorSegment = 0
  }

  private rollDate(suffix: string): void {
    this.currentDate = suffix
    const all = this.loadState(suffix, false)
    const error = this.loadState(suffix, true)
    this.allBytes = all.bytes
    this.errorBytes = error.bytes
    this.allSegment = all.segment
    this.errorSegment = error.segment
  }

  private loadState(suffix: string, error: boolean): { bytes: number, segment: number } {
    const prefix = `dsh-${suffix}${error ? '.error' : ''}`
    let current = { bytes: 0, segment: 0 }
    for (const entry of this.ownedFiles()) {
      const name = entry.name
      let segment: number | undefined
      if (name === `${prefix}.log`) segment = 0
      else if (name.startsWith(`${prefix}.`) && name.endsWith('.log')) {
        const value = name.slice(prefix.length + 1, -4)
        if (/^\d+$/u.test(value)) segment = Number(value)
      }
      if (segment === undefined || segment < current.segment) continue
      current = { bytes: entry.bytes, segment }
    }
    return current
  }

  private append(kind: 'all' | 'error', line: string): void {
    const isAll = kind === 'all'
    let bytes = isAll ? this.allBytes : this.errorBytes
    let segment = isAll ? this.allSegment : this.errorSegment
    const renderedLine = truncateUtf8(line, this.maxFileBytes - 1)
    const lineBytes = Buffer.byteLength(renderedLine) + 1
    if (bytes + lineBytes > this.maxFileBytes) {
      segment += 1
      bytes = 0
    }
    let path = join(this.directory, logFileName(this.currentDate!, !isAll, segment))
    while (existsSync(path)) {
      const stats = lstatSync(path)
      if (stats.isFile() && !stats.isSymbolicLink()) break
      segment += 1
      bytes = 0
      path = join(this.directory, logFileName(this.currentDate!, !isAll, segment))
    }
    appendFileSync(path, `${renderedLine}\n`)
    this.directoryBytes += lineBytes
    const nextBytes = bytes + lineBytes
    if (isAll) {
      this.allSegment = segment
      this.allBytes = nextBytes
    } else {
      this.errorSegment = segment
      this.errorBytes = nextBytes
    }
  }

  private measureDirectoryBytes(): number {
    return this.ownedFiles().reduce((total, entry) => total + entry.bytes, 0)
  }

  private ownedFiles(): OwnedLogFile[] {
    const entries: OwnedLogFile[] = []
    for (const name of readdirSync(this.directory)) {
      if (!isDesktopLogFileName(name)) continue
      const path = join(this.directory, name)
      try {
        const stats = lstatSync(path)
        if (!stats.isFile()) continue
        entries.push({ name, path, bytes: stats.size, modifiedAt: stats.mtimeMs })
      } catch {
        // Files may disappear between directory enumeration and inspection.
      }
    }
    return entries
  }
}

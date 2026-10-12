/**
 * One opened JSON unit. The in-memory state is authoritative; every write
 * primitive mutates it and republishes the whole file atomically. Writes are
 * NOT queued here — per the backend contract, write ordering belongs to the
 * caller (the domain layer's write chain); this unit only guarantees that
 * each single call publishes a complete, durable file.
 * @module @deepseek-ai/dsh-storage-json/src/unit
 */

import { readFile, rename } from 'node:fs/promises'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { writeAtomic } from './atomic.ts'
import { parse, serialize } from './format.ts'
import type { UnitState } from './format.ts'

/**
 * Open (load or lazily create) one unit backed by `path`.
 * @param descriptor - Static identity and shape of the unit.
 * @param path - Absolute unit file path under the backend root.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 */
export async function openJsonUnit(
  descriptor: KvUnitDescriptor,
  path: string,
  onClose: () => void,
): Promise<KvUnit> {
  let text: string | undefined
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Missing file = empty unit; materialization defers to the first write.
  }
  const empty = (): UnitState => ({
    version: descriptor.version,
    global: null,
    tables: new Map(descriptor.tables.map(table => [table, new Map<string, unknown>()])),
  })
  if (text === undefined) return new JsonKvUnit(descriptor, path, empty(), onClose)
  let state: UnitState
  try {
    state = parse(text, descriptor)
  } catch (error) {
    // A file damaged outside the app (a hand edit, another tool) used to stop
    // every plugin that opens it, and so the app's start-up (IDEalize, 9 Oct
    // 2026). The damaged copy is kept beside it, and the unit opens from the
    // last good copy, else empty. A newer version's file is never touched.
    if (!(error instanceof StorageError) || error.code !== 'malformed-medium') throw error
    state = await recover(descriptor, path, error, empty)
    return new JsonKvUnit(descriptor, path, state, onClose)
  }
  // The last copy that parsed, for the recovery above; a failed copy costs nothing.
  await writeAtomic(backupPath(path), text).catch(() => {})
  return new JsonKvUnit(descriptor, path, state, onClose)
}

/** Where a unit's last good copy lives. */
function backupPath(path: string): string {
  return `${path}.bak`
}

/**
 * Open a unit whose file did not parse: keep the damaged file, then use the
 * last good copy when it parses, else an empty unit.
 * @param descriptor - the unit's identity.
 * @param path - the unit file.
 * @param error - why it did not parse.
 * @param empty - an empty unit state.
 * @returns the state to open with.
 */
async function recover(
  descriptor: KvUnitDescriptor,
  path: string,
  error: StorageError,
  empty: () => UnitState,
): Promise<UnitState> {
  const kept = `${path}.damaged-${String(Date.now())}`
  await rename(path, kept)
  let state = empty()
  let from = 'empty'
  try {
    const backup = await readFile(backupPath(path), 'utf8')
    state = parse(backup, descriptor)
    await writeAtomic(path, backup)
    from = 'its last good copy'
  } catch {
    // No usable copy: the unit starts empty and its first write recreates the file.
  }
  process.emitWarning(`storage-json: unit '${descriptor.name}' at ${path} was damaged (${error.message}); kept as ${kept}, opened from ${from}`)
  return state
}

class JsonKvUnit implements KvUnit {
  private closed = false
  /** In-flight publishes; close() drains them before releasing the unit. */
  private readonly inFlight = new Set<Promise<void>>()

  constructor(
    private readonly descriptor: KvUnitDescriptor,
    private readonly path: string,
    private readonly state: UnitState,
    private readonly onClose: () => void,
  ) {}

  // oxlint-disable-next-line typescript/require-await -- async keeps the closed guard a rejection, not a synchronous throw
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [table, records] of this.state.tables) {
      tables[table] = Object.fromEntries(records)
    }
    return { tables, global: this.state.global }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    const records = this.records(table)
    const hadKey = records.has(key)
    const previous = records.get(key)
    records.set(key, value)
    // Roll back on a failed publish: memory is authoritative, so a rejected
    // write must not survive in memory (or ride along with the next publish).
    await this.publish().catch((error: unknown) => {
      if (hadKey) records.set(key, previous)
      else records.delete(key)
      throw error
    })
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    const records = this.records(table)
    if (!records.has(key)) return
    const previous = records.get(key)
    records.delete(key)
    await this.publish().catch((error: unknown) => {
      records.set(key, previous)
      throw error
    })
  }

  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    const previous = this.state.global
    this.state.global = value
    await this.publish().catch((error: unknown) => {
      this.state.global = previous
      throw error
    })
  }

  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.inFlight)
      return
    }
    this.closed = true
    await Promise.allSettled(this.inFlight)
    this.onClose()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    }
  }

  private records(table: string): Map<string, unknown> {
    const records = this.state.tables.get(table)
    if (!records) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
    return records
  }

  private publish(): Promise<void> {
    const write = writeAtomic(this.path, serialize(this.descriptor.name, this.state))
    this.inFlight.add(write)
    // Swallow only on the tracking branch: the caller still awaits `write`
    // itself, so rejections stay observed exactly once.
    write.catch(() => {}).finally(() => this.inFlight.delete(write))
    return write
  }
}

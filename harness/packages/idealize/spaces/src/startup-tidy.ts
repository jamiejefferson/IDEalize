/**
 * Start-up housekeeping for two things that otherwise grow for ever: attachments
 * no chat refers to, and old crash dumps. Both only go when they are older than
 * 30 days. An attachment goes only after every chat log, set-aside chats
 * included, has been read and none mentions it; one log that cannot be read
 * means nothing is certain, so no attachment goes that day.
 *
 * It reads every log, so it runs well after start-up, at most once a week.
 * @module @idealize/spaces/startup-tidy
 */

import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const DAY_MS = 86_400_000
const KEEP_FOR_MS = 30 * DAY_MS
const AT_MOST_EVERY_MS = 7 * DAY_MS

/** The one thing the tidy asks of the session store: see `readEveryFile` in the JSONL backend. */
export interface EveryFileReader {
  readEveryFile(): AsyncIterable<{ path: string; text: string }>
}

/** What one tidy did. */
export interface TidyResult {
  attachments: number
  dumps: number
  /** Why attachments were left alone, when they were. */
  uncertain?: string
}

/** Every file directly inside a folder, or nothing when the folder is absent. */
async function filesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(dir, entry.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function olderThan(path: string, cutoff: number): Promise<boolean> {
  return (await stat(path)).mtimeMs < cutoff
}

/**
 * Remove crash dumps past the age limit. The app has no crash uploader, so the
 * only reader is a diagnostics export, and that takes whatever is there.
 */
async function tidyDumps(crashDumps: string, cutoff: number): Promise<number> {
  let removed = 0
  for (const folder of ['pending', 'completed', 'new']) {
    for (const path of await filesIn(join(crashDumps, folder))) {
      if (!/\.(dmp|meta)$/u.test(path) || !await olderThan(path, cutoff)) continue
      await unlink(path)
      removed += 1
    }
  }
  return removed
}

/**
 * Remove old attachments that no log mentions. The search is for the bare
 * 64-character digest anywhere in any file, whatever shape of event carries it.
 */
async function tidyAttachments(home: string, store: EveryFileReader, cutoff: number): Promise<number> {
  const objects = join(home, 'attachments', 'v1', 'objects')
  const candidates = new Map<string, string>()
  let buckets: string[]
  try {
    buckets = await readdir(objects)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  for (const bucket of buckets) {
    for (const path of await filesIn(join(objects, bucket))) {
      const digest = basename(path)
      if (/^[a-f0-9]{64}$/u.test(digest) && await olderThan(path, cutoff)) candidates.set(digest, path)
    }
  }
  if (candidates.size === 0) return 0
  let read = 0
  for await (const { text } of store.readEveryFile()) {
    read += 1
    for (const match of text.matchAll(/[a-f0-9]{64}/gu)) candidates.delete(match[0])
    if (candidates.size === 0) return 0
  }
  // Attachments with no logs at all means the logs are somewhere this cannot see.
  if (read === 0) throw new Error('no chat logs to check attachments against')
  let removed = 0
  for (const path of candidates.values()) {
    await unlink(path)
    removed += 1
  }
  return removed
}

/**
 * Where a packaged Mac app keeps crash dumps: `Crashpad` beside the `harness`
 * data folder. Anywhere else, including a data folder chosen by hand, there is
 * nothing here the tidy can be sure of.
 * @param home - the app's data folder.
 * @param platform - the operating system.
 * @param electron - the Electron version, when running inside the app.
 * @returns the folder, or undefined.
 */
export function crashDumpFolder(
  home: string,
  platform: NodeJS.Platform = process.platform,
  electron: string | undefined = process.versions.electron,
): string | undefined {
  if (platform !== 'darwin' || electron === undefined || basename(home) !== 'harness') return undefined
  return join(dirname(home), 'Crashpad')
}

/**
 * Run the tidy if it is due.
 * @param options.home - the app's data folder.
 * @param options.store - reads every chat log; absent, attachments are left alone.
 * @param options.crashDumps - the crash dump folder, when this run has one.
 * @param options.now - the current time.
 * @returns what it did, or undefined when it was not due.
 */
export async function tidyOnStart(options: {
  home: string
  store: EveryFileReader | undefined
  crashDumps: string | undefined
  now: number
}): Promise<TidyResult | undefined> {
  const stamp = join(options.home, 'idealize', 'tidy.json')
  try {
    const last = (JSON.parse(await readFile(stamp, 'utf8')) as { at?: unknown }).at
    if (typeof last === 'number' && options.now - last < AT_MOST_EVERY_MS) return undefined
  } catch {
    // No stamp, or a damaged one: the tidy is due.
  }
  const cutoff = options.now - KEEP_FOR_MS
  const result: TidyResult = { attachments: 0, dumps: 0 }
  if (options.crashDumps !== undefined) result.dumps = await tidyDumps(options.crashDumps, cutoff).catch(() => 0)
  if (options.store === undefined) {
    result.uncertain = 'this store cannot read every log'
  } else {
    try {
      result.attachments = await tidyAttachments(options.home, options.store, cutoff)
    } catch (error) {
      result.uncertain = error instanceof Error ? error.message : String(error)
    }
  }
  await mkdir(join(options.home, 'idealize'), { recursive: true, mode: 0o700 })
  await writeFile(stamp, JSON.stringify({ at: options.now, ...result }), { encoding: 'utf8', mode: 0o600 })
  return result
}

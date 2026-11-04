/** Old files go only when nothing can still need them. */

import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { crashDumpFolder, tidyOnStart, type EveryFileReader } from '../src/startup-tidy.ts'

const NOW = Date.UTC(2026, 10, 4)
const DAY = 86_400_000
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const digest = (letter: string): string => letter.repeat(64)

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'idealize-tidy-'))
  roots.push(root)
  return root
}

async function attachment(root: string, sha: string, ageDays: number): Promise<string> {
  const dir = join(root, 'attachments', 'v1', 'objects', sha.slice(0, 2))
  await mkdir(dir, { recursive: true })
  const path = join(dir, sha)
  await writeFile(path, 'image')
  const at = new Date(NOW - ageDays * DAY)
  await utimes(path, at, at)
  return path
}

const logs = (...texts: string[]): EveryFileReader => ({
  async * readEveryFile() {
    for (const [index, text] of texts.entries()) yield { path: `log-${String(index)}`, text }
  },
})

const exists = async (path: string): Promise<boolean> => await stat(path).then(() => true, () => false)

describe('the attachment tidy', () => {
  it('removes only an old attachment no log mentions', async () => {
    const root = await home()
    const orphan = await attachment(root, digest('a'), 40)
    const used = await attachment(root, digest('b'), 40)
    const young = await attachment(root, digest('c'), 5)
    const result = await tidyOnStart({ home: root, store: logs(`{"imageId":"sha256:${digest('b')}"}`), crashDumps: undefined, now: NOW })
    expect(result).toMatchObject({ attachments: 1 })
    expect(await exists(orphan)).toBe(false)
    expect(await exists(used)).toBe(true)
    expect(await exists(young)).toBe(true)
  })

  it('removes nothing when any log cannot be read', async () => {
    const root = await home()
    const orphan = await attachment(root, digest('a'), 40)
    const store: EveryFileReader = {
      async * readEveryFile() {
        yield { path: 'fine', text: 'nothing' }
        throw new Error('corrupt Zstandard session log')
      },
    }
    const result = await tidyOnStart({ home: root, store, crashDumps: undefined, now: NOW })
    expect(result?.attachments).toBe(0)
    expect(result?.uncertain).toContain('corrupt')
    expect(await exists(orphan)).toBe(true)
  })

  it('removes nothing when it finds no logs at all', async () => {
    const root = await home()
    const orphan = await attachment(root, digest('a'), 40)
    const result = await tidyOnStart({ home: root, store: logs(), crashDumps: undefined, now: NOW })
    expect(result?.uncertain).toContain('no chat logs')
    expect(await exists(orphan)).toBe(true)
  })

  it('removes nothing when the store cannot read every log', async () => {
    const root = await home()
    const orphan = await attachment(root, digest('a'), 40)
    await tidyOnStart({ home: root, store: undefined, crashDumps: undefined, now: NOW })
    expect(await exists(orphan)).toBe(true)
  })

  it('leaves a file in the attachments folder that is not an attachment', async () => {
    const root = await home()
    const other = await attachment(root, 'notes.txt', 40)
    await tidyOnStart({ home: root, store: logs('x'), crashDumps: undefined, now: NOW })
    expect(await exists(other)).toBe(true)
  })

  it('runs at most once a week', async () => {
    const root = await home()
    const orphan = await attachment(root, digest('a'), 40)
    await tidyOnStart({ home: root, store: logs(`sha256:${digest('a')}`), crashDumps: undefined, now: NOW })
    expect(await tidyOnStart({ home: root, store: logs('x'), crashDumps: undefined, now: NOW + DAY })).toBeUndefined()
    expect(await exists(orphan)).toBe(true)
    expect(await tidyOnStart({ home: root, store: logs('x'), crashDumps: undefined, now: NOW + 8 * DAY })).toMatchObject({ attachments: 1 })
  })
})

describe('the crash dump tidy', () => {
  async function dump(dir: string, name: string, ageDays: number): Promise<string> {
    await mkdir(dir, { recursive: true })
    const path = join(dir, name)
    await writeFile(path, 'dump')
    const at = new Date(NOW - ageDays * DAY)
    await utimes(path, at, at)
    return path
  }

  it('removes dumps over 30 days old and nothing else', async () => {
    const root = await home()
    const crash = join(root, 'Crashpad')
    const old = await dump(join(crash, 'pending'), 'a.dmp', 40)
    const oldMeta = await dump(join(crash, 'completed'), 'b.meta', 40)
    const young = await dump(join(crash, 'pending'), 'c.dmp', 5)
    const settings = await dump(crash, 'settings.dat', 400)
    const stray = await dump(join(crash, 'pending'), 'keep.txt', 400)
    const result = await tidyOnStart({ home: root, store: undefined, crashDumps: crash, now: NOW })
    expect(result?.dumps).toBe(2)
    expect(await exists(old)).toBe(false)
    expect(await exists(oldMeta)).toBe(false)
    expect(await exists(young)).toBe(true)
    expect(await exists(settings)).toBe(true)
    expect(await exists(stray)).toBe(true)
  })

  it('finds the folder only in a Mac app using its own data folder', () => {
    const home = '/Users/x/Library/Application Support/IDEalize/harness'
    expect(crashDumpFolder(home, 'darwin', '38.0.0')).toBe('/Users/x/Library/Application Support/IDEalize/Crashpad')
    expect(crashDumpFolder(home, 'win32', '38.0.0')).toBeUndefined()
    expect(crashDumpFolder(home, 'darwin', undefined)).toBeUndefined()
    expect(crashDumpFolder('/tmp/elsewhere', 'darwin', '38.0.0')).toBeUndefined()
  })
})

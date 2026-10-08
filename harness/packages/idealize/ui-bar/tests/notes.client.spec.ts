// The Notes scratchpad's host half: the first tap creates a dated note and
// remembers it, later taps reopen the same note, `fresh` starts another, and
// a pointer to a vanished note (or one reaching outside the folder) starts over.
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CURRENT_POINTER, currentNote, noteName } from '../src/notes.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'idealize-notes-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const morning = new Date(2026, 9, 6, 9, 5)

describe('currentNote', () => {
  it('names a note by its local date and time', () => {
    expect(noteName(morning)).toEqual({ stem: 'Notes 2026-10-06 0905', heading: 'Notes, 6 Oct 2026' })
  })

  it('creates the folder and a headed note on first use, then reopens that note', async () => {
    const folder = join(root, 'Notes')
    const first = await currentNote(folder, false, morning)
    expect(first).toBe(join(folder, 'Notes 2026-10-06 0905.md'))
    expect(await readFile(first, 'utf8')).toBe('# Notes, 6 Oct 2026\n\n')
    await writeFile(first, '# Notes, 6 Oct 2026\n\nkept\n')
    expect(await currentNote(folder, false, new Date(2026, 9, 7))).toBe(first)
    expect(await readFile(first, 'utf8')).toContain('kept')
  })

  it('starts a new current note when asked, never overwriting one with the same minute', async () => {
    const first = await currentNote(root, false, morning)
    const second = await currentNote(root, true, morning)
    expect(second).toBe(join(root, 'Notes 2026-10-06 0905 (2).md'))
    expect(await currentNote(root, false)).toBe(second)
    expect(await readFile(first, 'utf8')).toBe('# Notes, 6 Oct 2026\n\n')
  })

  it('starts over when the current note was deleted or the pointer leaves the folder', async () => {
    const first = await currentNote(root, false, morning)
    await unlink(first)
    expect(await currentNote(root, false, morning)).toBe(first)
    await writeFile(join(root, CURRENT_POINTER), '../outside.md\n')
    await writeFile(join(root, '..', 'outside.md'), 'not a note').catch(() => {})
    expect(await currentNote(root, false, new Date(2026, 9, 6, 10, 0))).toBe(join(root, 'Notes 2026-10-06 1000.md'))
  })
})

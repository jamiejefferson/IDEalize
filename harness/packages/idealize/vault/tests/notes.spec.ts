import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectNoteFor } from '@idealize/doc-policy'
import { appendSessionLog, reconcile } from '../src/notes.ts'

async function scratchVault(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'idealize-vault-spec-'))
}

describe('appendSessionLog', () => {
  const note = async (vault: string): Promise<{ path: string; repo: string; lastTouched: string }> => {
    await mkdir(join(vault, 'Projects', 'p'), { recursive: true })
    const path = join(vault, 'Projects', 'p', '_index.md')
    await writeFile(path, projectNoteFor('p', '/repo/p', '2026-08-01'))
    return { path, repo: '/repo/p', lastTouched: '2026-08-01' }
  }

  it('appends fresh commits under the session log and advances last_touched', async () => {
    const vault = await scratchVault()
    const target = await note(vault)
    const appended = await appendSessionLog(target, [
      { hash: 'abc1234', date: '2026-08-02', subject: 'do a thing' },
    ], '2026-08-03')
    expect(appended).toHaveLength(1)
    const text = await readFile(target.path, 'utf8')
    expect(text).toContain('- 2026-08-02 `abc1234` do a thing')
    expect(text).toContain('last_touched: 2026-08-03')
  })

  it('skips commits whose hashes the note already records, writing nothing', async () => {
    const vault = await scratchVault()
    const target = await note(vault)
    await appendSessionLog(target, [{ hash: 'abc1234', date: '2026-08-02', subject: 'do a thing' }], '2026-08-03')
    const before = await readFile(target.path, 'utf8')
    const appended = await appendSessionLog(target, [{ hash: 'abc1234', date: '2026-08-02', subject: 'do a thing' }], '2026-08-04')
    expect(appended).toEqual([])
    expect(await readFile(target.path, 'utf8')).toBe(before)
  })

  it('creates the session log heading when the note lacks one', async () => {
    const vault = await scratchVault()
    await mkdir(join(vault, 'Projects', 'q'), { recursive: true })
    const path = join(vault, 'Projects', 'q', '_index.md')
    await writeFile(path, '---\nstatus: active\nrepo: /repo/q\nlast_touched: 2026-08-01\n---\n# q\n')
    await appendSessionLog({ path, repo: '/repo/q', lastTouched: '2026-08-01' }, [
      { hash: 'fff9999', date: '2026-08-02', subject: 'late add' },
    ], '2026-08-02')
    const text = await readFile(path, 'utf8')
    expect(text).toContain('## Session log\n- 2026-08-02 `fff9999` late add')
  })
})

describe('reconcile', () => {
  it('flags a note whose repo pointer is dead', async () => {
    const vault = await scratchVault()
    await mkdir(join(vault, 'Projects', 'gone'), { recursive: true })
    await writeFile(
      join(vault, 'Projects', 'gone', '_index.md'),
      projectNoteFor('gone', join(vault, 'no-such-repo'), '2026-08-01'),
    )
    const stale = await reconcile(vault)
    expect(stale).toHaveLength(1)
    expect(stale[0]!.commitsBehind).toBe(-1)
  })
})

/**
 * The readings behind a chat's uncommitted line: what `git status` reports,
 * which files count as changed, and how one line per chat is kept in a log.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changedSince, recordUncommitted, uncommittedLine, workingState } from '../src/index.ts'

const run = promisify(execFile)
let repo: string

beforeEach(async () => {
  repo = await realpath(await mkdtemp(join(tmpdir(), 'idealize-vault-working-')))
  await run('git', ['-C', repo, 'init', '-q', '-b', 'main'])
  await run('git', ['-C', repo, 'config', 'user.email', 'spec@idealize.test'])
  await run('git', ['-C', repo, 'config', 'user.name', 'Vault Spec'])
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

async function commitAll(message: string): Promise<void> {
  await run('git', ['-C', repo, 'add', '-A'])
  await run('git', ['-C', repo, 'commit', '-q', '-m', message])
}

describe('workingState', () => {
  it('reads no HEAD and no files in a new repository, then the commit and every uncommitted path', async () => {
    expect(await workingState(repo)).toEqual({ head: undefined, files: new Map() })
    await writeFile(join(repo, 'kept.txt'), 'kept')
    await writeFile(join(repo, 'moved.txt'), 'a file long enough for git to follow when it is renamed\n')
    await writeFile(join(repo, 'removed.txt'), 'removed')
    await commitAll('first')
    await run('git', ['-C', repo, 'mv', 'moved.txt', 'renamed.txt'])
    await rm(join(repo, 'removed.txt'))
    await writeFile(join(repo, 'kept.txt'), 'kept, and edited')
    await writeFile(join(repo, 'new file.txt'), 'new')

    const state = await workingState(repo)
    expect(state.head).toMatch(/^[0-9a-f]{40}$/)
    expect([...state.files.keys()].sort()).toEqual(['kept.txt', 'new file.txt', 'removed.txt', 'renamed.txt'])
    expect(state.files.get('removed.txt')).toBe(' D:gone')
    expect(state.files.get('kept.txt')).toMatch(/^ M:16:\d/)
    expect(state.files.get('renamed.txt')).toMatch(/^R :\d+:\d/)
  })

  it('leaves out an excluded folder, whether git lists its files or the untracked folder that holds it', async () => {
    await mkdir(join(repo, 'notes', 'vault'), { recursive: true })
    await writeFile(join(repo, 'notes', 'vault', 'log.md'), 'log')
    await writeFile(join(repo, 'app.css'), 'body {}')
    // Untracked: git reports `notes/` alone.
    expect([...(await workingState(repo, 'notes/vault')).files.keys()]).toEqual(['app.css'])
    await commitAll('first')
    await writeFile(join(repo, 'notes', 'vault', 'log.md'), 'log, longer')
    await writeFile(join(repo, 'notes', 'plan.md'), 'plan')
    expect([...(await workingState(repo, 'notes/vault')).files.keys()]).toEqual(['notes/plan.md'])
    expect([...(await workingState(repo)).files.keys()].sort()).toEqual(['notes/plan.md', 'notes/vault/log.md'])
  })
})

describe('changedSince', () => {
  it('counts files that are new or differ, and ignores ones that are unchanged or no longer uncommitted', () => {
    const before = { head: 'a', files: new Map([['same.txt', ' M:1:1'], ['edited.txt', ' M:1:1'], ['reverted.txt', ' M:1:1']]) }
    const now = { head: 'a', files: new Map([['same.txt', ' M:1:1'], ['edited.txt', ' M:2:5'], ['new.txt', '??:3:9']]) }
    expect(changedSince(before, now)).toBe(2)
    expect(changedSince(before, before)).toBe(0)
  })
})

describe('uncommittedLine', () => {
  it('holds the quoted title, the count, the mark and a link to the chat’s copy', () => {
    expect(uncommittedLine('Palette', 3, 'sessions/2026-11-16-palette-abcd1234.md'))
      .toBe('- "Palette": 3 files changed (uncommitted). [Transcript](sessions/2026-11-16-palette-abcd1234.md)')
    expect(uncommittedLine(undefined, 1, undefined)).toBe('- "Untitled chat": 1 file changed (uncommitted).')
    expect(uncommittedLine('a\n## heading "x"', 2, 'sessions/a b.md')).toBe('- "a ## heading \\"x\\"": 2 files changed (uncommitted). [Transcript](sessions/a%20b.md)')
  })
})

describe('recordUncommitted', () => {
  const log = '# p log\n\n## 2026-11-16\n\n- `abc1234` "a commit"\n'
  const first = '- "Palette": 1 file changed (uncommitted). [Transcript](sessions/2026-11-16-palette-abcd1234.md)'
  const second = first.replace('1 file', '2 files')
  const marker = '-abcd1234.md'

  it('adds a chat’s first line under the day', () => {
    expect(recordUncommitted(log, { day: '2026-11-16', line: first, previous: undefined, marker })).toBe(`${log}${first}\n`)
    expect(recordUncommitted(log, { day: '2026-11-17', line: first, previous: undefined, marker: undefined })).toBe(`${log}\n## 2026-11-17\n\n${first}\n`)
  })

  it('replaces the line this run wrote, where it stands', () => {
    expect(recordUncommitted(`${log}${first}\n- later\n`, { day: '2026-11-18', line: second, previous: first, marker })).toBe(`${log}${second}\n- later\n`)
  })

  it('writes nothing when a person removed the line, or an earlier run already wrote one for the chat', () => {
    expect(recordUncommitted(log, { day: '2026-11-16', line: second, previous: first, marker })).toBeUndefined()
    expect(recordUncommitted(`${log}${first}\n`, { day: '2026-11-17', line: second, previous: undefined, marker })).toBeUndefined()
    // The chat's copy named in a commit subject is no uncommitted line.
    const named = `${log}- \`def5678\` "tidy sessions/2026-11-16-palette-abcd1234.md"\n`
    expect(recordUncommitted(named, { day: '2026-11-16', line: first, previous: undefined, marker })).toBe(`${named}${first}\n`)
  })
})

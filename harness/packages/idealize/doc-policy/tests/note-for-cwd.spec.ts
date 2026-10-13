// A chat's project note follows its working folder: a project's own notes
// folder inside the documentation folder, a repository named by `repo:`, or a
// plain folder named by `repo:`. The documentation folder is often a
// repository itself, and its toplevel must never stand in for the project.
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { noteForCwd } from '../src/notes-lookup.ts'

const run = promisify(execFile)
let root: string
let vault: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-note-for-cwd-')))
  vault = join(root, 'vault')
  await mkdir(join(vault, 'Projects', 'DocLeaf', 'research'), { recursive: true })
  await writeFile(join(vault, 'Projects', 'DocLeaf', '_index.md'), `---\nrepo: ${join(root, 'code', 'docleaf')}\n---\n# DocLeaf\n`)
  // The vault is a repository of its own, as JJ's is.
  await run('git', ['init', '-q', vault])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('noteForCwd', () => {
  it('gives a chat in a project notes folder that project note, though the vault is a repository', async () => {
    const note = join(vault, 'Projects', 'DocLeaf', '_index.md')
    expect(await noteForCwd(vault, join(vault, 'Projects', 'DocLeaf'))).toEqual({ notePath: note, inFolder: true })
    expect(await noteForCwd(vault, join(vault, 'Projects', 'DocLeaf', 'research'))).toEqual({ notePath: note, inFolder: true })
  })

  it('finds no note, and names no repository, elsewhere in the vault', async () => {
    expect(await noteForCwd(vault, vault)).toEqual({ inFolder: true })
  })

  it('matches a folder outside any repository against repo: pointers', async () => {
    const code = join(root, 'code', 'docleaf')
    await mkdir(code, { recursive: true })
    expect(await noteForCwd(vault, code)).toEqual({ notePath: join(vault, 'Projects', 'DocLeaf', '_index.md'), inFolder: false })
  })

  it('matches a repository subfolder by its toplevel, and reports a repository with no note', async () => {
    const code = join(root, 'code', 'docleaf')
    await mkdir(join(code, 'src'), { recursive: true })
    await run('git', ['init', '-q', code])
    expect(await noteForCwd(vault, join(code, 'src'))).toEqual({ notePath: join(vault, 'Projects', 'DocLeaf', '_index.md'), repoToplevel: code, inFolder: false })
    const other = join(root, 'code', 'other')
    await mkdir(other, { recursive: true })
    await run('git', ['init', '-q', other])
    expect(await noteForCwd(vault, other)).toEqual({ repoToplevel: other, inFolder: false })
  })
})

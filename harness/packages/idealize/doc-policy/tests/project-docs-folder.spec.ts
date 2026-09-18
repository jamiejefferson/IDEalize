// A project's documentation folder: the note's `repo:` pointer decides, the
// Projects/ entry sharing the project folder's name is the fallback.
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectDocsFolder } from '../src/notes-lookup.ts'

let root: string
let vault: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-project-docs-')))
  vault = join(root, 'vault')
  await mkdir(join(vault, 'Projects'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('projectDocsFolder', () => {
  it('follows the repo: pointer to a note folder under a different name', async () => {
    const project = join(root, 'code', 'acme-app')
    await mkdir(project, { recursive: true })
    await mkdir(join(vault, 'Projects', 'Acme'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'Acme', '_index.md'), `---\nrepo: ${project} (V1)\n---\n# Acme\n`)
    expect(await projectDocsFolder(vault, project)).toEqual({ path: join(vault, 'Projects', 'Acme'), source: 'note' })
  })

  it('falls back to the Projects entry named like the project folder, without case', async () => {
    const project = join(root, 'code', 'Heliotrope')
    await mkdir(project, { recursive: true })
    await mkdir(join(vault, 'Projects', 'heliotrope'), { recursive: true })
    expect(await projectDocsFolder(vault, project)).toEqual({ path: join(vault, 'Projects', 'heliotrope'), source: 'name' })
  })

  it('prefers the note over a name match', async () => {
    const project = join(root, 'code', 'acme')
    await mkdir(project, { recursive: true })
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await mkdir(join(vault, 'Projects', 'Acme Rebuild'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'Acme Rebuild', '_index.md'), `---\nrepo: ${project}\n---\n`)
    expect((await projectDocsFolder(vault, project))?.path).toBe(join(vault, 'Projects', 'Acme Rebuild'))
  })

  it('finds nothing for an unmatched project, a name held by a file, a missing project and a vault without Projects/', async () => {
    const project = join(root, 'code', 'orphan')
    await mkdir(project, { recursive: true })
    expect(await projectDocsFolder(vault, project)).toBeUndefined()
    await writeFile(join(vault, 'Projects', 'orphan'), '')
    expect(await projectDocsFolder(vault, project)).toBeUndefined()
    expect(await projectDocsFolder(vault, join(root, 'code', 'gone'))).toBeUndefined()
    expect(await projectDocsFolder(join(root, 'empty-vault'), project)).toBeUndefined()
  })
})

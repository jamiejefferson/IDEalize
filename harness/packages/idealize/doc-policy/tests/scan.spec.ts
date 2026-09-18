import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RULESET_VERSION, fingerprintFolder, parseNotePointers, projectNoteFor, projectNotes, scaffoldVault, scanFolder } from '../src/index.ts'

async function scratchVault(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'idealize-doc-policy-scan-'))
}

describe('scaffoldVault', () => {
  it('creates the canonical structure additively and idempotently', async () => {
    const vault = await scratchVault()
    const first = await scaffoldVault(vault)
    expect(first).toContain('CONVENTIONS.md')
    expect(first).toContain('Projects/')
    await writeFile(join(vault, 'CONVENTIONS.md'), 'customized\n')
    expect(await scaffoldVault(vault)).toEqual([])
  })
})

describe('fingerprintFolder', () => {
  afterEach(() => { vi.useRealTimers() })

  it('stays equal for an untouched folder and changes with every input of a scan', async () => {
    const vault = await scratchVault()
    await scaffoldVault(vault)
    const note = join(vault, 'Projects', 'acme', '_index.md')
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(note, projectNoteFor('acme', '/repo/acme', '2026-08-24'))
    const seen = new Set<string>()
    const next = async (): Promise<string> => {
      const print = await fingerprintFolder(vault)
      seen.add(print)
      return print
    }

    const base = await next()
    expect(await fingerprintFolder(vault)).toBe(base)

    // Same size, later modification time: an in-place edit.
    await utimes(note, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))
    await next()
    // A new document, a project folder with no note, a stray root file, an unknown root folder.
    await writeFile(join(vault, 'Reference', 'colour.md'), '# Colour\n')
    await next()
    await mkdir(join(vault, 'Projects', 'empty'))
    await next()
    await writeFile(join(vault, 'loose.md'), '# Loose\n')
    await next()
    await mkdir(join(vault, 'Archive'))
    await next()
    await rm(join(vault, 'Reference', 'colour.md'))
    await next()
    expect(seen.size).toBe(7)
  })

  it('ignores what a scan never reads: hidden entries, other file types, and folders outside the canonical set', async () => {
    const vault = await scratchVault()
    await scaffoldVault(vault)
    await mkdir(join(vault, 'Archive'))
    const base = await fingerprintFolder(vault)

    await mkdir(join(vault, '.obsidian'))
    await writeFile(join(vault, '.obsidian', 'workspace.json'), '{}')
    await writeFile(join(vault, 'Reference', 'photo.png'), 'x')
    await writeFile(join(vault, 'Archive', 'old.md'), '# Old\n')

    expect(await fingerprintFolder(vault)).toBe(base)
  })

  it('changes at the local date rollover, because the stale-note rule reads today', async () => {
    const vault = await scratchVault()
    await scaffoldVault(vault)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 18, 23, 59))
    const before = await fingerprintFolder(vault)
    vi.setSystemTime(new Date(2026, 8, 19, 0, 1))
    expect(await fingerprintFolder(vault)).not.toBe(before)
  })
})

describe('scanFolder', () => {
  it('scans a freshly scaffolded vault with a conformant project clean', async () => {
    const vault = await scratchVault()
    await scaffoldVault(vault)
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'acme', '_index.md'), projectNoteFor('acme', '/repo/acme', '2026-08-24'))
    const result = await scanFolder(vault)
    expect(result.findings).toEqual([])
    expect(result.policyVersion).toBe(RULESET_VERSION.id)
    expect(result.docs.map(doc => doc.path)).toContain('Projects/acme/_index.md')
    expect(result.docs.find(doc => doc.path === 'Projects/acme/_index.md')?.title).toBe('acme')
  })

  it('raises one finding per seeded structural drift, stamped with the policy version', async () => {
    const vault = await scratchVault()
    await scaffoldVault(vault)
    await mkdir(join(vault, 'Projects', 'indexless'), { recursive: true })
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(
      join(vault, 'Projects', 'acme', '_index.md'),
      projectNoteFor('acme', '/repo/acme', '2026-08-24').replace(/^status:.*$/m, 'status: ongoing'),
    )
    await writeFile(join(vault, 'scratch.md'), '# scratch\n')
    await mkdir(join(vault, 'Random'), { recursive: true })
    await writeFile(join(vault, 'Decisions', 'thoughts.md'), '### 2026-08-24 — decided\n')

    const result = await scanFolder(vault)
    const rules = result.findings.map(finding => `${finding.rule}:${finding.path}`).sort()
    expect(rules).toEqual([
      'decision-bad-name:Decisions/thoughts.md',
      'invalid-status:Projects/acme/_index.md',
      'missing-index:Projects/indexless',
      'stray-root-file:scratch.md',
      'unknown-root-dir:Random',
    ])
    expect(result.policyVersion).toBe(RULESET_VERSION.id)
  })

  it('answers empty for a folder that does not exist yet', async () => {
    const result = await scanFolder(join(await scratchVault(), 'missing'))
    expect(result.findings).toEqual([])
    expect(result.docs).toEqual([])
  })

  it('indexes Markdown alone, wherever it sits', async () => {
    const vault = await scratchVault()
    await scaffoldVault(vault)
    await writeFile(join(vault, 'Reference', 'diagram.png'), 'not markdown')
    await writeFile(join(vault, 'cover.png'), 'not markdown either')
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'acme', '_index.md'), projectNoteFor('acme', '/repo/acme', '2026-08-24'))
    await writeFile(join(vault, 'Projects', 'acme', 'notes.txt'), 'not markdown')

    const result = await scanFolder(vault)
    expect(result.docs.some(doc => doc.path.endsWith('.png'))).toBe(false)
    expect(result.docs.some(doc => doc.path.endsWith('notes.txt'))).toBe(false)
  })

  it('names a project folder with no index, and ignores a stray file beside the folders', async () => {
    const vault = await scratchVault()
    await scaffoldVault(vault)
    await mkdir(join(vault, 'Projects', 'bare'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'stray-note.md'), '# stray\n')

    const result = await scanFolder(vault)
    expect(result.findings.some(finding => finding.rule === 'missing-index' && finding.path === 'Projects/bare')).toBe(true)
  })
})

describe('projectNotes', () => {
  it('reads no notes at all from a folder with no Projects directory', async () => {
    expect(await projectNotes(await scratchVault())).toEqual([])
  })

  it('takes the notes carrying a repo pointer and leaves the rest', async () => {
    const vault = await scratchVault()
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'acme', '_index.md'), projectNoteFor('acme', '/repo/acme', '2026-08-24'))
    // A folder with no note at all, and a note whose pointer is blank.
    await mkdir(join(vault, 'Projects', 'bare'), { recursive: true })
    await mkdir(join(vault, 'Projects', 'blank'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'blank', '_index.md'), '---\nrepo:\n---\n')

    expect((await projectNotes(vault)).map(note => note.repo)).toEqual(['/repo/acme'])
  })
})

describe('parseNotePointers', () => {
  it('takes a whole date and leaves anything else out', () => {
    expect(parseNotePointers('---\nrepo: /repo/acme\nlast_touched: 2026-08-24\n---\n'))
      .toEqual({ repo: '/repo/acme', lastTouched: '2026-08-24' })
    expect(parseNotePointers('---\nrepo: /repo/acme\nlast_touched: last Tuesday\n---\n'))
      .toEqual({ repo: '/repo/acme' })
  })

  it('reads a frontmatter block whose lines are not all fields', () => {
    expect(parseNotePointers('---\n# a comment line\n\nrepo: /repo/acme\n---\n')).toEqual({ repo: '/repo/acme' })
  })
})

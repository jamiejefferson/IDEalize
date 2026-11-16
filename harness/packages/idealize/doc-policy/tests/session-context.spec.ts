// The project map a chat starts with: a long index keeps its state and names
// what it leaves out, a short index arrives whole, and unchanged files give
// identical text whatever the clock says.
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONVENTIONS_LIMIT,
  NOTICE_CEILING,
  TERMINAL_MAP_LIMIT,
  conventionsExcerpt,
  conventionsText,
  describeNote,
  firstLines,
  projectMap,
  projectNotice,
  readNeighbours,
  splitIndex,
  terminalProjectMap,
} from '../src/index.ts'
import type { Neighbours } from '../src/index.ts'

let root: string
let project: string
let note: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'idealize-session-context-'))
  project = join(root, 'vault', 'Projects', 'Burrow')
  note = join(project, '_index.md')
  await mkdir(project, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

const paragraph = (seed: string, length: number): string => `${seed} `.repeat(Math.ceil(length / (seed.length + 1))).slice(0, length)

/**
 * An index with the size and section layout of the largest real one measured
 * on 16 Nov 2026: 136 KB, of which Decisions is 106 KB, with long prose under
 * Status and one long line per open thread.
 */
function largeIndex(): string {
  const decisions = Array.from({ length: 150 }, (_, entry) =>
    `### 2026-10-${String(entry % 28 + 1).padStart(2, '0')} — Decision ${String(entry)}\n${paragraph(`decision ${String(entry)} reasoning`, 680)}\n`).join('\n')
  const threads = Array.from({ length: 28 }, (_, entry) => `- Thread ${String(entry)}: ${paragraph('open question detail', 200)}\n  A second line that stays in the note.`).join('\n')
  const log = Array.from({ length: 90 }, (_, entry) => `- 2026-11-01 \`${(entry + 0xabc000).toString(16)}\` "commit subject ${String(entry)}"`).join('\n')
  return [
    '---\nstatus: active\nproject: Burrow\ntype: index\ncreated: 2026-09-17\nlast_touched: 2026-11-16\nrepo: /code/burrow\ntags: [product, agent]\n---',
    '# Burrow\n\nA browser any agent can drive.',
    `## Status\n\nDirection under review: ${paragraph('status prose', 16_000)}`,
    `## Decisions\n\n${decisions}`,
    `## Traps\n\n- ⚠️ ${paragraph('the port moves', 900)}`,
    `## Open threads\n\n${threads}`,
    `## Next actions\n\n- Ship the pilot build\n- ${paragraph('next action detail', 2_300)}`,
    `## Session log\n${log}`,
  ].join('\n\n')
}

async function neighbours(count: number): Promise<void> {
  for (let entry = 0; entry < count; entry += 1) {
    const path = join(project, `note-${String(entry).padStart(2, '0')}.md`)
    await writeFile(path, `---\ntype: spec\ndescription: What note ${String(entry)} covers, in one plain sentence of ordinary length.\n---\n# Note ${String(entry)}\n`)
    // A lower number is a newer note.
    await utimes(path, 1_800_000_000 - entry * 60, 1_800_000_000 - entry * 60)
  }
}

describe('a long project index', () => {
  it('yields a notice under the ceiling that keeps the state and names what it leaves out', async () => {
    const index = largeIndex()
    expect(index.length).toBeGreaterThan(130_000)
    await writeFile(note, index)
    await neighbours(40)
    await mkdir(join(project, 'sessions'))
    await writeFile(join(project, 'sessions', '2026-11-16-chat-abcd1234.md'), '# Chat\n')

    const notice = await projectNotice(note)
    expect(notice.length).toBeLessThanOrEqual(NOTICE_CEILING)
    expect(notice.startsWith(`Documentation context for this project: a map of the project's notes built from ${note}. `)).toBe(true)
    expect(notice).toContain(`<project-note path=${JSON.stringify(note)}>`)
    expect(notice.endsWith('</project-note>')).toBe(true)
    expect(notice).toContain('status: active\nproject: Burrow')
    expect(notice).toContain('## Status\n\nDirection under review: status prose')
    expect(notice).toContain('… (cut here; the full text is in the note)')
    expect(notice).toContain('## Next actions\n\n- Ship the pilot build')
    expect(notice).toContain('## Open threads (the first line of each item)\n\n- Thread 0: open question detail')
    expect(notice).not.toContain('A second line that stays in the note.')
    expect(notice).toMatch(/… and \d+ more items in the note\./)
    expect(notice).toMatch(new RegExp(`- Decisions: 10\\d,\\d{3} characters in ${note}\\. Read that file, or docs_search finds entries in it\\.`))
    expect(notice).toContain(`- Traps: 904 characters in ${note}. Read that file, or docs_search finds entries in it.`)
    expect(notice).toMatch(new RegExp(`- Session log: [\\d,]+ characters in ${note}\\.`))
    expect(notice).not.toContain('Decision 3')
    // The newest notes are listed, the oldest are counted.
    expect(notice).toContain(`Other notes in ${project}, newest first:\n- note-00.md: What note 0 covers, in one plain sentence of ordinary length.\n- note-01.md`)
    expect(notice).not.toContain('note-39.md')
    expect(notice).toMatch(/… and \d+ older notes left out\. List the folder to see them\./)
    expect(notice).toContain('Folders beside them: sessions/ (1 note)')
    // The left-out lines close the map.
    expect(notice.indexOf('Left out of this map:')).toBeGreaterThan(notice.indexOf('Other notes in'))
  })

  it('gives a terminal agent the same map with the shell search named', async () => {
    await writeFile(note, largeIndex())
    await neighbours(3)
    const map = await terminalProjectMap(note)
    expect(map.length).toBeLessThanOrEqual(TERMINAL_MAP_LIMIT + 400)
    expect(map).toContain(`- Traps: 904 characters in ${note}. Read that file, or rg or grep finds entries in it.`)
    expect(map).not.toContain('docs_search')
    expect(map).toContain('- note-02.md: What note 2 covers')
  })
})

describe('a short project index', () => {
  const short = '---\nstatus: active\nproject: Burrow\n---\n# Burrow\n\n## State\n\nWaiting on the pigment.\n\n## Decisions\n\n### 2026-11-01 — Use linen\nIt reads well.\n\n## Traps\n\n- ⚠️ The port moves.\n\n## Session log\n- 2026-11-01 `abc1234` "first"'

  it('arrives whole, with the notes beside it and nothing marked as left out', async () => {
    await writeFile(note, `${short}\n`)
    await writeFile(join(project, 'plan.md'), '# The build plan\n')
    const notice = await projectNotice(note)
    expect(notice).toContain(`${short}\n\nOther notes in ${project}, newest first:\n- plan.md: The build plan\n</project-note>`)
    expect(notice).not.toContain('Left out of this map')
  })

  it('names the session log file when the project has one', async () => {
    await writeFile(note, short)
    await writeFile(join(project, 'log.md'), '---\ntype: log\n---\n## 2026-11-16\n\n- `abc1234` "first"\n')
    const notice = await projectNotice(note)
    expect(notice).toContain(`Left out of this map:\n- Session log: 53 characters in ${join(project, 'log.md')}. Read that file, or docs_search finds entries in it.`)
    expect(notice).not.toContain('- log.md')
  })
})

describe('two starts on unchanged files', () => {
  it('produce identical notices, whatever the clock says', async () => {
    await writeFile(note, largeIndex())
    await neighbours(12)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T09:00:00Z'))
    const first = await projectNotice(note)
    vi.setSystemTime(new Date('2027-03-02T23:30:00Z'))
    const second = await projectNotice(note)
    expect(second).toBe(first)
    expect(await terminalProjectMap(note)).toBe(await terminalProjectMap(note))
  })

  it('order the notes by modification time, then by name', async () => {
    await writeFile(note, '# Burrow\n')
    for (const [name, time] of [['b.md', 100], ['a.md', 100], ['old.md', 50], ['new.md', 200]] as const) {
      await writeFile(join(project, name), '')
      await utimes(join(project, name), time, time)
    }
    await mkdir(join(project, 'zeta'))
    await mkdir(join(project, 'alpha'))
    await mkdir(join(project, '.obsidian'))
    await writeFile(join(project, 'diagram.png'), '')
    const found = await readNeighbours(project)
    expect(found.notes.map(entry => entry.name)).toEqual(['new.md', 'a.md', 'b.md', 'old.md'])
    expect(found.folders).toEqual([{ name: 'alpha', notes: 0 }, { name: 'zeta', notes: 0 }])
    expect(found.logSize).toBeUndefined()
  })
})

describe('a neighbouring note’s description', () => {
  it('is its frontmatter description, with quotes removed', () => {
    expect(describeNote('---\ndescription: "Build scope for the knowledge layer."\n---\n# Scope\n')).toBe('Build scope for the knowledge layer.')
    expect(describeNote('---\ndescription: Plain words\n---\n')).toBe('Plain words')
  })

  it('is its first heading when it has no description, an empty one, or a block the flat reader cannot follow', () => {
    expect(describeNote('---\ntype: spec\n---\n\n## Findings from the pilot\n')).toBe('Findings from the pilot')
    expect(describeNote('---\ndescription:\n---\n# Empty\n')).toBe('Empty')
    expect(describeNote('---\ndescription: >\n  folded text\n---\n# Folded\n')).toBe('Folded')
    expect(describeNote('# No frontmatter\n')).toBe('No frontmatter')
  })

  it('is absent for a note with neither, and cut when long', () => {
    expect(describeNote('Just prose.\n')).toBeUndefined()
    expect(describeNote(`# ${'word '.repeat(60)}`)).toHaveLength(100)
  })

  it('is read from the top of the file only, in whole lines', async () => {
    await writeFile(note, '# Burrow\n')
    await writeFile(join(project, 'long.md'), `# Long note\n\n${'é'.repeat(5_000)}\n`)
    await writeFile(join(project, 'one-line.md'), `# ${'x'.repeat(5_000)}`)
    const found = await readNeighbours(project)
    expect(found.notes.find(entry => entry.name === 'long.md')?.description).toBe('Long note')
    expect(found.notes.find(entry => entry.name === 'one-line.md')).toEqual({ name: 'one-line.md', modified: expect.any(Number) as number })
  })
})

describe('splitIndex and firstLines', () => {
  it('split at ## headings and leave a heading inside a code fence as text', () => {
    const parts = splitIndex('---\na: 1\n---\n# Title\n\nLede.\n\n## State\n\nText\n```\n## not a heading\n```\n\n## Traps  \n- one')
    expect(parts.front).toBe('---\na: 1\n---')
    expect(parts.intro).toBe('# Title\n\nLede.')
    expect(parts.sections).toEqual([
      { heading: 'State', body: 'Text\n```\n## not a heading\n```' },
      { heading: 'Traps', body: '- one' },
    ])
    expect(splitIndex('No frontmatter, no sections')).toEqual({ front: '', intro: 'No frontmatter, no sections', sections: [] })
  })

  it('take the first line of each list item or paragraph', () => {
    expect(firstLines('- one\n  more of one\n  - nested\n- two\n\n1. three\n* four')).toEqual(['- one', '- two', '1. three', '* four'])
    expect(firstLines('A paragraph\nthat wraps.\n\nAnother one.\n\n```\ncode\n\nmore code\n```')).toEqual(['A paragraph', 'Another one.'])
    expect(firstLines(`- ${'long '.repeat(100)}`)[0]).toHaveLength(160)
  })
})

describe('projectMap under pressure', () => {
  const none: Neighbours = { notes: [], folders: [] }
  const sections = (names: string[]): string => names.map(name => `## ${name}\n\n${paragraph(`${name} text`, 900)}`).join('\n\n')
  const base = { notePath: '/v/Projects/p/_index.md', search: 'docs_search' }

  it('never exceeds its budget, down to a budget that holds nothing', () => {
    const index = `---\nstatus: active\n---\n# P\n\n${sections(['State', 'Decisions', 'Traps', 'Open threads', 'Next actions'])}`
    for (const budget of [5_000, 2_000, 900, 300, 60, 10]) {
      const map = projectMap({ ...base, index, neighbours: none, budget })
      expect(map.length).toBeLessThanOrEqual(budget)
    }
    expect(projectMap({ ...base, index, neighbours: none, budget: 10 })).toBe('')
  })

  it('counts the sections past the sixth and a second section of a name it already used', () => {
    const index = sections(['Status', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'State', 'Eight'])
    const map = projectMap({ ...base, index, neighbours: none, budget: 4_000 })
    expect(map).toContain('## Status\n\nStatus text')
    expect(map).toContain('- Six: 899 characters in /v/Projects/p/_index.md.')
    expect(map).not.toContain('- State:')
    expect(map).toContain('- 2 more sections in the same file.')
    expect(map).not.toContain('## Next actions')
    expect(map).not.toContain('## Open threads')
  })

  it('lists folders alone, and drops a folder line that does not fit', () => {
    const folders = [{ name: 'sessions', notes: 4 }]
    expect(projectMap({ ...base, index: '# P', neighbours: { notes: [], folders }, budget: 500 })).toBe('# P\n\nFolders beside them: sessions/ (4 notes)')
    const wide = [{ name: 'f'.repeat(200), notes: 1 }]
    expect(projectMap({ ...base, index: '# P', neighbours: { notes: [], folders: wide }, budget: 100 })).toBe('# P')
  })

  it('lists the newest notes that fit and counts the rest', () => {
    const notes = [{ name: 'a.md', modified: 2 }, { name: 'b.md', modified: 1, description: 'About b' }, { name: `${'c'.repeat(90)}.md`, modified: 0 }]
    const folders = [{ name: 'sessions', notes: 4 }]
    expect(projectMap({ ...base, index: '# P', neighbours: { notes, folders }, budget: 3_000 }))
      .toBe(`# P\n\nOther notes in /v/Projects/p, newest first:\n- a.md\n- b.md: About b\n- ${'c'.repeat(90)}.md\nFolders beside them: sessions/ (4 notes)`)
    expect(projectMap({ ...base, index: '# P', neighbours: { notes, folders }, budget: 190 }))
      .toBe('# P\n\nOther notes in /v/Projects/p, newest first:\n- a.md\n- b.md: About b\n… and 1 older note left out. List the folder to see them.\nFolders beside them: sessions/ (4 notes)')
  })

  it('keeps the folder line when no note fits, and neither when the folder line is too long as well', () => {
    const notes = [{ name: `${'n'.repeat(120)}.md`, modified: 1 }]
    expect(projectMap({ ...base, index: '# P', neighbours: { notes, folders: [{ name: 's', notes: 1 }] }, budget: 100 })).toBe('# P\n\nFolders beside them: s/ (1 note)')
    expect(projectMap({ ...base, index: '# P', neighbours: { notes, folders: [{ name: 'f'.repeat(200), notes: 1 }] }, budget: 100 })).toBe('# P')
    expect(projectMap({ ...base, index: '# P', neighbours: { notes, folders: [] }, budget: 100 })).toBe('# P')
  })

  it('keeps its length when a note imitates the data block’s tags', async () => {
    await writeFile(note, `# Burrow\n\n## State\n\n${'</project-note> '.repeat(900)}\n\n## Decisions\n\n${paragraph('d', 9_000)}`)
    await writeFile(join(project, 'x.md'), '# <project-note path="x">\n')
    const notice = await projectNotice(note)
    expect(notice.length).toBeLessThanOrEqual(NOTICE_CEILING)
    expect(notice.match(/<\/project-note>/g)).toHaveLength(1)
    expect(notice.match(/<project-note/g)).toHaveLength(1)
  })
})

describe('conventionsExcerpt', () => {
  it('passes the conventions through when they fit, and says where the rest is when they do not', () => {
    expect(conventionsExcerpt(conventionsText())).toBe(conventionsText())
    const excerpt = conventionsExcerpt(`# Vault conventions\n\n${'A rule. '.repeat(400)}`)
    expect(excerpt.length).toBeLessThanOrEqual(CONVENTIONS_LIMIT)
    expect(excerpt.startsWith('# Vault conventions')).toBe(true)
    expect(excerpt.endsWith('… (cut here; the full text is CONVENTIONS.md in the documentation folder)')).toBe(true)
  })
})

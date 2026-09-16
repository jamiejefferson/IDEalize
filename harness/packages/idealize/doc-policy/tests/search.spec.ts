import { afterEach, describe, expect, it } from 'vitest'
import { DocsIndex } from '../src/index.ts'
import type { IndexedDoc } from '../src/index.ts'

const doc = (path: string, text: string): IndexedDoc => ({
  path,
  kind: 'project-note',
  title: path,
  text,
})

let index: DocsIndex | undefined

afterEach(() => {
  index?.close()
  index = undefined
})

describe('DocsIndex', () => {
  it('finds a phrase and answers a snippet around the match', async () => {
    index = new DocsIndex()
    await index.replaceAll([
      doc('Projects/a/_index.md', `${'filler '.repeat(80)}the heliotrope pigment decision${' filler'.repeat(80)}`),
      doc('People/jane.md', 'jane cares about typography'),
    ])
    expect(await index.count()).toBe(2)
    const hits = await index.search('heliotrope pigment', 8)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.path).toBe('Projects/a/_index.md')
    expect(hits[0]!.snippet).toContain('heliotrope pigment')
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(202)
  })

  it('replaces the whole corpus on the next scan', async () => {
    index = new DocsIndex()
    await index.replaceAll([doc('a.md', 'alpha')])
    await index.replaceAll([doc('b.md', 'beta')])
    expect(await index.search('alpha', 8)).toEqual([])
    expect((await index.search('beta', 8)).map(hit => hit.path)).toEqual(['b.md'])
  })

  it('treats FTS5 query syntax as inert data', async () => {
    index = new DocsIndex()
    await index.replaceAll([doc('a.md', 'plain text')])
    await expect(index.search('"; DROP TABLE docs; --', 8)).resolves.toEqual([])
    await expect(index.search('NEAR(a b)', 8)).resolves.toEqual([])
    await expect(index.search('   ', 8)).resolves.toEqual([])
  })

  it('centres the excerpt on the first match and marks both cuts', async () => {
    index = new DocsIndex()
    await index.replaceAll([
      doc('Projects/a/_index.md', `${'filler '.repeat(120)}heliotrope in the middle ${'filler '.repeat(40)}heliotrope again${' filler'.repeat(120)}`),
    ])
    const [hit] = await index.search('heliotrope', 8)
    expect(hit?.snippet.startsWith('…')).toBe(true)
    expect(hit?.snippet.endsWith('…')).toBe(true)
  })

  it('marks only the cut it made, at each end of a long document', async () => {
    index = new DocsIndex()
    const filler = 'filler '.repeat(120)
    await index.replaceAll([
      doc('head.md', `heliotrope opens this one ${filler}`),
      doc('tail.md', `${filler} heliotrope closes this one`),
    ])
    const hits = await index.search('heliotrope', 8)
    const head = hits.find(hit => hit.path === 'head.md')
    const tail = hits.find(hit => hit.path === 'tail.md')
    expect(head?.snippet.startsWith('…')).toBe(false)
    expect(head?.snippet.endsWith('…')).toBe(true)
    expect(tail?.snippet.startsWith('…')).toBe(true)
    expect(tail?.snippet.endsWith('…')).toBe(false)
  })

  it('squeezes runs of whitespace and drops the trailing one', async () => {
    index = new DocsIndex()
    await index.replaceAll([doc('spaced.md', '   heliotrope \n\n  pigment   ')])
    const [hit] = await index.search('heliotrope pigment', 8)
    expect(hit?.snippet).toBe('heliotrope pigment')
  })

  it('refuses to search once it is closed', async () => {
    const closing = new DocsIndex()
    await closing.replaceAll([doc('a.md', 'alpha')])
    closing.close()
    await expect(closing.search('alpha', 8)).rejects.toThrow('docs index is closed')
  })

  it('leaves the corpus as it was when a write refuses', async () => {
    index = new DocsIndex()
    await index.replaceAll([doc('a.md', 'alpha')])
    await expect(index.replaceAll([{ ...doc('b.md', 'beta'), kind: { } as never }])).rejects.toThrow()
    expect((await index.search('alpha', 8)).map(hit => hit.path)).toEqual(['a.md'])
  })
})

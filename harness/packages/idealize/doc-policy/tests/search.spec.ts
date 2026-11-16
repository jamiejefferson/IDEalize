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
  it('returns type, status and description, and ranks deprecated, archived and stale notes below the rest', async () => {
    index = new DocsIndex()
    const now = Date.parse('2026-11-16T10:00:00Z')
    // The retired and stale notes repeat the phrase, so match quality alone would put them first.
    const strong = 'gateway refusal '.repeat(6)
    await index.replaceAll([
      { ...doc('Reference/stale.md', strong), type: 'research', staleAt: now - 1 },
      { ...doc('Reference/deprecated.md', strong), status: 'Deprecated' },
      { ...doc('Projects/old/_index.md', strong), status: 'archived' },
      { ...doc('Reference/current.md', `notes on the gateway refusal${' filler'.repeat(40)}`), type: 'note', status: 'shortlist', description: 'How the gateway refuses a model.' },
      { ...doc('Reference/fresh.md', `one gateway refusal${' filler'.repeat(60)}`), staleAt: now + 60_000 },
    ])
    const hits = await index.search('gateway refusal', 8, { now })
    expect(hits.slice(0, 2).map(hit => hit.path).sort()).toEqual(['Reference/current.md', 'Reference/fresh.md'])
    expect(hits.slice(2).map(hit => hit.path).sort()).toEqual(['Projects/old/_index.md', 'Reference/deprecated.md', 'Reference/stale.md'])
    expect(hits.find(hit => hit.path === 'Reference/current.md')).toMatchObject({
      type: 'note', status: 'shortlist', description: 'How the gateway refuses a model.',
    })
    expect(hits.find(hit => hit.path === 'Reference/current.md')).not.toHaveProperty('stale')
    expect(hits.find(hit => hit.path === 'Reference/stale.md')).toMatchObject({ type: 'research', stale: true })
    expect(hits.find(hit => hit.path === 'Reference/fresh.md')).not.toHaveProperty('stale')
    expect(hits.find(hit => hit.path === 'Reference/fresh.md')).not.toHaveProperty('type')

    // The same note turns stale when its instant passes, with no re-index.
    const later = await index.search('gateway refusal', 8, { now: now + 120_000 })
    expect(later.at(0)?.path).toBe('Reference/current.md')
    expect(later.find(hit => hit.path === 'Reference/fresh.md')?.stale).toBe(true)
    // A limit keeps the current notes.
    expect((await index.search('gateway refusal', 2, { now })).map(hit => hit.path).sort()).toEqual(['Reference/current.md', 'Reference/fresh.md'])
    // The default clock is the present.
    expect((await index.search('gateway refusal', 8)).length).toBe(5)
  })

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

  describe('the match modes', () => {
    const corpus = [
      doc('Projects/a/_index.md', 'On Tuesday the gateway refused the model, so the chat fell back.'),
      doc('Reference/gateway.md', 'How the gateway is set up.'),
      doc('Reference/refusals.md', 'A provider refused a request last week.'),
      doc('Reference/operators.md', 'Write a" OR b* when you mean the literal text.'),
      doc('Reference/letters.md', 'The letters a and b, and the word broad.'),
      doc('People/jane.md', 'jane cares about typography'),
    ]
    const paths = async (query: string, match?: 'phrase' | 'all' | 'any'): Promise<string[]> =>
      (await index!.search(query, 8, match === undefined ? {} : { match })).map(hit => hit.path).sort()

    it('all finds "the gateway refused the model" for the query refused gateway', async () => {
      index = new DocsIndex()
      await index.replaceAll(corpus)
      expect(await paths('refused gateway', 'all')).toEqual(['Projects/a/_index.md'])
      expect(await paths('  gateway   refused gateway ', 'all')).toEqual(['Projects/a/_index.md'])
      const [hit] = await index.search('refused gateway', 8, { match: 'all' })
      expect(hit!.snippet).toContain('the gateway refused the model')
    })

    it('any finds every note holding at least one of the words', async () => {
      index = new DocsIndex()
      await index.replaceAll(corpus)
      expect(await paths('refused gateway', 'any')).toEqual(['Projects/a/_index.md', 'Reference/gateway.md', 'Reference/refusals.md'])
      expect(await paths('typography unicorn', 'any')).toEqual(['People/jane.md'])
      expect(await paths('typography unicorn', 'all')).toEqual([])
    })

    it('phrase is the default and behaves as before: the words together, in order', async () => {
      index = new DocsIndex()
      await index.replaceAll(corpus)
      expect(await paths('refused gateway')).toEqual([])
      expect(await paths('refused gateway', 'phrase')).toEqual([])
      expect(await paths('gateway refused')).toEqual(['Projects/a/_index.md'])
      expect(await paths('gateway refused', 'phrase')).toEqual(['Projects/a/_index.md'])
    })

    it('the input a" OR b* returns literal matches only, in every mode', async () => {
      index = new DocsIndex()
      await index.replaceAll(corpus)
      // As a phrase: the tokens a, OR, b side by side. Only the note that spells it out holds them so.
      expect(await paths('a" OR b*')).toEqual(['Reference/operators.md'])
      // Every word: the note must hold the word "or" too, so the letters note (a, b, no "or") is out.
      // Read as syntax, `a OR b*` would also return the letters note and, through the prefix, "broad".
      expect(await paths('a" OR b*', 'all')).toEqual(['Reference/operators.md'])
      // At least one word: notes holding a, or, or b as whole words. No prefix match on "broad" alone.
      // The refusals note holds the word "a".
      expect(await paths('a" OR b*', 'any')).toEqual(['Reference/letters.md', 'Reference/operators.md', 'Reference/refusals.md'])
      expect(await paths('NOT gateway', 'all')).toEqual([])
      expect(await paths('gateway NEAR refused', 'all')).toEqual([])
      expect(await paths('typo*', 'any')).toEqual([])
    })

    it('leaves out a word with nothing to index, and matches a query of only such words as a phrase', async () => {
      index = new DocsIndex()
      await index.replaceAll(corpus)
      expect(await paths('refused - gateway !', 'all')).toEqual(['Projects/a/_index.md'])
      expect(await paths('" * -', 'all')).toEqual([])
      expect(await paths('" * -', 'any')).toEqual([])
    })
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

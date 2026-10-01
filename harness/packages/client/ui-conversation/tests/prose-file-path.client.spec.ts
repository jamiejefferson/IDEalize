// What path a link destination or inline-code token in the assistant's prose
// spells: the chat view links the ones the in-app viewer shows.
import { describe, expect, it } from 'vitest'
import { proseFilePath } from '../src/client/chat/prose-file-path.ts'

describe('proseFilePath', () => {
  it('reads relative, anchored and absolute paths, dropping a fragment, query or line', () => {
    expect(proseFilePath('docs/plan.md')).toBe('docs/plan.md')
    expect(proseFilePath(' README.md ')).toBe('README.md')
    expect(proseFilePath('docs/plan.md#goals')).toBe('docs/plan.md')
    expect(proseFilePath('docs/plan.md?raw')).toBe('docs/plan.md')
    expect(proseFilePath('docs/plan.md:12')).toBe('docs/plan.md')
    expect(proseFilePath('docs/plan.md:12:3')).toBe('docs/plan.md')
    expect(proseFilePath('/Users/jj/My Vault/note.md')).toBe('/Users/jj/My Vault/note.md')
    expect(proseFilePath('~/notes/a b.md')).toBe('~/notes/a b.md')
    expect(proseFilePath('../up.md')).toBe('../up.md')
    expect(proseFilePath('C:\\work\\plan.md')).toBe('C:\\work\\plan.md')
    expect(proseFilePath('docs/my%20plan.md')).toBe('docs/my plan.md')
    // A % that escapes nothing is part of the name.
    expect(proseFilePath('docs/100%.md')).toBe('docs/100%.md')
  })

  it('reads a file: URL as its decoded local path', () => {
    expect(proseFilePath('file:///Users/jj/My%20Vault/a.md')).toBe('/Users/jj/My Vault/a.md')
    expect(proseFilePath('file://localhost/tmp/a.md')).toBe('/tmp/a.md')
    expect(proseFilePath('file:///C:/work/a.md')).toBe('C:/work/a.md')
    expect(proseFilePath('file:///tmp/100%zz.md')).toBe('/tmp/100%zz.md')
    expect(proseFilePath('file://server/share/a.md')).toBeUndefined()
    expect(proseFilePath('file://exa mple/a.md')).toBeUndefined()
  })

  it('refuses URLs of other schemes, commands, multi-line text and empty text', () => {
    expect(proseFilePath('https://example.com/a.md')).toBeUndefined()
    expect(proseFilePath('mailto:jj@example.com')).toBeUndefined()
    expect(proseFilePath('cat notes.md')).toBeUndefined()
    expect(proseFilePath('a.md\nb.md')).toBeUndefined()
    expect(proseFilePath('   ')).toBeUndefined()
    expect(proseFilePath('#only-a-fragment')).toBeUndefined()
  })
})

// @vitest-environment jsdom
// The composer "+" menu registry: ordering, duplicate rejection, disposal.
import { describe, expect, it } from 'vitest'
import { createComposerMenu } from '../src/client/composer-menu.ts'

describe('createComposerMenu', () => {
  it('publishes entries sorted by order, refuses a duplicate id, and disposal removes the entry', () => {
    const menu = createComposerMenu()
    const lengths: number[] = []
    menu.entries.subscribe(() => { lengths.push(menu.entries.getSnapshot().length) })
    const offLater = menu.register({ id: 'later', order: 20, label: 'Later', onSelect: () => {} })
    menu.register({ id: 'first', order: 10, label: 'First', onSelect: () => {} })
    expect(menu.entries.getSnapshot().map(entry => entry.id)).toEqual(['first', 'later'])
    expect(() => menu.register({ id: 'first', order: 30, label: 'Again', onSelect: () => {} })).toThrow(/duplicate entry "first"/)
    offLater()
    expect(menu.entries.getSnapshot().map(entry => entry.id)).toEqual(['first'])
    // A second call of the same disposer is a no-op.
    offLater()
    expect(lengths).toEqual([1, 2, 1])
  })
})

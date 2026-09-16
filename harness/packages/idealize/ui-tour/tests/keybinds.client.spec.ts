import { describe, expect, it, vi } from 'vitest'
import {
  chord, formatChord, formatChords, isAppChord, KeybindRegistry, matchesChord,
} from '../src/client/keybinds.ts'

function key(overrides: Partial<{ key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }>) {
  return { key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...overrides }
}

describe('chord', () => {
  it('parses modifiers in canonical order and lower-cases single keys', () => {
    expect(chord('shift+meta+R')).toEqual({ key: 'r', modifiers: ['shift', 'meta'] })
    expect(chord('meta+/')).toEqual({ key: '/', modifiers: ['meta'] })
    expect(chord('Enter')).toEqual({ key: 'Enter', modifiers: [] })
  })
})

describe('formatChord', () => {
  it('prints macOS glyphs then the key', () => {
    expect(formatChord(chord('shift+meta+r'))).toBe('⇧⌘R')
    expect(formatChord(chord('ctrl+alt+m'))).toBe('⌃⌥M')
    expect(formatChord(chord('meta+Enter'))).toBe('⌘↩')
    expect(formatChord(chord('Escape'))).toBe('esc')
    expect(formatChord(chord('ArrowUp'))).toBe('↑')
    expect(formatChord(chord('Tab'))).toBe('Tab')
  })

  it('joins several chords with a middle dot', () => {
    expect(formatChords([chord('meta+z'), chord('shift+meta+z')])).toBe('⌘Z · ⇧⌘Z')
  })
})

describe('matchesChord', () => {
  it('requires every listed modifier and no other', () => {
    const target = chord('shift+meta+r')
    expect(matchesChord(key({ key: 'R', shiftKey: true, metaKey: true }), target)).toBe(true)
    expect(matchesChord(key({ key: 'r', metaKey: true }), target)).toBe(false)
    expect(matchesChord(key({ key: 'r', shiftKey: true, metaKey: true, altKey: true }), target)).toBe(false)
    expect(matchesChord(key({ key: 'x', shiftKey: true, metaKey: true }), target)).toBe(false)
  })
})

describe('isAppChord', () => {
  it('takes ⌘ and ⌃ chords anywhere, and every other chord only away from a text field', () => {
    expect(isAppChord(key({ key: '/', metaKey: true }), true)).toBe(true)
    expect(isAppChord(key({ key: 'r', ctrlKey: true }), true)).toBe(true)
    // ⇧↑ inside a textarea extends the selection, so the app leaves it alone.
    expect(isAppChord(key({ key: 'ArrowUp', shiftKey: true }), true)).toBe(false)
    expect(isAppChord(key({ key: 'ArrowUp', shiftKey: true }), false)).toBe(true)
  })
})

describe('KeybindRegistry', () => {
  it('groups rows in first-seen group order and sorts by order inside', () => {
    const registry = new KeybindRegistry()
    registry.register({ id: 'b', group: 'app', label: 'B', chords: [chord('meta+b')], order: 2 })
    registry.register({ id: 'c', group: 'chats', label: 'C', chords: [chord('meta+c')] })
    registry.register({ id: 'a', group: 'app', label: 'A', chords: [chord('meta+a')], order: 1 })
    expect(registry.list().map(group => [group.group, group.items.map(item => item.id)])).toEqual([
      ['app', ['a', 'b']],
      ['chats', ['c']],
    ])
  })

  it('dispatches the first runnable match and skips listed-only rows', () => {
    const registry = new KeybindRegistry()
    const run = vi.fn()
    registry.register({ id: 'listed', group: 'g', label: 'L', chords: [chord('meta+k')] })
    registry.register({ id: 'runs', group: 'g', label: 'R', chords: [chord('meta+k'), chord('meta+j')], run })
    expect(registry.dispatch(key({ key: 'k', metaKey: true }))).toBe(true)
    expect(registry.dispatch(key({ key: 'j', metaKey: true }))).toBe(true)
    expect(registry.dispatch(key({ key: 'q', metaKey: true }))).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('replaces by id, notifies subscribers, and a stale disposer leaves the replacement', () => {
    const registry = new KeybindRegistry()
    const listener = vi.fn()
    const off = registry.subscribe(listener)
    const first = { id: 'x', group: 'g', label: 'one', chords: [chord('meta+1')] }
    const disposeFirst = registry.register(first)
    registry.register({ id: 'x', group: 'g', label: 'two', chords: [chord('meta+2')] })
    disposeFirst()
    expect(registry.list()[0]?.items[0]?.label).toBe('two')
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    registry.register({ id: 'y', group: 'g', label: 'Y', chords: [chord('meta+y')] })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('removes a row through its own disposer', () => {
    const registry = new KeybindRegistry()
    const dispose = registry.register({ id: 'x', group: 'g', label: 'X', chords: [chord('meta+x')] })
    dispose()
    expect(registry.list()).toEqual([])
  })
})

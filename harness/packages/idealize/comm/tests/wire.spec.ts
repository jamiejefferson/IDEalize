import { describe, expect, it } from 'vitest'
import { chatNameFromTask, clockTime, Wire } from '../src/wire.ts'

describe('Wire', () => {
  it('clamps a long body at the cap and appends the truncation note', () => {
    const { text, truncated } = Wire.clamp('x'.repeat(900))
    expect(truncated).toBe(true)
    expect(text.startsWith('x'.repeat(800))).toBe(true)
    expect(text.endsWith(Wire.truncationNote)).toBe(true)
    expect(Wire.clamp('short')).toEqual({ text: 'short', truncated: false })
  })

  it('flattens a note to one line and cuts on a word boundary', () => {
    expect(Wire.clampNote('one\n\n  two  \nthree')).toBe('one two three')
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const clamped = Wire.clampNote(long)
    expect(clamped.endsWith('…')).toBe(true)
    expect(clamped.length).toBeLessThanOrEqual(Wire.maxNoteCharacters + 1)
    expect(clamped.slice(0, -1).endsWith(' ')).toBe(false)
  })

  it('normalises rung spelling', () => {
    expect(Wire.normalise(' Being Made ')).toBe('being-made')
  })

  it('generates the one status line', () => {
    expect(Wire.statusLine({ project: 'app', piece: 'hero', rung: 'saved', blocker: 'none', session: 't-1', note: 'ready' }))
      .toBe('[app] hero → saved (t-1) — blocker: none — ready')
    expect(Wire.statusLine({ piece: 'hero', rung: 'saved', blocker: 'stuck' })).toBe('hero → saved — blocker: stuck')
  })
})

describe('chatNameFromTask', () => {
  it('reads the first line, strips decoration, and sentence-cases', () => {
    expect(chatNameFromTask('\n# build the hero section. Then the nav.\nmore')).toBe('Build the hero section')
  })

  it('keeps a short sentence whole when the head would be a stub', () => {
    expect(chatNameFromTask('Fix it. Properly this time')).toBe('Fix it. Properly this time')
  })

  it('caps at 32 characters on a word boundary', () => {
    const name = chatNameFromTask('rebuild the whole onboarding flow with the new tokens and copy')
    expect(name).toBe('Rebuild the whole onboarding…')
  })

  it('leaves a deliberately styled opener alone and answers undefined for a blank brief', () => {
    expect(chatNameFromTask('iOS share sheet')).toBe('iOS share sheet')
    expect(chatNameFromTask('  \n ')).toBeUndefined()
  })

  it('cuts a note with no word boundary at the cap itself', () => {
    const solid = 'x'.repeat(Wire.maxNoteCharacters + 20)
    expect(Wire.clampNote(solid)).toBe(`${'x'.repeat(Wire.maxNoteCharacters)}…`)
  })
})

describe('chatNameFromTask', () => {
  it('answers nothing for a task that is only punctuation', () => {
    expect(chatNameFromTask('   ---   ')).toBeUndefined()
  })

  it('cuts a long single word at the limit rather than at an early space', () => {
    const name = chatNameFromTask(`a ${'b'.repeat(80)}`)
    expect(name?.endsWith('…')).toBe(true)
    expect(name?.startsWith('A b')).toBe(true)
  })
})

describe('clockTime', () => {
  it('prints a mailbox timestamp as the CLI does', () => {
    const at = new Date(2026, 8, 10, 9, 5, 3)
    expect(clockTime(at.toISOString())).toBe('09:05:03')
  })
})

/**
 * `POST /idealize/activity/agent`'s `spaces` field, at the wire boundary that
 * decides it: which spaces a brain works in is a durable, user-facing placement,
 * so an unknown id is refused rather than stored, and an absent field leaves the
 * stored placement alone — otherwise saving a name or a model would quietly move
 * a brain out of its group.
 */
import { describe, expect, it } from 'vitest'
import { parseSpaces } from '../src/index.ts'

describe('parseSpaces', () => {
  it('reads an absent field as "say nothing about spaces"', () => {
    expect(parseSpaces(undefined)).toEqual({ ok: true })
    expect(parseSpaces(null)).toEqual({ ok: true })
  })

  it('distinguishes the empty list, which is an agent role, from an absent field', () => {
    expect(parseSpaces([])).toEqual({ ok: true, spaces: [] })
  })

  it('normalizes an accepted list to the declared table order', () => {
    expect(parseSpaces(['terminal', 'chat'])).toEqual({ ok: true, spaces: ['chat', 'terminal'] })
    expect(parseSpaces(['motion', 'gallery', 'soundstage']))
      .toEqual({ ok: true, spaces: ['gallery', 'soundstage', 'motion'] })
  })

  it('drops a repeated id rather than storing a space twice', () => {
    expect(parseSpaces(['chat', 'chat'])).toEqual({ ok: true, spaces: ['chat'] })
  })

  it('refuses anything that is not a list of declared space ids', () => {
    expect(parseSpaces(['nope'])).toEqual({ ok: false })
    expect(parseSpaces(['studio'])).toEqual({ ok: false })
    expect(parseSpaces('chat')).toEqual({ ok: false })
    expect(parseSpaces({ chat: true })).toEqual({ ok: false })
    expect(parseSpaces(['chat', 42])).toEqual({ ok: false })
  })
})

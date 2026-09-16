// Generated kaomoji portraits: deterministic per (project, name), well-formed
// faces, and a seed that includes the project so name reuse across projects
// still differs somewhere in the space.
import { describe, expect, it } from 'vitest'
import { portraitOf } from '../src/portrait.ts'

const FACE = /^[[({<][^\s]_?.?[^\s][\])}>]$/u

describe('portraitOf', () => {
  it('renders the same face and colours for the same agent, always', () => {
    const first = portraitOf('/work/demo', 'Juno')
    const again = portraitOf('/work/demo', 'Juno')
    expect(again).toEqual(first)
  })

  it('renders a well-formed bracketed face for every name in a pool-sized sample', () => {
    for (let index = 0; index < 200; index += 1) {
      const portrait = portraitOf('/work/demo', `Agent ${index}`)
      expect(portrait.face.length).toBe(5)
      expect(portrait.face).toMatch(FACE)
      expect(portrait.fill).toMatch(/^#[0-9A-F]{6}$/)
      expect(portrait.border).toMatch(/^#[0-9A-F]{6}$/)
      expect(portrait.ink).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('varies faces across names', () => {
    const faces = new Set(Array.from({ length: 50 }, (_, index) => portraitOf('/work/demo', `Agent ${index}`).face))
    expect(faces.size).toBeGreaterThan(10)
  })

  it('seeds on the project too, so the same name can differ across projects', () => {
    const here = Array.from({ length: 20 }, (_, index) => portraitOf('/work/a', `Agent ${index}`).face).join('|')
    const there = Array.from({ length: 20 }, (_, index) => portraitOf('/work/b', `Agent ${index}`).face).join('|')
    expect(here).not.toBe(there)
  })
})

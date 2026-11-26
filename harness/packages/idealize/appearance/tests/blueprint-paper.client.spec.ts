/** The blueprint themes' paper: the dials' bounds, per-theme adjustments, and the CSS the terminal view draws. */
import { describe, expect, it } from 'vitest'
import { requireHex } from '../src/colour.ts'
import { PAPER_COLOURS, PAPER_RANGES, PAPER_SWITCHES, paperColour, paperGrounds, paperPaint, tweakedPaper, withPaperTweak, type ThemePaper } from '../src/blueprint-paper.ts'

const PAPER: ThemePaper = {
  lightX: 20, lightY: 28, light: 11, shade: 14, grain: 9, grainScale: 540, crease: false,
  grid: true, gridColour: '#EAF4FF', secondary: '#B4CFE8', warning: '#FF9494', gridMinor: 5, gridMinorOpacity: 5, gridMajorEvery: 10, gridMajorOpacity: 8, gridSoften: 0.7,
  inkOpacity: 69, halo: 47, haloSpread: 1.25, shadow: 5, shadowOffset: 4, shadowBlur: 4, blocks: 100, blockColour: '#0056B3',
}
const BLUE = requireHex('#0056B3')

describe('paper dials', () => {
  it('bounds every number dial, keeps the grid faint and the ink in sight, and names the two switches', () => {
    for (const range of Object.values(PAPER_RANGES)) {
      expect(range.min).toBeLessThan(range.max)
      expect(range.step).toBeGreaterThan(0)
    }
    expect(PAPER_RANGES.gridMinorOpacity.max).toBe(20)
    expect(PAPER_RANGES.gridMajorOpacity.max).toBe(20)
    expect(PAPER_RANGES.inkOpacity.min).toBe(40)
    expect(PAPER_SWITCHES).toEqual(['crease', 'grid'])
    // Every paper field is a number dial, a switch, or one of the four colours the paper itself holds.
    expect(Object.keys(PAPER_RANGES).length + PAPER_SWITCHES.length).toBe(Object.keys(PAPER).length - 4)
    expect(PAPER_COLOURS).toEqual(['ground', 'header', 'blockColour', 'ink', 'secondary', 'accent', 'warning', 'gridColour'])
  })
})

describe('tweakedPaper and withPaperTweak', () => {
  it('layers only the moved dials over the theme', () => {
    expect(tweakedPaper(PAPER, undefined)).toEqual(PAPER)
    expect(tweakedPaper(PAPER, { grain: 30, grid: false })).toEqual({ ...PAPER, grain: 30, grid: false })
  })

  it('takes the paper\'s own four colours when they parse, and leaves the theme\'s colours to the paint', () => {
    const drawn = tweakedPaper(PAPER, { gridColour: '#112233', secondary: 'aabbcc', warning: 'nope', ground: '#000000', header: '#111111', blockColour: '#444444', ink: '#222222', accent: '#333333' })
    expect(drawn).toEqual({ ...PAPER, gridColour: '#112233', secondary: '#AABBCC', blockColour: '#444444' })
    expect(paperColour(undefined, '#ABCDEF')).toBe('#ABCDEF')
    expect(paperColour('', '#ABCDEF')).toBe('#ABCDEF')
    expect(paperColour('#abcdef', '#000000')).toBe('#ABCDEF')
  })

  it('keeps adjustments per theme, drops one set back to the theme value, and drops a theme left with none', () => {
    const first = withPaperTweak({}, 'a', 'grain', 30, PAPER.grain)
    expect(first).toEqual({ a: { grain: 30 } })
    const second = withPaperTweak(first, 'a', 'grid', false, PAPER.grid)
    expect(second).toEqual({ a: { grain: 30, grid: false } })
    const other = withPaperTweak(second, 'b', 'halo', 0, PAPER.halo)
    expect(other).toEqual({ a: { grain: 30, grid: false }, b: { halo: 0 } })
    expect(withPaperTweak(other, 'a', 'grain', 9, PAPER.grain)).toEqual({ a: { grid: false }, b: { halo: 0 } })
    expect(withPaperTweak({ a: { grain: 30 } }, 'a', 'grain', 9, PAPER.grain)).toEqual({})
    // A colour is stored when it differs from the theme's, and cleared by an empty field or the theme's own value.
    const inked = withPaperTweak({}, 'a', 'ink', '#112233', '#EAF4FF')
    expect(inked).toEqual({ a: { ink: '#112233' } })
    expect(withPaperTweak(inked, 'a', 'ink', '', '#EAF4FF')).toEqual({})
    expect(withPaperTweak(inked, 'a', 'ink', '#EAF4FF', '#EAF4FF')).toEqual({})
    // The input is never mutated.
    expect(first).toEqual({ a: { grain: 30 } })
  })
})

describe('paperGrounds', () => {
  it('gives the lit and shaded extremes of the ground', () => {
    const [lit, shaded] = paperGrounds(PAPER, BLUE)
    expect(lit!.r + lit!.g + lit!.b).toBeGreaterThan(BLUE.r + BLUE.g + BLUE.b)
    expect(shaded!.r + shaded!.g + shaded!.b).toBeLessThan(BLUE.r + BLUE.g + BLUE.b)
    expect(paperGrounds({ ...PAPER, light: 0, shade: 0 }, BLUE)).toEqual([BLUE, BLUE])
  })
})

describe('paperPaint', () => {
  it('writes the tuning page\'s ground, grid, grain and ink for the settled Cyanotype', () => {
    const paint = paperPaint(PAPER, BLUE)
    expect(paint.ground).toBe(
      'radial-gradient(farthest-corner at 20% 28% in oklab, color-mix(in oklab, #fff 11%, #0056B3) 0%, #0056B3 45%, color-mix(in oklab, #000 14%, #0056B3) 100%)',
    )
    expect(paint.grain).toEqual({ opacity: 0.09, size: 540 })
    expect(paint.crease).toBe(false)
    expect(paint.grid?.size).toBe('50px 50px, 50px 50px, 5px 5px, 5px 5px')
    expect(paint.grid?.blur).toBe(0.7)
    expect(paint.grid?.image.match(/linear-gradient/g)).toHaveLength(4)
    expect(paint.grid?.image).toContain('color-mix(in srgb, #EAF4FF 8%, transparent) 0 1px')
    expect(paint.grid?.image).toContain('to bottom, color-mix(in srgb, #EAF4FF 5%, transparent) 0 1px')
    expect(paint.inkOpacity).toBe(0.69)
    // The row is drawn at 69%, so 47% and 5% are written as 68.12% and 7.25% to land where they were tuned.
    expect(paint.textShadow).toBe('0 0 1.25px color-mix(in srgb, currentColor 68.12%, transparent), 0 4px 4px rgb(0 0 0 / 7.25%)')
  })

  it('gives the header strip its colour under the same grid, measured up from its bottom edge', () => {
    // The ground when no header colour is set.
    expect(paperPaint({ ...PAPER, grid: false }, BLUE).header).toBe('#0056B3')
    expect(paperPaint({ ...PAPER, grid: false }, BLUE, '#102030').header).toBe('#102030')
    const strip = paperPaint(PAPER, BLUE, '#102030').header
    expect(strip.match(/linear-gradient/g)).toHaveLength(4)
    expect(strip.match(/ 0 100% \/ 50px 50px/g)).toHaveLength(2)
    expect(strip.match(/ 0 100% \/ 5px 5px/g)).toHaveLength(2)
    expect(strip.endsWith(', #102030')).toBe(true)
  })

  it('leaves out each layer at zero or off, and keeps halo and shadow independent', () => {
    const bare = paperPaint({ ...PAPER, grain: 0, grid: false, halo: 0, shadow: 0, crease: true }, BLUE)
    expect(bare.grain).toBeUndefined()
    expect(bare.grid).toBeUndefined()
    expect(bare.crease).toBe(true)
    expect(bare.textShadow).toBe('none')
    expect(paperPaint({ ...PAPER, shadow: 0 }, BLUE).textShadow).toBe('0 0 1.25px color-mix(in srgb, currentColor 68.12%, transparent)')
    expect(paperPaint({ ...PAPER, halo: 0 }, BLUE).textShadow).toBe('0 4px 4px rgb(0 0 0 / 7.25%)')
    // Blocks at full strength get no wash; below it the paper covers the rest.
    expect(paperPaint(PAPER, BLUE).blockCover).toBeUndefined()
    expect(paperPaint({ ...PAPER, blocks: 40 }, BLUE).blockCover).toBe(
      'linear-gradient(color-mix(in srgb, #0056B3 60%, transparent), color-mix(in srgb, #0056B3 60%, transparent))',
    )
    // A block colour replaces the paper in the wash; at zero the block is that colour alone.
    expect(paperPaint({ ...PAPER, blocks: 0, blockColour: '#102030' }, BLUE).blockCover).toBe(
      'linear-gradient(color-mix(in srgb, #102030 100%, transparent), color-mix(in srgb, #102030 100%, transparent))',
    )
    // A strength the row's opacity would push past full stops at full.
    expect(paperPaint({ ...PAPER, halo: 90, shadow: 0, inkOpacity: 50 }, BLUE).textShadow).toContain('currentColor 100%')
  })
})

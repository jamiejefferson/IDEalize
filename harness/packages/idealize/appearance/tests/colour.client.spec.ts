/** Colour arithmetic and the deepen-along-hue readability rule. */
import { describe, expect, it } from 'vitest'
import {
  blend, contrast, deepenAlongHue, fromHsl, isDark, parseHex, requireHex, TEXT_CONTRAST, toHex, toHsl, toRgba, UI_CONTRAST,
} from '../src/colour.ts'

describe('hex parsing', () => {
  it('accepts #RRGGBB, bare RRGGBB, any case, surrounding whitespace', () => {
    expect(parseHex('#0969DA')).toEqual({ r: 9, g: 105, b: 218 })
    expect(parseHex('0969da')).toEqual({ r: 9, g: 105, b: 218 })
    expect(parseHex('  #0969da ')).toEqual({ r: 9, g: 105, b: 218 })
  })

  it('rejects empty, short, and non-hex strings', () => {
    expect(parseHex('')).toBeUndefined()
    expect(parseHex('#FFF')).toBeUndefined()
    expect(parseHex('#GGGGGG')).toBeUndefined()
    expect(parseHex('red')).toBeUndefined()
  })

  it('round-trips through toHex and formats rgba', () => {
    expect(toHex(parseHex('#85c1b4')!)).toBe('#85C1B4')
    expect(toHex({ r: 300, g: -4, b: 12.6 })).toBe('#FF000D')
    expect(toRgba({ r: 36, g: 41, b: 47 }, 0.5)).toBe('rgba(36, 41, 47, 0.5)')
  })
})

describe('contrast and blends', () => {
  it('matches WCAG reference ratios', () => {
    const black = { r: 0, g: 0, b: 0 }
    const white = { r: 255, g: 255, b: 255 }
    expect(contrast(black, white)).toBeCloseTo(21, 5)
    expect(contrast(white, white)).toBeCloseTo(1, 5)
    // #777777 on white is the classic 4.48:1 near-miss.
    expect(contrast(parseHex('#777777')!, white)).toBeCloseTo(4.48, 2)
  })

  it('blends linearly in sRGB (V0 Theme.blend)', () => {
    const a = { r: 0, g: 0, b: 0 }
    const b = { r: 255, g: 255, b: 255 }
    expect(blend(a, b, 0)).toEqual(a)
    expect(blend(a, b, 1)).toEqual(b)
    expect(blend(a, b, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 })
  })

  it('classifies grounds by perceived luma (V0 Theme.isDark)', () => {
    expect(isDark(parseHex('#2A2F35')!)).toBe(true)
    expect(isDark(parseHex('#F5F5F6')!)).toBe(false)
    expect(isDark(parseHex('#17181A')!)).toBe(true)
    expect(isDark(parseHex('#F7F5F0')!)).toBe(false)
  })
})

describe('deepenAlongHue', () => {
  const white = parseHex('#FFFFFF')!
  const nearBlack = parseHex('#17181A')!

  it('returns the colour unchanged when it already reads', () => {
    const blue = parseHex('#0969DA')!
    expect(deepenAlongHue(blue, white, UI_CONTRAST)).toBe(blue)
  })

  it('keeps hue and saturation while lowering lightness on a light ground', () => {
    const candy = parseHex('#FF8AD8')!
    const before = toHsl(candy)
    const after = toHsl(deepenAlongHue(candy, white, TEXT_CONTRAST))
    expect(contrast(deepenAlongHue(candy, white, TEXT_CONTRAST), white)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    expect(after.h).toBeCloseTo(before.h, 0)
    expect(after.s).toBeCloseTo(before.s, 1)
    expect(after.l).toBeLessThan(before.l)
  })

  it('raises lightness on a dark ground, never desaturating', () => {
    const navy = parseHex('#1F2A60')!
    const before = toHsl(navy)
    const result = deepenAlongHue(navy, nearBlack, UI_CONTRAST)
    const after = toHsl(result)
    expect(contrast(result, nearBlack)).toBeGreaterThanOrEqual(UI_CONTRAST)
    expect(after.h).toBeCloseTo(before.h, 0)
    expect(after.s).toBeCloseTo(before.s, 1)
    expect(after.l).toBeGreaterThan(before.l)
  })

  it('stops at the hue extreme when even that cannot reach the target', () => {
    // Pure yellow at full saturation never reaches 21:1 on white; the walk
    // ends at black along the same hue.
    const result = deepenAlongHue(parseHex('#FFFF00')!, white, 21)
    expect(toHex(result)).toBe('#000000')
    const lifted = deepenAlongHue(parseHex('#202020')!, parseHex('#000000')!, 21)
    expect(toHex(lifted)).toBe('#FFFFFF')
  })
})

describe('requireHex and the HSL sextants', () => {
  it('throws on a bad hex and round-trips every hue sextant', () => {
    expect(() => requireHex('nope')).toThrow(/not a #RRGGBB colour/)
    for (const hex of ['#FF3300', '#99FF00', '#00FF66', '#00CCFF', '#3300FF', '#FF00CC', '#00FF00', '#0000FF']) {
      expect(toHex(fromHsl(toHsl(requireHex(hex))))).toBe(hex)
    }
  })
})

describe('deepenAlongHue at the limit', () => {
  it('lands on pure black or white when no lightness reaches the target', () => {
    const grey = { r: 128, g: 128, b: 128 }
    expect(deepenAlongHue(grey, grey, 22)).toEqual({ r: 0, g: 0, b: 0 })
    expect(deepenAlongHue(grey, { r: 0, g: 0, b: 0 }, 22)).toEqual({ r: 255, g: 255, b: 255 })
  })
})

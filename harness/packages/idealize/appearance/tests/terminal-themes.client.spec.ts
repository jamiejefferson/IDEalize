/** The V0 terminal theme port and the settings → paint resolution. */
import { describe, expect, it } from 'vitest'
import { TERMINAL_DEFAULTS, TERMINAL_THEME_IDS, terminalCustomised, type TerminalThemeId } from '../src/appearance-settings.ts'
import { presetPalette } from '../src/presets.ts'
import { contrast, requireHex, UI_CONTRAST } from '../src/colour.ts'
import {
  legibleSelection, resolveTerminalPaint, SELECTION_CONTRAST, SELECTION_TEXT_CONTRAST, TERMINAL_THEMES, terminalFontStack, terminalTheme,
} from '../src/terminal-themes.ts'

describe('TERMINAL_THEMES', () => {
  it('carries the six V0 themes in panel order, then the Classic pair, 16 ANSI colours each', () => {
    expect(TERMINAL_THEMES.map(theme => theme.id)).toEqual([...TERMINAL_THEME_IDS])
    expect(TERMINAL_THEMES.map(theme => theme.name)).toEqual(['Linen', 'Ink', 'Y2K', 'IDEalize Dark', 'IDEalize Light', 'Solarized Dark', 'Classic Dark', 'Classic Light'])
    for (const theme of TERMINAL_THEMES) {
      expect(theme.ansi).toHaveLength(16)
      for (const value of [theme.background, theme.foreground, theme.cursor, theme.selection, ...theme.ansi, ...(theme.wash ?? [])]) {
        expect(value).toMatch(/^#[0-9A-F]{6}$/)
      }
    }
  })

  it('ports the Linen values verbatim (Theme.swift rgb → hex)', () => {
    const linen = terminalTheme('linen')
    expect(linen.background).toBe('#F7F5F0')
    expect(linen.foreground).toBe('#2A2A27')
    expect(linen.cursor).toBe('#B67A12')
    expect(linen.selection).toBe('#E7E0D1')
    expect(linen.ansi[7]).toBe('#64625A')
    expect(terminalTheme('solarized-dark').background).toBe('#002B36')
    expect(terminalTheme('y2k').cursor).toBe('#FF74E7')
  })

  it('gives the Classic pair the OG preset\'s grounds and inks, every ANSI colour readable on its ground', () => {
    expect(terminalTheme('classic-dark')).toMatchObject({ background: presetPalette('og', 'dark').ground, foreground: presetPalette('og', 'dark').ink })
    expect(terminalTheme('classic-light')).toMatchObject({ background: presetPalette('og', 'light').ground, foreground: presetPalette('og', 'light').ink })
    for (const id of ['classic-dark', 'classic-light'] as const) {
      const theme = terminalTheme(id)
      const ground = requireHex(theme.background)
      expect(contrast(requireHex(theme.foreground), ground)).toBeGreaterThanOrEqual(4.5)
      // Slot 0 on the dark ground and slot 15 on the light one are the ground's own end of the palette.
      const readable = theme.ansi.filter((_, index) => index !== (id === 'classic-dark' ? 0 : 15))
      for (const colour of readable) expect(contrast(requireHex(colour), ground)).toBeGreaterThanOrEqual(UI_CONTRAST)
    }
  })
})

/** The two ratios the selection rule holds: off the nearest ground stop, and the better of ink and ground on the highlight. */
function selectionRatios(id: TerminalThemeId, selection: string): { ground: number; text: number } {
  const theme = terminalTheme(id)
  const highlight = requireHex(selection)
  const grounds = [...(theme.wash ?? []), theme.background].map(requireHex)
  const round = (value: number): number => Math.round(value * 100) / 100
  return {
    ground: round(Math.min(...grounds.map(ground => contrast(highlight, ground)))),
    text: round(Math.max(contrast(requireHex(theme.foreground), highlight), contrast(requireHex(theme.background), highlight))),
  }
}

describe('legibleSelection', () => {
  it('clears both floors on every theme; the table records each ratio before and after', () => {
    const audit = TERMINAL_THEMES.map((theme) => {
      const paint = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: theme.id })
      const after = selectionRatios(theme.id, paint.selection)
      expect(after.ground).toBeGreaterThanOrEqual(SELECTION_CONTRAST)
      expect(after.text).toBeGreaterThanOrEqual(SELECTION_TEXT_CONTRAST)
      const before = selectionRatios(theme.id, theme.selection)
      return { id: theme.id, placed: theme.selection, before, painted: paint.selection, after, text: paint.selectionForeground }
    })
    expect(audit).toEqual([
      { id: 'linen', placed: '#E7E0D1', before: { ground: 1.21, text: 10.95 }, painted: '#CFC9BC', after: { ground: 1.51, text: 8.73 }, text: '#2A2A27' },
      { id: 'ink', placed: '#2E2F33', before: { ground: 1.33, text: 10.81 }, painted: '#37383C', after: { ground: 1.52, text: 9.46 }, text: '#E6E7E9' },
      // Feedback 37ff6651: 1.09:1 against the wash, so a selection could not be seen.
      { id: 'y2k', placed: '#AFCAB9', before: { ground: 1.09, text: 3.83 }, painted: '#4D6C6B', after: { ground: 2.56, text: 3 }, text: '#DBACE3' },
      { id: 'idealize-dark', placed: '#444E58', before: { ground: 1.46, text: 6.17 }, painted: '#47505A', after: { ground: 1.51, text: 5.96 }, text: '#D5DDE3' },
      { id: 'idealize-light', placed: '#CCE4FF', before: { ground: 1.3, text: 11.24 }, painted: '#BFD5EE', after: { ground: 1.5, text: 9.75 }, text: '#24292F' },
      { id: 'solarized-dark', placed: '#073642', before: { ground: 1.15, text: 4.11 }, painted: '#1E4851', after: { ground: 1.5, text: 3.16 }, text: '#839496' },
      { id: 'classic-dark', placed: '#3A3D44', before: { ground: 1.55, text: 8.95 }, painted: '#3A3D44', after: { ground: 1.55, text: 8.95 }, text: '#E8E9EB' },
      { id: 'classic-light', placed: '#ADD6FF', before: { ground: 1.52, text: 10.41 }, painted: '#ADD6FF', after: { ground: 1.52, text: 10.41 }, text: '#1F2328' },
    ])
  })

  it('walks toward the theme\'s own black slot, and writes the ground on a highlight the ink cannot read on', () => {
    const y2k = terminalTheme('y2k')
    const paint = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'y2k' })
    const [placed, slot, painted] = [y2k.selection, y2k.ansi[0] ?? '', paint.selection].map(requireHex)
    // Every channel sits between the placed colour and ANSI 0: a mix of two colours the theme owns.
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(painted?.[channel]).toBeLessThanOrEqual(placed?.[channel] ?? 0)
      expect(painted?.[channel]).toBeGreaterThanOrEqual(slot?.[channel] ?? 255)
    }
    expect(paint.selectionForeground).toBe(y2k.background)
  })

  it('continues to pure black or white when the palette slot cannot reach, and ends on the extreme when nothing can', () => {
    const white = { r: 255, g: 255, b: 255 }
    const mid = { r: 119, g: 119, b: 119 }
    // A palette whose "black" slot is the ground itself: the walk toward it never separates.
    const reached = legibleSelection(white, { grounds: [white], foreground: mid, background: white, ansi: ['#FFFFFF'] })
    expect(contrast(reached.selection, white)).toBeGreaterThanOrEqual(SELECTION_CONTRAST)
    // No ANSI table at all falls straight to the pure extreme's walk.
    expect(legibleSelection(white, { grounds: [white], foreground: mid, background: white, ansi: [] }).selection).toEqual(reached.selection)
    // Grounds at both ends of the range leave no colour that clears them all.
    const black = { r: 0, g: 0, b: 0 }
    const stuck = legibleSelection(mid, { grounds: [black, white, mid], foreground: mid, background: mid, ansi: [] })
    expect([black, white]).toContainEqual(stuck.selection)
  })
})

describe('resolveTerminalPaint', () => {
  it('resolves the defaults to Linen with V0 type defaults', () => {
    const paint = resolveTerminalPaint()
    expect(paint.background).toBe('#F7F5F0')
    expect(paint.fontFamily).toMatch(/^"DM Mono", ui-monospace/)
    expect(paint.fontSize).toBe(14)
    expect(paint.lineHeight).toBe(1)
    expect(paint.margin).toBe(36)
  })

  it('layers a custom background over any theme and re-derives the selection from it', () => {
    const paint = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'ink', bgHex: '#102030' })
    expect(paint.background).toBe('#102030')
    // V0 withBackground: selection = blend(bg, fg, 0.14) = #2E3C4A, which stands 1.46:1 off this ground, so
    // it takes two steps toward Ink's bright white; ink, cursor and palette stay.
    expect(paint.selection).toBe('#303E4C')
    expect(paint.selectionForeground).toBe('#E6E7E9')
    // A custom ground is a solid: Y2K's wash no longer counts, and its re-derived selection is deepened against the new ground alone.
    const y2k = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'y2k', bgHex: '#FFFFFF' })
    expect(contrast(requireHex(y2k.selection), requireHex('#FFFFFF'))).toBeGreaterThanOrEqual(SELECTION_CONTRAST)
    expect(paint.foreground).toBe('#E6E7E9')
    expect(paint.cursor).toBe('#E8B84B')
    expect(paint.ansi).toBe(terminalTheme('ink').ansi)
    // An unparsable custom ground keeps the theme's own.
    expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, bgHex: 'bad' }).background).toBe('#F7F5F0')
  })

  it('quotes the family over the monospace stack; empty means the bare stack', () => {
    expect(terminalFontStack('SF Mono')).toBe('"SF Mono", ui-monospace, \'SF Mono\', Menlo, Consolas, monospace')
    expect(terminalFontStack('  ')).toBe('ui-monospace, \'SF Mono\', Menlo, Consolas, monospace')
  })
})

describe('terminalCustomised', () => {
  it('ignores the theme choice and notices any layered value', () => {
    expect(terminalCustomised(TERMINAL_DEFAULTS)).toBe(false)
    expect(terminalCustomised({ ...TERMINAL_DEFAULTS, theme: 'y2k' })).toBe(false)
    expect(terminalCustomised({ ...TERMINAL_DEFAULTS, fontSize: 16 })).toBe(true)
    expect(terminalCustomised({ ...TERMINAL_DEFAULTS, bgHex: '#000000' })).toBe(true)
  })
})

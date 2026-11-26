/** The V0 terminal theme port and the settings → paint resolution. */
import { describe, expect, it } from 'vitest'
import { AppearanceSettingsSchema, APPEARANCE_DEFAULTS, TERMINAL_DEFAULTS, TERMINAL_THEME_IDS, terminalCustomised, type TerminalThemeId } from '../src/appearance-settings.ts'
import { paperGrounds, paperPaint } from '../src/blueprint-paper.ts'
import { presetPalette } from '../src/presets.ts'
import { contrast, requireHex, UI_CONTRAST } from '../src/colour.ts'
import {
  legibleSelection, resolveTerminalPaint, SELECTION_CONTRAST, SELECTION_TEXT_CONTRAST, TERMINAL_THEMES, terminalFontStack, terminalTheme,
} from '../src/terminal-themes.ts'

describe('TERMINAL_THEMES', () => {
  it('carries the six V0 themes in panel order, then the Classic pair and the three blueprint papers, 16 ANSI colours each', () => {
    expect(TERMINAL_THEMES.map(theme => theme.id)).toEqual([...TERMINAL_THEME_IDS])
    expect(TERMINAL_THEMES.map(theme => theme.name)).toEqual(['Linen', 'Ink', 'Y2K', 'IDEalize Dark', 'IDEalize Light', 'Solarized Dark', 'Classic Dark', 'Classic Light', 'Cyanotype', 'Velum', 'Carbon'])
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

describe('blueprint themes', () => {
  const ids = ['blueprint-cyanotype', 'blueprint-velum', 'blueprint-carbon'] as const

  it('carry JJ\'s settled grounds, inks and papers (tuned in the app, 25 Nov 2026), and only they carry a paper', () => {
    expect(TERMINAL_THEMES.filter(theme => theme.paper !== undefined).map(theme => theme.id)).toEqual([...ids])
    expect(terminalTheme('blueprint-cyanotype')).toMatchObject({ background: '#00438A', foreground: '#E3EAF2', cursor: '#FFFFFF' })
    expect(terminalTheme('blueprint-cyanotype').paper).toMatchObject({ lightX: 20, lightY: 28, light: 4, shade: 25, grain: 9, grainScale: 540, gridMinor: 5, gridMinorOpacity: 8.5, gridSoften: 0.9, secondary: '#FFFFFF', warning: '#FFB8B8', inkOpacity: 60, halo: 47, haloSpread: 1.25, shadow: 28, shadowOffset: 0, blocks: 61, blockColour: '#00458F' })
    expect(terminalTheme('blueprint-velum')).toMatchObject({ background: '#EFEDE7', foreground: '#200F5C', cursor: '#A809C8' })
    expect(terminalTheme('blueprint-velum').paper).toMatchObject({ lightX: 42, lightY: 48, light: 45, shade: 9, grain: 16, grainScale: 200, gridColour: '#21163C', inkOpacity: 88, halo: 21, haloSpread: 3.5, shadow: 11, shadowOffset: 4, shadowBlur: 3.5, blocks: 32, blockColour: '#EAE9E3' })
    expect(terminalTheme('blueprint-carbon')).toMatchObject({ background: '#272B32', foreground: '#D3D8E1', cursor: '#4FB3D0' })
    expect(terminalTheme('blueprint-carbon').paper).toMatchObject({ lightX: 31, lightY: 40, light: 8, shade: 43, grain: 5, grainScale: 600, gridColour: '#FFFFFF', gridMinorOpacity: 5, gridMajorOpacity: 4.5, gridSoften: 0, inkOpacity: 86, halo: 12, shadow: 23, shadowBlur: 4, blocks: 0, blockColour: '#424D61' })
    // The tuned warning ink is red and the accent is cyan (magenta on Velum, where the accent is purple).
    // Cyanotype's accent and secondary ink are both white, in cyan and bright black.
    expect(terminalTheme('blueprint-cyanotype').ansi[1]).toBe('#FFB8B8')
    expect(terminalTheme('blueprint-cyanotype').ansi[6]).toBe('#FFFFFF')
    expect(terminalTheme('blueprint-cyanotype').ansi[8]).toBe('#FFFFFF')
    expect(terminalTheme('blueprint-velum').ansi[1]).toBe('#D10000')
    expect(terminalTheme('blueprint-velum').ansi[5]).toBe('#A809C8')
    expect(terminalTheme('blueprint-carbon').ansi[6]).toBe('#4FB3D0')
  })

  it('read on their paper at its lightest and darkest: ink at 4.5:1 and every designed ANSI colour at 3:1', () => {
    for (const id of ids) {
      const theme = terminalTheme(id)
      const flat = requireHex(theme.background)
      const grounds = [flat, ...paperGrounds(theme.paper!, flat)]
      // Slot 0 on a dark paper is the ground's own end of the palette; Velum's slots are all inks.
      const readable = theme.ansi.filter((_, index) => id === 'blueprint-velum' || index !== 0)
      for (const ground of grounds) {
        expect(contrast(requireHex(theme.foreground), ground)).toBeGreaterThanOrEqual(4.5)
        for (const colour of readable) expect(contrast(requireHex(colour), ground)).toBeGreaterThanOrEqual(UI_CONTRAST)
      }
    }
  })
})

/** The two ratios the selection rule holds: off the nearest ground stop, and the better of ink and ground on the highlight. */
function selectionRatios(id: TerminalThemeId, selection: string): { ground: number; text: number } {
  const theme = terminalTheme(id)
  const highlight = requireHex(selection)
  const flat = requireHex(theme.background)
  const grounds = [...(theme.wash ?? []).map(requireHex), ...(theme.paper === undefined ? [] : paperGrounds(theme.paper, flat)), flat]
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
      // The blueprint papers are measured at their lit and shaded extremes as well as the flat ground.
      { id: 'blueprint-cyanotype', placed: '#205A99', before: { ground: 1.24, text: 5.8 }, painted: '#3368A2', after: { ground: 1.52, text: 4.75 }, text: '#E3EAF2' },
      { id: 'blueprint-velum', placed: '#D9D3E8', before: { ground: 1.02, text: 11.24 }, painted: '#B4ACCC', after: { ground: 1.51, text: 7.56 }, text: '#200F5C' },
      { id: 'blueprint-carbon', placed: '#3A4350', before: { ground: 1.11, text: 6.99 }, painted: '#4F5763', after: { ground: 1.52, text: 5.1 }, text: '#D3D8E1' },
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
  it('resolves the defaults to Carbon with V0 type defaults', () => {
    const paint = resolveTerminalPaint()
    expect(paint.background).toBe('#272B32')
    expect(paint.fontFamily).toMatch(/^"DM Mono", ui-monospace/)
    expect(paint.fontSize).toBe(14)
    expect(paint.lineHeight).toBe(1)
    expect(paint.letterSpacing).toBe(0)
    expect(paint.margin).toBe(36)
  })

  it('carries the letter spacing through to the grid', () => {
    expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, letterSpacing: -2 }).letterSpacing).toBe(-2)
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
    expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, bgHex: 'bad' }).background).toBe('#272B32')
  })

  it('draws a blueprint theme\'s paper, with that theme\'s adjustments only, and ignores a custom background', () => {
    const theme = terminalTheme('blueprint-carbon')
    const plain = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'blueprint-carbon' })
    expect(plain.paper).toEqual(paperPaint(theme.paper!, requireHex('#272B32')))
    // A block colour set for the theme reaches the wash laid over programs' blocks.
    const washed = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'blueprint-carbon', paper: { 'blueprint-carbon': { blockColour: '#102030' } } })
    expect(washed.paper?.blockCover).toContain('#102030 100%')
    expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'ink' }).paper).toBeUndefined()
    const paper = { 'blueprint-carbon': { grid: false, halo: 0, shadow: 0 }, 'blueprint-velum': { grain: 0 } }
    const tweaked = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'blueprint-carbon', paper })
    expect(tweaked.paper?.grid).toBeUndefined()
    expect(tweaked.paper?.textShadow).toBe('none')
    expect(tweaked.paper?.grain).toEqual({ opacity: 0.05, size: 600 })
    // Adjustments made on a blueprint theme do nothing to a flat one.
    expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'ink', paper }).paper).toBeUndefined()
    // Its own colours take the theme's place: ground, header, ink and accent, with the ANSI slots that held an ink following it.
    const colours = { 'blueprint-carbon': { ground: '#101418', header: '#202428', ink: '#FFFFFF', accent: '#00FF00', secondary: '#999999', warning: '#FF0000', gridColour: '#123456' } }
    const inked = resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'blueprint-carbon', paper: colours })
    expect(inked).toMatchObject({ background: '#101418', foreground: '#FFFFFF', cursor: '#00FF00' })
    expect([inked.ansi[1], inked.ansi[6], inked.ansi[7], inked.ansi[8]]).toEqual(['#FF0000', '#00FF00', '#FFFFFF', '#999999'])
    expect(inked.ansi[2]).toBe(theme.ansi[2])
    expect(inked.paper?.ground).toContain('#101418 45%')
    expect(inked.paper?.header.endsWith(', #202428')).toBe(true)
    expect(inked.paper?.grid?.image).toContain('#123456')
    // Without a header colour the strip follows the paper colour; a colour that does not parse is ignored.
    expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'blueprint-carbon', paper: { 'blueprint-carbon': { ground: '#101418', ink: 'nope' } } }))
      .toMatchObject({ foreground: '#D3D8E1', paper: { header: expect.stringMatching(/, #101418$/) as string } })
    expect(plain.ansi).toEqual(theme.ansi)
    // JJ's saved background (#3D2936) put Velum's indigo ink on dark plum: a blueprint theme keeps its own ground.
    for (const id of ['blueprint-cyanotype', 'blueprint-velum', 'blueprint-carbon'] as const) {
      expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: id, bgHex: '#3D2936' })).toEqual(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: id }))
    }
    expect(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, theme: 'blueprint-velum', bgHex: '#3D2936' }).background).toBe('#EFEDE7')
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
    expect(terminalCustomised({ ...TERMINAL_DEFAULTS, paper: { 'blueprint-velum': { grain: 30 } } })).toBe(true)
  })

  it('stores paper adjustments sparsely, bounded by the dials\' ranges', () => {
    const parse = (paper: unknown): unknown =>
      AppearanceSettingsSchema({ ...APPEARANCE_DEFAULTS, terminal: { ...TERMINAL_DEFAULTS, paper } } as never).terminal.paper
    expect(AppearanceSettingsSchema({} as never).terminal.paper).toEqual({})
    expect(parse({ 'blueprint-velum': { grain: 30, grid: false } })).toEqual({ 'blueprint-velum': { grain: 30, grid: false } })
    expect(() => parse({ 'blueprint-velum': { gridMinorOpacity: 21 } })).toThrow()
    expect(() => parse({ 'blueprint-velum': { inkOpacity: 39 } })).toThrow()
  })
})

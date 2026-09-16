/** The V0 terminal theme port and the settings → paint resolution. */
import { describe, expect, it } from 'vitest'
import { TERMINAL_DEFAULTS, TERMINAL_THEME_IDS, terminalCustomised } from '../src/appearance-settings.ts'
import { resolveTerminalPaint, TERMINAL_THEMES, terminalFontStack, terminalTheme } from '../src/terminal-themes.ts'

describe('TERMINAL_THEMES', () => {
  it('carries the six V0 themes in panel order, 16 ANSI colours each', () => {
    expect(TERMINAL_THEMES.map(theme => theme.id)).toEqual([...TERMINAL_THEME_IDS])
    expect(TERMINAL_THEMES.map(theme => theme.name)).toEqual(['Linen', 'Ink', 'Y2K', 'IDEalize Dark', 'IDEalize Light', 'Solarized Dark'])
    for (const theme of TERMINAL_THEMES) {
      expect(theme.ansi).toHaveLength(16)
      for (const value of [theme.background, theme.foreground, theme.cursor, theme.selection, ...theme.ansi]) {
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
    // V0 withBackground: selection = blend(bg, fg, 0.14); ink, cursor and palette stay.
    expect(paint.selection).toBe('#2E3C4A')
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

/** Presets and the token derivation: every scheme reads, the user's colours survive. */
import { describe, expect, it } from 'vitest'
import { contrast, parseHex, TEXT_CONTRAST, UI_CONTRAST } from '../src/colour.ts'
import {
  CRISP_BORDER_STEP, CRISP_SECONDARY_BLEND, deriveTokens, hoverOf, onFill, PRESET_LIST, PRESET_TOKEN_KEYS, preset,
  presetPalette, resolveAppearance, surfaceHex, tokenDeclarations,
} from '../src/presets.ts'
import { PRESETS } from '../src/appearance-settings.ts'

const ratio = (a: string, b: string): number => contrast(parseHex(a)!, parseHex(b)!)

describe('preset table', () => {
  it('offers every settings preset, IDEalize first, with the skin seeds as its palettes', () => {
    expect(PRESET_LIST.map(entry => entry.id)).toEqual([...PRESETS])
    expect(preset('idealize').light).toEqual({ ground: '#FFFFFF', ink: '#1B1F24', accent: '#0969DA', crisp: true })
    expect(preset('idealize').dark).toEqual({ ground: '#2A2F35', ink: '#D5DDE3', accent: '#85C1B4' })
  })

  it('carries V0 Theme.swift values for Ink and Linen, paired as one family', () => {
    expect(preset('ink').dark).toMatchObject({ ground: '#17181A', ink: '#E6E7E9', accent: '#E8B84B' })
    expect(preset('linen').light).toMatchObject({ ground: '#F7F5F0', ink: '#2A2A27', accent: '#B67A12' })
    expect(preset('ink').light).toBe(preset('linen').light)
    expect(preset('ink').scheme).toBe('dark')
    expect(preset('linen').scheme).toBe('light')
  })

  it('reports the skin palette for IDEalize swatches', () => {
    expect(presetPalette('idealize', 'light').ground).toBe('#FFFFFF')
    expect(presetPalette('idealize', 'dark').accent).toBe('#85C1B4')
  })
})

describe('deriveTokens', () => {
  it.each(PRESET_LIST)('$id reads in both schemes', (entry) => {
    for (const palette of [entry.light, entry.dark]) {
      const tokens = deriveTokens(palette)
      const ground = tokens['--dsw-alias-bg-base']!
      expect(ratio(tokens['--dsw-alias-label-primary']!, ground)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
      expect(ratio(tokens['--dsw-alias-brand-primary']!, ground)).toBeGreaterThanOrEqual(UI_CONTRAST)
      expect(ratio(tokens['--dsw-alias-brand-primary-invert']!, tokens['--dsw-alias-button-primary-fill']!)).toBeGreaterThanOrEqual(UI_CONTRAST)
    }
  })

  it.each(PRESET_LIST)('$id emits exactly PRESET_TOKEN_KEYS in both schemes', (entry) => {
    for (const palette of [entry.light, entry.dark]) {
      expect(Object.keys(deriveTokens(palette))).toEqual([...PRESET_TOKEN_KEYS])
    }
    expect(Object.keys(deriveTokens({ ground: '#FDE2F3', ink: '#24292F', accent: '#FF74E7', flat: true }))).toEqual([...PRESET_TOKEN_KEYS])
    expect(new Set(PRESET_TOKEN_KEYS).size).toBe(PRESET_TOKEN_KEYS.length)
  })

  it('paints the send button and the business highlight from the accent, and the state colours from their seeds', () => {
    const light = deriveTokens(preset('idealize').light)
    expect(light['--dsw-alias-button-info-fill']).toBe(light['--dsw-alias-button-primary-fill'])
    expect(light['--dsw-alias-button-info-hover']).toBe(light['--dsw-alias-button-primary-hover'])
    expect(light['--dsw-alias-state-business-primary']).toBe(light['--dsw-alias-brand-primary'])
    // Stock amber-600 reads at 2.8:1 on the white ground; the layer deepens it to text strength.
    expect(ratio(light['--dsw-alias-state-warn-label']!, '#FFFFFF')).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    expect(ratio(light['--dsw-alias-state-error-primary']!, '#FFFFFF')).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    expect(ratio(light['--dsw-alias-state-success-primary']!, '#FFFFFF')).toBeGreaterThanOrEqual(UI_CONTRAST)
    // On the dark ground amber and green already read and stay verbatim; red-400 sits at 4.1:1 and lifts to 4.5:1.
    const dark = deriveTokens(preset('idealize').dark)
    expect(ratio(dark['--dsw-alias-state-error-primary']!, '#2A2F35')).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    expect(ratio('#F25A5A', '#2A2F35')).toBeLessThan(TEXT_CONTRAST)
    expect(dark['--dsw-alias-state-warn-label']).toBe('#DD8629')
    expect(dark['--dsw-alias-state-success-primary']).toBe('#22C55E')
  })

  it('writes the ink on a fill only when it reads better than the ground, and hovers toward the far pole', () => {
    const white = { r: 255, g: 255, b: 255 }
    const black = { r: 0, g: 0, b: 0 }
    expect(onFill(parseHex('#0969DA')!, parseHex('#24292F')!, white)).toEqual(white)
    expect(onFill(parseHex('#85C1B4')!, parseHex('#D5DDE3')!, parseHex('#2A2F35')!)).toEqual(parseHex('#2A2F35'))
    expect(hoverOf(white, false)).toEqual({ r: 216.75, g: 216.75, b: 216.75 })
    expect(hoverOf(black, true)).toEqual({ r: 38.25, g: 38.25, b: 38.25 })
    expect(tokenDeclarations({ '--a': '#000000', '--b': 'rgba(0, 0, 0, 0.5)' })).toBe('  --a: #000000;\n  --b: rgba(0, 0, 0, 0.5);')
  })

  it('keeps the OG ground plain: every surface is the ground', () => {
    const tokens = deriveTokens(preset('og').light)
    expect(tokens['--dsw-alias-bg-layer-1']).toBe('#FFFFFF')
    expect(tokens['--dsw-alias-bg-layer-2']).toBe('#FFFFFF')
    expect(tokens['--dsw-alias-bg-layer-3']).toBe('#FFFFFF')
    expect(tokens['--dsw-specific-sidebar-fill']).toBe('#FFFFFF')
  })

  it('drops layer 3 to the surface fraction only where a light ground cannot lift layer 1', () => {
    // #F5F5F6 lifts to a white layer 1, so layer 3 keeps V0's .01 below the ground.
    const lifted = deriveTokens({ ground: '#F5F5F6', ink: '#1B1F24', accent: '#0969DA' })
    expect(lifted['--dsw-alias-bg-layer-1']).toBe('#FFFFFF')
    expect(lifted['--dsw-alias-bg-layer-3']).toBe('#F3F3F4')
    // A white ground is its own layer 1; layer 3 takes .055 so a chip still reads on a card.
    const white = deriveTokens(preset('idealize').light)
    expect(white['--dsw-alias-bg-layer-1']).toBe('#FFFFFF')
    expect(white['--dsw-alias-bg-layer-3']).toBe('#F2F3F3')
    expect(white['--dsw-specific-sidebar-fill']).toBe('#F8F8F8')
    expect(white['--dsw-specific-bubble']).toBe('#F4F4F4')
    expect(deriveTokens(preset('linen').light)['--dsw-alias-bg-layer-3']).toBe('#F5F3EE')
  })

  it('crisp raises every border alpha by one step and tightens the secondary label', () => {
    const plain = deriveTokens({ ...preset('idealize').light, crisp: false })
    const crisp = deriveTokens(preset('idealize').light)
    expect(plain['--dsw-alias-border-l1']).toBe('rgba(27, 31, 36, 0.05)')
    expect(crisp['--dsw-alias-border-l1']).toBe('rgba(27, 31, 36, 0.09)')
    expect(crisp['--dsw-alias-border-l2']).toBe('rgba(27, 31, 36, 0.17)')
    expect(crisp['--dsw-alias-border-l2-darkmode-thin']).toBe('rgba(27, 31, 36, 0.17)')
    expect(crisp['--dsw-alias-border-l3']).toBe('rgba(27, 31, 36, 0.2)')
    expect(crisp['--dsw-alias-border-l4']).toBe('rgba(27, 31, 36, 0.24)')
    expect(plain['--dsw-alias-label-secondary']).toBe('#5F6266')
    expect(crisp['--dsw-alias-label-secondary']).toBe('#56595D')
    expect(CRISP_BORDER_STEP).toBe(0.04)
    expect(CRISP_SECONDARY_BLEND).toBe(0.26)
    // Every other token is untouched by the switch.
    for (const key of PRESET_TOKEN_KEYS) {
      if (key.startsWith('--dsw-alias-border-') || key === '--dsw-alias-label-secondary') continue
      expect(crisp[key]).toBe(plain[key])
    }
    // The dark side of a crisp palette steps the same way from its own alphas.
    const dark = deriveTokens({ ...preset('idealize').dark, crisp: true })
    expect(dark['--dsw-alias-border-l1']).toBe('rgba(213, 221, 227, 0.1)')
    expect(dark['--dsw-alias-border-l2-darkmode-thin']).toBe('rgba(213, 221, 227, 0.12)')
  })

  it('lifts dark surfaces off the ground by V0 blend fractions', () => {
    // Ink: ground #17181A blended 0.045 toward #E6E7E9.
    const tokens = deriveTokens(preset('ink').dark)
    expect(tokens['--dsw-alias-bg-layer-1']).toBe('#202123')
    expect(tokens['--dsw-alias-label-secondary']).toBe('#A8A9AB')
  })

  it('uses the accent verbatim as the button fill and deepens it only where it carries text', () => {
    const tokens = deriveTokens({ ground: '#FFFFFF', ink: '#24292F', accent: '#FFB3E6' })
    expect(tokens['--dsw-alias-button-primary-fill']).toBe('#FFB3E6')
    expect(tokens['--dsw-alias-brand-primary']).not.toBe('#FFB3E6')
    expect(ratio(tokens['--dsw-alias-brand-primary']!, '#FFFFFF')).toBeGreaterThanOrEqual(UI_CONTRAST)
  })

  it('deepens a low-contrast ink along its hue to the text floor', () => {
    const tokens = deriveTokens({ ground: '#FFFFFF', ink: '#9BB0C8', accent: '#0969DA' })
    expect(ratio(tokens['--dsw-alias-label-primary']!, '#FFFFFF')).toBeGreaterThanOrEqual(TEXT_CONTRAST)
  })
})

describe('resolveAppearance', () => {
  it('lays the IDEalize layer from the skin seeds without forcing a scheme', () => {
    const resolved = resolveAppearance('idealize', '', '')
    expect(resolved.light.tokens).toEqual(deriveTokens(preset('idealize').light))
    expect(resolved.dark.tokens).toEqual(deriveTokens(preset('idealize').dark))
    expect(resolved.forcedScheme).toBeUndefined()
  })

  it('forces the scheme of a single-scheme preset', () => {
    expect(resolveAppearance('ink', '', '').forcedScheme).toBe('dark')
    expect(resolveAppearance('linen', '', '').forcedScheme).toBe('light')
    expect(resolveAppearance('og', '', '').forcedScheme).toBeUndefined()
  })

  it('a custom ground decides the scheme and is painted on both sides', () => {
    const resolved = resolveAppearance('idealize', '#FDE2F3', '')
    expect(resolved.forcedScheme).toBe('light')
    expect(resolved.light.tokens?.['--dsw-alias-bg-base']).toBe('#FDE2F3')
    expect(resolved.dark.tokens?.['--dsw-alias-bg-base']).toBe('#FDE2F3')
    expect(resolved.light.palette.ink).toBe('#1B1F24')
    expect(resolved.light.palette.crisp).toBe(true)
    expect(resolveAppearance('idealize', '#101820', '').forcedScheme).toBe('dark')
  })

  it('a custom accent alone derives a layer over the preset seeds, scheme free', () => {
    const resolved = resolveAppearance('idealize', '', '#FF74E7')
    expect(resolved.forcedScheme).toBeUndefined()
    expect(resolved.light.tokens?.['--dsw-alias-button-primary-fill']).toBe('#FF74E7')
    expect(resolved.dark.tokens?.['--dsw-alias-button-primary-fill']).toBe('#FF74E7')
    expect(resolved.light.tokens?.['--dsw-alias-bg-base']).toBe('#FFFFFF')
    expect(resolved.dark.tokens?.['--dsw-alias-bg-base']).toBe('#2A2F35')
  })

  it('ignores malformed custom hexes', () => {
    expect(resolveAppearance('idealize', 'nope', '#12').light.tokens).toEqual(deriveTokens(preset('idealize').light))
  })
})

describe('preset edge cases', () => {
  it('throws on an unknown id and keeps a flat preset flat under a custom accent', () => {
    expect(() => preset('neon' as never)).toThrow(/unknown preset/)
    const resolved = resolveAppearance('og', '', '#FF0000')
    expect(resolved.light.palette).toMatchObject({ accent: '#FF0000', flat: true })
    expect(resolveAppearance('ink', '', '#FF0000').dark.palette.flat).toBeUndefined()
    expect(resolveAppearance('idealize', '', '#FF0000').light.palette.crisp).toBe(true)
    expect(resolveAppearance('idealize', '', '#FF0000').dark.palette.crisp).toBeUndefined()
    expect(resolveAppearance('og', '', '').light.palette.crisp).toBeUndefined()
    expect(surfaceHex(resolveAppearance('idealize', '', '').light)).toBe('#FFFFFF')
    expect(surfaceHex(resolveAppearance('ink', '', '').dark)).toBe(deriveTokens(preset('ink').dark)['--dsw-alias-bg-layer-1'])
    expect(() => surfaceHex({ tokens: {}, palette: presetPalette('og', 'light') })).toThrow()
  })
})

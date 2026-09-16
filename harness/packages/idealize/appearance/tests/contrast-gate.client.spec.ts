/**
 * The readability gate over every stock preset: the base palette
 * (design-platform.css) with a preset's layer laid over it, resolved the way
 * the browser resolves it, must read at WCAG's floors in both schemes. The
 * skin sheet is `deriveTokens` over the IDEalize seeds (asserted in
 * `@idealize/skin`'s own tests), so the IDEalize rows here cover the first
 * paint as well as the panel's layer.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast, parseHex, TEXT_CONTRAST, UI_CONTRAST, type Rgb } from '../src/colour.ts'
import { deriveTokens, PRESET_LIST, type Tokens } from '../src/presets.ts'

const BASE_SHEET = new URL('../../../client/ui-theme/src/styles/design-platform.css', import.meta.url)

type Scheme = 'light' | 'dark'

/** The `body` and `body[data-ds-dark-theme]` declarations of a sheet, statics and aliases alike. */
function baseTokens(css: string): Record<Scheme, Tokens> {
  const out: Record<Scheme, Tokens> = { light: {}, dark: {} }
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = block[1]!.trim()
    const scheme: Scheme | undefined = selector === 'body' ? 'light' : selector === 'body[data-ds-dark-theme]' ? 'dark' : undefined
    if (scheme === undefined) continue
    for (const declaration of block[2]!.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon === -1) continue
      const name = declaration.slice(0, colon).trim()
      if (name.startsWith('--')) out[scheme][name] = declaration.slice(colon + 1).trim()
    }
  }
  return out
}

/** Follow `var(--name)` references until a literal colour remains. */
function resolve(tokens: Tokens, value: string): string {
  let current = value
  for (let hops = 0; hops < 8; hops += 1) {
    const reference = /var\((--[a-z0-9-]+)\)/i.exec(current)
    if (reference === null) return current
    const target = tokens[reference[1]!]
    if (target === undefined) throw new Error(`unresolved ${reference[1]}`)
    current = current.replace(reference[0], target)
  }
  throw new Error(`var() chain too deep: ${value}`)
}

/** A resolved literal as a colour; alpha is refused because a translucent ink has no single contrast. */
function rgb(literal: string): Rgb {
  const hex = parseHex(literal)
  if (hex !== undefined) return hex
  const channels = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(literal)
  if (channels === null) throw new Error(`not an opaque colour: ${literal}`)
  return { r: Number(channels[1]), g: Number(channels[2]), b: Number(channels[3]) }
}

const base = baseTokens(readFileSync(BASE_SHEET, 'utf8'))

/** The page's tokens under one preset in one scheme: the layer over the base palette. */
function painted(layer: Tokens, scheme: Scheme): (name: string) => Rgb {
  const tokens = { ...base[scheme], ...layer }
  return name => rgb(resolve(tokens, tokens[name] ?? (() => { throw new Error(`no ${name}`) })()))
}

const ratio = (a: Rgb, b: Rgb): number => Math.round(contrast(a, b) * 100) / 100

describe('stock presets read on their grounds', () => {
  const cases = PRESET_LIST.flatMap(entry => (['light', 'dark'] as const).map(scheme => ({ id: entry.id, scheme, palette: entry[scheme] })))

  it.each(cases)('$id / $scheme', ({ palette, scheme }) => {
    const token = painted(deriveTokens(palette), scheme)
    const grounds = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-specific-sidebar-fill'].map(token)
    for (const ink of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary'].map(token)) {
      for (const ground of grounds) expect(ratio(ink, ground)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    }
    const ground = token('--dsw-alias-bg-base')
    expect(ratio(token('--dsw-alias-brand-primary'), ground)).toBeGreaterThanOrEqual(UI_CONTRAST)
    expect(ratio(token('--dsw-alias-state-business-primary'), ground)).toBeGreaterThanOrEqual(UI_CONTRAST)
    expect(ratio(token('--dsw-alias-state-error-primary'), ground)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    expect(ratio(token('--dsw-alias-state-warn-label'), ground)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    expect(ratio(token('--dsw-alias-state-success-primary'), ground)).toBeGreaterThanOrEqual(UI_CONTRAST)
    expect(ratio(token('--dsw-alias-brand-primary-invert'), token('--dsw-alias-button-primary-fill'))).toBeGreaterThanOrEqual(UI_CONTRAST)
  })

  it('the base sheet parses into both schemes and resolves its own chains', () => {
    expect(Object.keys(base.light).length).toBeGreaterThan(80)
    expect(Object.keys(base.dark).length).toBeGreaterThan(80)
    expect(resolve(base.light, base.light['--dsw-alias-label-primary']!)).toBe('rgb(15, 17, 21)')
    expect(() => resolve(base.light, 'var(--nope)')).toThrow(/unresolved/)
    expect(() => resolve({ '--a': 'var(--b)', '--b': 'var(--a)' }, 'var(--a)')).toThrow(/too deep/)
    expect(() => rgb('rgba(0, 0, 0, 0.5)')).toThrow(/not an opaque colour/)
    expect(() => painted({}, 'light')('--dsw-alias-nope')).toThrow(/no --dsw-alias-nope/)
  })
})

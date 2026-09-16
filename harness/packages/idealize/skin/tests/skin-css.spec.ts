/** The brand sheet: one token list shared with the appearance presets, injected after the body tag. */
import { describe, expect, it } from 'vitest'
import { deriveTokens, PRESET_TOKEN_KEYS, presetPalette } from '@idealize/appearance'
import { injectSkin, SKIN_CSS, SKIN_STYLE_ID } from '../src/skin-css.ts'

/** The declarations of one `selector { ... }` block as a name → value map. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no ${selector} block`)
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const line of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/\s+/g, ' ')
  }
  return out
}

describe('SKIN_CSS', () => {
  it('carries the IDEalize layer for both schemes, exactly PRESET_TOKEN_KEYS plus the type tokens', () => {
    const light = block(SKIN_CSS, 'body')
    const dark = block(SKIN_CSS, 'body[data-ds-dark-theme]')
    const typeKeys = [
      '--ds-font-family-code', '--idealize-type-title', '--idealize-type-section', '--idealize-type-body',
      '--idealize-type-small', '--idealize-type-caption',
    ]
    expect(Object.keys(light)).toEqual([...PRESET_TOKEN_KEYS, ...typeKeys])
    expect(Object.keys(dark)).toEqual([...PRESET_TOKEN_KEYS])
    for (const [name, value] of Object.entries(deriveTokens(presetPalette('idealize', 'light')))) expect(light[name]).toBe(value)
    for (const [name, value] of Object.entries(deriveTokens(presetPalette('idealize', 'dark')))) expect(dark[name]).toBe(value)
    expect(light['--dsw-alias-bg-base']).toBe('#FFFFFF')
    expect(light['--dsw-alias-label-primary']).toBe('#1B1F24')
    expect(light['--dsw-alias-border-l2']).toBe('rgba(27, 31, 36, 0.17)')
    expect(dark['--dsw-alias-brand-primary']).toBe('#85C1B4')
    expect(light['--ds-font-family-code']).toContain("'DM Mono'")
  })

  it('injects after the opening body tag, or appends when the page has none', () => {
    const html = '<html><head></head><body class="x"><div id="root"></div></body></html>'
    const out = injectSkin(html)
    expect(out.indexOf(`<style id="${SKIN_STYLE_ID}">`)).toBe(html.indexOf('<body class="x">') + '<body class="x">'.length)
    expect(out).toContain('--dsw-alias-bg-base: #FFFFFF;')
    expect(injectSkin('<p>bare</p>')).toMatch(/^<p>bare<\/p><style id="idealize-skin">/)
  })
})

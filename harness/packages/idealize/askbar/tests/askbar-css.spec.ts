// The bar's sheet: theme tokens only (no literal colour, so both schemes
// follow the sidebar), the sidebar fill over the app ground, the drag region
// on the bar with every control opted out, and the brand mark at the
// sidebar's size.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sheet = readFileSync(new URL('../src/client/Askbar.module.css', import.meta.url), 'utf8')

/** Every selector in the sheet, in source order. */
function selectors(): string[] {
  return [...sheet.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(([, list = '']) => list.split(',').map(value => value.trim()))
    .filter(value => value !== '' && !value.startsWith('@'))
}

/** One rule's declarations. */
function block(selector: string): string {
  const start = sheet.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no rule ${selector}`)
  return sheet.slice(start, sheet.indexOf('}', start))
}

describe('Askbar.module.css', () => {
  it('holds no literal colour: every colour is a theme token', () => {
    expect(sheet.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
    expect(sheet.match(/\b(?:rgba?|hsla?)\(/g)).toBeNull()
    // Named colours as values (`white-space` is a property, not a colour).
    const named = sheet.match(/:\s*(?:white|black|red|blue|green|grey|gray)\b/g)
    expect(named).toBeNull()
  })

  it('paints the sidebar fill over the app ground and marks the bar as the drag region', () => {
    const bar = block('.bar')
    expect(bar).toContain('background-color: var(--dsw-alias-bg-base)')
    expect(bar).toContain('var(--dsw-specific-sidebar-fill, transparent)')
    expect(bar).toContain('-webkit-app-region: drag')
    expect(bar).toContain('color: var(--dsw-alias-label-primary)')
  })

  it('opts every control out of the drag region', () => {
    const controls = sheet.slice(sheet.indexOf('.bar button,'), sheet.indexOf('}', sheet.indexOf('.bar button,')))
    expect(controls).toContain('.bar input')
    expect(controls).toContain(".bar [role='dialog']")
    expect(controls).toContain('-webkit-app-region: no-drag')
  })

  it('renders one rail in both homes, at the bar\u2019s own width', () => {
    expect(block('.rail')).toContain('flex: 1 1 0')
    // The floating bar's width, half again the design spec's 72px (JJ, 11 Sep
    // 2026); SIDEBAR_COLLAPSED and ASKBAR_WIDTH hold the same number, so the
    // collapsed column renders the same rail (JJ, 13 Sep 2026).
    expect(block('.bar')).toContain('width: 108px')
    // Nothing squeezes the sidebar home into a narrower column any more, and
    // no rule here treats one home differently from the other.
    expect(selectors().filter(value => value.includes("data-home='sidebar'"))).toEqual([])
  })

  it('makes room for a panel in the bar\u2019s own window', () => {
    // A 300px panel beside a 108px column was cut off at the window edge, so
    // the window grows and the column holds its screen edge (JJ, 13 Sep 2026).
    const pinned = selectors().filter(value => value.includes("data-dsh-desktop-mode='askbar'"))
    expect(pinned.some(value => value.endsWith('.bar'))).toBe(true)
    expect(pinned.some(value => value.includes(".panel[data-edge='right']"))).toBe(true)
    expect(pinned.some(value => value.includes(".panel[data-edge='left']"))).toBe(true)
  })

  it('sizes the brand mark as the floating bar does and reads the Studio as one more circle', () => {
    expect(block('.projectMark')).toContain('width: 58px')
    expect(block('.bar')).toContain('padding: 16px 0 18px')
    const tile = block('.studioTile')
    expect(tile).toContain('border-radius: 50%')
    // The static white in both schemes: the dark theme must not swallow the owl (JJ, 15 Sep 2026).
    expect(tile).toContain('background: var(--dsw-static-neutral-bluish-00)')
    // The same 48px circle a chip's portrait carries, so the Studio
    // Coordinator reads as one of the agents under it (JJ, 13 Sep 2026).
    expect(tile).toContain('width: 48px')
    expect(tile).toContain('height: 48px')
    expect(block('.avatar')).toContain('width: 48px')
  })

  it('draws the rail’s separator as a rule carrying no title', () => {
    const rule = block('.rule')
    expect(rule).toContain('border-top: 1px solid var(--dsw-alias-border-l2)')
    expect(rule).toContain('width: 24px')
  })
})

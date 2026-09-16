/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('shares and cancels the wide shell trailing padding structurally', () => {
    const root = declarations('.root')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('12px')
    expect(root?.get('padding')).toBe('16px var(--dsh-sidebar-inline-padding) 18px')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--dsh-sidebar-inline-padding))',
    )
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('moves the four upper controls while the settings seat only fades', () => {
    const animation = 'rail-in 150ms var(--ds-ease-in-out) backwards'
    for (const selector of [
      '.railIn .iconButton',
      '.railIn .newSession',
      '.railIn .regionArea',
    ]) {
      expect(declarations(selector)?.get('animation')).toBe(animation)
    }
    expect(declarations('.railIn .footArea')?.get('animation')).toBe(
      'rail-fade-in 150ms var(--ds-ease-in-out) backwards',
    )
    expect(css).toMatch(
      /@keyframes rail-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(49px\);\s*}\s*}/,
    )
    expect(css).toMatch(/@keyframes rail-fade-in\s*\{\s*from\s*\{\s*opacity: 0;\s*}\s*}/)
  })

  it('leaves the rail seat the column\u2019s own width', () => {
    // IDEalize fork (JJ, 13 Sep 2026): 6px insets in the 108px column, so the
    // agent chips get their 96px and the rail reads as the floating bar does.
    expect(declarations('.root.collapsed')?.get('padding')).toBe('18px 6px 6px')
  })

  it('centres the shell rail controls in the column', () => {
    // IDEalize fork (JJ, 13 Sep 2026): the collapsed column is 108px because
    // it carries the agent chips, and a left-hugged icon over a centred chip
    // column read as two rails.
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('center')
    // The rail's toggle rests as the 58px logo card, the wide header's asset (JJ, 15 Sep 2026).
    expect(declarations('.collapsed .logoRow')?.get('height')).toBe('58px')
    expect(declarations('.collapsed .toggle')?.get('width')).toBe('58px')
    expect(declarations('.collapsed .toggle:hover .railCard')?.get('display')).toBe('none')
    expect(declarations('.newSession')?.get('align-self')).toBe('center')
    expect(declarations('.newSession')?.get('width')).toBe('36px')
  })
})

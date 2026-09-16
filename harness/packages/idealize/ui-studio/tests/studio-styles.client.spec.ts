/**
 * The Studio's composer contract, stated in its own stylesheet: the seat
 * stays (it is how a post is sent) and the model seat goes (a Studio send is
 * taken by `agent/pre-step` and the step rejected, so no model runs).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/StudioView.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * Every selector in the sheet, in source order.
 * @returns the trimmed selector texts.
 */
function selectors(): string[] {
  return [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(([, list = '']) => list.split(',').map(value => value.trim()))
    .filter(value => !value.startsWith('@'))
}

describe('StudioView.module.css', () => {
  it('retires the model seat, naming only the Studio view', () => {
    const rule = selectors().find(value => value.includes('conversation.input.model'))
    expect(rule).toBeDefined()
    // Named on this view's own id: every other blank view keeps its picker.
    expect(rule).toContain("data-blank-view='studio'")
    // The seat's wrapper carries an inline `display: contents`, so the rule
    // has to reach what the seat renders rather than the seat itself.
    expect(rule).toMatch(/> \*$/)
    const body = /\[data-slot='conversation\.input\.model'\]\) > \*\s*\{([^{}]*)\}/.exec(css)?.[1] ?? ''
    expect(body).toContain('display: none')
  })

  it('keeps the composer seat, which is how a Studio post is sent', () => {
    expect(selectors().some(value => value.includes('data-composer-seat'))).toBe(false)
  })
})

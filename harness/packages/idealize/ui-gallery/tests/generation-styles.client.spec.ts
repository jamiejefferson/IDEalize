/**
 * The media composer's contract, stated in the strip's own stylesheet: where
 * the strip renders, the chat-model seat beside it goes. A media space's
 * generation model belongs to its brain and is chosen in the Brains pane, and
 * the seat names the CHAT model, which there only drives the tool — so with
 * both on the bar it stated a model twice and one of them was not the one
 * making the picture (JJ, 13 Sep 2026).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/GenerationSettings.module.css', import.meta.url)),
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

describe('GenerationSettings.module.css', () => {
  it('retires the chat-model seat wherever the strip renders', () => {
    const rule = selectors().find(value => value.includes('conversation.input.model'))
    expect(rule).toBeDefined()
    // Keyed on the strip's own presence, not on a blank chat: a media chat
    // with a hundred pictures in it needs the seat gone just as much.
    expect(rule).toContain('data-gen-settings-space')
    // The seat's wrapper carries an inline `display: contents`, so the rule
    // has to reach what the seat renders rather than the seat itself.
    expect(rule).toMatch(/> \*$/)
    const body = /\[data-slot='conversation\.input\.model'\]\) > \*\s*\{([^{}]*)\}/.exec(css)?.[1] ?? ''
    expect(body).toContain('display: none')
  })

  it('carries no generator control of its own', () => {
    expect(css).not.toContain('.generator')
  })
})

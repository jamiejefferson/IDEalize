/**
 * The composer seat's geometry under a view that carries the composer
 * overlay. The seat is absolutely positioned against the scroll body, so the
 * body must never become the scroller: an absolute box inside a scroll
 * container rides the scroll offset, and the composer would leave the floor.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)

/** The stylesheet with comments stripped, so a selector quoted in prose cannot match. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * Every selector in the sheet, in source order.
 * @returns the trimmed selector texts.
 */
function selectors(): string[] {
  return [...rules.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(([, list = '']) => list.split(',').map(value => value.trim()))
}

describe('ConversationRoot.module.css: the composer overlay', () => {
  it('pins the seat to the foot of the scroll body', () => {
    const pin = '.scrollBody:has([data-conversation-composer-overlay]) > .composerSeat'
    expect(selectors()).toContain(pin)
    const body = /\.scrollBody:has\(\[data-conversation-composer-overlay\]\) > \.composerSeat\s*\{([^{}]*)\}/.exec(rules)?.[1] ?? ''
    expect(body).toContain('position: absolute')
    expect(body).toContain('bottom: 0')
  })

  it('caps an overlay view on a blank chat rather than letting it grow the scroller', () => {
    // The blank-view rule (a welcome-card launch into Terminal or a media
    // space) lets the view area grow to its content, which makes the scroll
    // body the scroller. An overlay view scrolls inside itself, so it is
    // excluded — otherwise the absolutely positioned seat rides the offset.
    const grow = selectors().filter(value => value.includes('[data-blank-view]') && value.endsWith('.viewArea'))
    expect(grow).toHaveLength(0)
    expect(selectors()).toContain(
      '.root[data-phase=\'hero\']:has(.viewArea[data-blank-view]) .viewArea:not(:has([data-conversation-composer-overlay]))',
    )
  })
})

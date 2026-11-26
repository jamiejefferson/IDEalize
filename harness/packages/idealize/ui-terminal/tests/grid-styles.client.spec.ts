/**
 * The grid host's stylesheet rule. The conversation's view area grows to its
 * content and never shrinks under it, so an uncontained host kept the old
 * grid's height through a shorter window or a larger font, and the rows under
 * the fold took the agent's input box with them (JJ, 18 Sep 2026). Layout
 * itself is the headless proof's (`proof/resize-proof.mts`); this pins the
 * declarations it depends on.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sheet = readFileSync(fileURLToPath(new URL('../src/client/TerminalView.module.css', import.meta.url)), 'utf8')

describe('grid host styles', () => {
  it('sizes the host from its column, never from the rows xterm drew inside it', () => {
    const rule = /\n\.grid \{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(rule).toMatch(/contain:\s*size;/)
    expect(rule).toMatch(/overflow:\s*hidden;/)
    expect(rule).toMatch(/min-height:\s*0;/)
  })
})

describe('paper styles', () => {
  it('lets the paper through xterm\'s ground, stacks the grid host above it, and inks every run of text', () => {
    expect(sheet).toMatch(/\.root\[data-paper\] \.grid \{\s*position:\s*relative;/)
    expect(sheet).toMatch(
      /\[data-paper\] \.grid :global\(\.xterm\) :global\(\.xterm-scrollable-element\) \{\s*background-color:\s*transparent !important;/,
    )
    expect(sheet).toMatch(/:global\(\.xterm-rows\) \{\s*opacity:\s*var\(--idealize-paper-ink-opacity, 1\);/)
    expect(sheet).toMatch(/:global\(\.xterm-rows\) span \{\s*text-shadow:\s*var\(--idealize-paper-text-shadow, none\);/)
    // Exact-colour blocks take the paper wash; selected cells keep the selection colour.
    expect(sheet).toMatch(/span\[style\*='background-color'\]:not\(:global\(\.xterm-decoration-top\)\) \{/)
    expect(sheet).toMatch(/background-image:\s*var\(--idealize-paper-block-cover, none\);/)
    expect(/\n\.paper \{([^}]*)\}/.exec(sheet)?.[1]).toMatch(/pointer-events:\s*none;/)
  })
})

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

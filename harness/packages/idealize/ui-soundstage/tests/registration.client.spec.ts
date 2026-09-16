/**
 * The ring entry id is pinned against the view id `@idealize/ui-gallery`'s
 * generation settings strip renders on, so the Sound Stage's length control
 * appears on this space and this space alone.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GENERATION_VIEWS } from '@idealize/ui-gallery/client'
import { SOUNDSTAGE_VIEW } from '../src/client/index.ts'

describe('the ring entry id', () => {
  it('is spelled out for the slot catalog and is a view the settings strip renders on', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/client/index.ts', import.meta.url)), 'utf8')
    expect(source).toContain(`id: '${SOUNDSTAGE_VIEW}',`)
    expect(GENERATION_VIEWS).toContain(SOUNDSTAGE_VIEW)
  })
})

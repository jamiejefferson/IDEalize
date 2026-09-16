/** The models page: one whole document naming the surfaces it links to. */

import { describe, expect, it } from 'vitest'
import { modelsPage } from '../src/models-page.ts'

describe('the models page', () => {
  it('is a whole document that reaches the spend meter', () => {
    const html = modelsPage()
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('/idealize/spend')
    expect(html).toContain('</html>')
  })
})

// The rule behind the outline's highlight: which heading the reader is in,
// from each heading's distance below the scroller's top edge.
import { describe, expect, it } from 'vitest'
import { activeHeading, OUTLINE_SLACK_PX } from '../src/client/outline-active.ts'

describe('activeHeading', () => {
  it('has nothing to highlight in a document with no headings', () => {
    expect(activeHeading([])).toBe(-1)
  })

  it('holds the first heading while the document sits at its top', () => {
    expect(activeHeading([0, 240, 880])).toBe(0)
  })

  it('holds the first heading while the reader is above every heading', () => {
    // A document opening with a paragraph: the first heading is still below.
    expect(activeHeading([120, 640])).toBe(0)
  })

  it('takes the last heading that has passed the top edge', () => {
    expect(activeHeading([-420, -30, 260])).toBe(1)
    expect(activeHeading([-900, -540, -12])).toBe(2)
  })

  it('counts a heading resting on the edge as passed, within the slack', () => {
    expect(activeHeading([-100, OUTLINE_SLACK_PX, 400])).toBe(1)
    expect(activeHeading([-100, OUTLINE_SLACK_PX + 1, 400])).toBe(0)
  })
})

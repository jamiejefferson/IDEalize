/**
 * Which section of a document the reader is in, for the file viewer's outline
 * column. The rule is the one an IDE's symbol list uses: the section you are
 * in is the last heading whose top has passed the scroller's top edge, and
 * before any heading has passed it, the first one (JJ, 10 Sep 2026: "add a
 * highlight for which section you're in, in a document").
 * @module @idealize/ui-bar/client/outline-active
 */

/**
 * How far below the scroller's top edge a heading still counts as passed. A
 * heading sitting exactly on the edge reads as the current one, and this
 * absorbs the sub-pixel drift a fractional scroll position leaves behind.
 */
export const OUTLINE_SLACK_PX = 8

/**
 * The heading the reader is inside.
 * @param offsets - each heading's top edge in pixels from the scroller's top
 *   edge, in document order; negative once a heading has scrolled past it.
 * @returns the index into `offsets`, or -1 when the document has no headings.
 */
export function activeHeading(offsets: readonly number[]): number {
  if (offsets.length === 0) return -1
  let active = 0
  for (const [index, offset] of offsets.entries()) {
    if (offset > OUTLINE_SLACK_PX) break
    active = index
  }
  return active
}

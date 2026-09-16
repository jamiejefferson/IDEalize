/**
 * The space icons' route vocabulary: where `@idealize/spaces` serves the six
 * outline icons (Tabler Icons, MIT, at stroke 1.25 on the 24 grid, drawn in
 * `currentColor`), and the helper a client builds the icon URL from. The icon files live once, under this
 * package's `assets/icons/<space>.svg`; every surface that shows a space
 * (launcher tiles, the brain step's chip, the sidebar lane, the Studio card)
 * applies the served file as a CSS mask over `currentColor` instead of drawing
 * its own glyph, so the icon takes the colour of the text beside it.
 *
 * This module is stateless and holds no import of the space table, so a
 * client bundle may inline it (the `@idealize/artefacts` reveal signal is the
 * precedent) without carrying a second copy of the table.
 * @module @idealize/spaces/space-icons
 */

import type { SpaceId } from './space-table.ts'

/** The route prefix every space icon is served under; the file is `<space>.svg`. */
export const SPACE_ICON_PATH = '/idealize/spaces/icons'

/**
 * The URL a client loads one space's icon from, same-origin with the served
 * app. Size the masked element at the call site; the file is a 24×24 viewBox
 * whose strokes are `currentColor`, so an `<img>` would show it black.
 * @param id - the space whose icon to load.
 * @returns the pathname of the icon route for that space.
 */
export function spaceIconSrc(id: SpaceId): string {
  return `${SPACE_ICON_PATH}/${id}.svg`
}

/**
 * One space's icon, the outline file `@idealize/spaces` serves at
 * `/idealize/spaces/icons/<space>.svg` (Tabler Icons outlines at stroke 1.25;
 * JJ, 8 Sep 2026 review, item 9, second round). The launcher tiles, the brain
 * step's chip and the pinned Studio card all render this component, so the
 * icon has one home and a replaced file reaches every surface.
 *
 * The file is applied as a CSS mask over `currentColor` instead of an `<img>`,
 * so the icon takes the tile's label colour, the chip's brand blue and the
 * hover colour the way the surrounding text does; an `<img>` keeps the file's
 * own colour.
 * @module @idealize/ui-bar/client/SpaceIcon
 */
import type { CSSProperties } from 'react'
// Value import of the stateless route helper alone; the space table never
// enters this bundle.
import { spaceIconSrc, type SpaceId } from '@idealize/spaces/client'
import css from './SpaceIcon.module.css'

/**
 * Render a space's served icon at the given square size, in the current text colour.
 * @param props - the space and the rendered edge length in CSS pixels.
 * @returns a decorative square masked by the icon; the surrounding control carries the label.
 */
export function SpaceIcon({ space, size }: { space: SpaceId; size: number }) {
  const style = { width: size, height: size, '--space-icon': `url(${spaceIconSrc(space)})` } as CSSProperties
  return <span className={css.icon} style={style} aria-hidden="true" data-space-icon={space} />
}

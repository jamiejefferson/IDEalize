/**
 * The sidebar's space lane: one icon per IDEalize space, the outline file
 * `@idealize/spaces` serves at `/idealize/spaces/icons/<space>.svg` (Tabler
 * Icons outlines at stroke 1.25; JJ, 8 Sep 2026 review, item 9, second
 * round), applied as a CSS mask over `currentColor` so it takes the row's
 * text colour.
 *
 * The route is restated here as a literal rather than read from
 * `spaceIconSrc` in `@idealize/spaces/client`, because this upstream package
 * references that fork package type-only: a value import into its client
 * bundle would inline fork code here instead of failing the purity gate, which
 * tests only `@deepseek-ai/` specifiers. Only the `SpaceId` union crosses.
 */
import type { CSSProperties } from 'react'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SpaceId } from '../tree.ts'
import css from './Rows.module.css'

/** The icon route `@idealize/spaces` serves; the file is `<space>.svg`. */
const SPACE_ICON_PATH = '/idealize/spaces/icons'

/**
 * One row's space lane.
 *
 * Rendered on every session row in every space, so the lane runs as a straight
 * vertical line down the list and no row shifts or changes height when a
 * chat's space resolves.
 * @param props - the row's space and the workspace-namespace locale seat.
 * @returns the fixed-width lane holding this space's icon.
 */
export function SpaceGlyph({ space, t }: { space: SpaceId; t: WorkspaceBrowserProps['t'] }) {
  const style = { '--space-icon': `url(${SPACE_ICON_PATH}/${space}.svg)` } as CSSProperties
  return (
    <span
      className={css.spaceLane}
      data-space={space}
      role="img"
      aria-label={t(`space.${space}`)}
    >
      <span className={css.spaceIcon} style={style} data-space-icon={space} />
    </span>
  )
}

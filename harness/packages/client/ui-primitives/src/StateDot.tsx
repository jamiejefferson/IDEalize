// StateDot: session state indicator (figma nodes 14:3303/3305/3312, 122:9182).
// done/warning/error: 10x10 halo (same color, 10% opacity) around a 6x6 solid
// core. ongoing: a turning gear — eight teeth around a ring, rotating once
// every 2.4s. Colors resolve through --dsw-* tokens only.
//
// The ongoing state was a pixel-art chase of eight cells stepping clockwise
// round a 3x3 matrix. It read as a retro loading square and belonged to
// nothing else in the app (JJ, 11 Sep 2026: "the in-action animation needs to
// be updated - doesn't suit the app - maybe a turning gear?"). A gear says
// machinery is running, which is what the state means.

import clsx from 'clsx'
import css from './StateDot.module.css'

/** Four-color state semantic (green done / amber user-attention / blue running ring / red error). */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error'

/** Tooth angles in degrees, evenly spaced around the 10x10 gear. */
const GEAR_TEETH: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315]

/**
 * Render a state dot.
 * @param props.state - which of the four states to show.
 * @param props.size - outer diameter in px (default 10, the figma size).
 * @param props.className - extra class for layout placement.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
export function StateDot({ state, size = 10, className }: {
  state: StateDotState
  size?: number | undefined
  className?: string | undefined
}) {
  if (state === 'ongoing') {
    return (
      <svg
        className={clsx(css.gear, className)}
        data-state="ongoing"
        width={size}
        height={size}
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        {GEAR_TEETH.map(angle => (
          <rect
            key={angle}
            className={css.tooth}
            x="4.25"
            y="0.3"
            width="1.5"
            height="2.1"
            rx="0.45"
            transform={`rotate(${String(angle)} 5 5)`}
          />
        ))}
        {/* The ring's 1.5 stroke leaves a hub hole at r 2.05, which is what
            makes the shape read as a gear rather than a cog-shaped blob. */}
        <circle className={css.hub} cx="5" cy="5" r="2.8" />
      </svg>
    )
  }
  return (
    <span
      className={clsx(css.dot, className)}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}

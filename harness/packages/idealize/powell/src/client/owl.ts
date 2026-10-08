/**
 * Which run-cycle frames the owl shows in each pose (JJ, 2 Oct 2026: use the
 * animated frames already made). The 42 frames run side-on turn (0–6), wing
 * lift and blink (7–13), front-facing calm (14–20), blink into wing raise
 * (21–27), both wings out (28–34) and settle (35–41).
 * @module @idealize/powell/client/owl
 */

/** One pose: frames, frames per second, and whether it loops. */
export interface Pose {
  frames: readonly number[]
  fps: number
  loop: boolean
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index)

/** The pose for each thing the owl can be doing. */
export const POSES = {
  /** Still and front-facing; a blink plays now and then. */
  idle: { frames: [16], fps: 1, loop: false },
  blink: { frames: [16, 23, 24, 23, 16], fps: 14, loop: false },
  /** Attentive: leans in (CSS) on the front frame. */
  listening: { frames: [17], fps: 1, loop: false },
  /** A small head bob on the calm frames. */
  thinking: { frames: [...range(14, 20), ...range(14, 20).reverse()], fps: 7, loop: true },
  /** The full run-cycle while it works. */
  acting: { frames: range(0, 41), fps: 12, loop: true },
  /** Wings out, flapping, while it is dragged (JJ: "the owl should flap when moved"). */
  flap: { frames: [28, 29, 30, 31, 32, 33, 34, 33, 32, 31, 30, 29], fps: 18, loop: true },
  /** Wings up and settle once: the work landed. */
  done: { frames: [...range(25, 41)], fps: 16, loop: false },
  /** Holds on the front frame with the bubble up. */
  waiting: { frames: [18], fps: 1, loop: false },
  /** Eyes squeezed: something went wrong. */
  problem: { frames: [12], fps: 1, loop: false },
} as const satisfies Record<string, Pose>

export type PoseName = keyof typeof POSES

/**
 * Little things the owl does by itself while idle, and when the pointer
 * comes over it (JJ, 2 Oct 2026: "the owl should look more alive"). Each
 * starts and ends on the resting frame, so it slots in anywhere.
 */
export const AMBIENT = {
  blink: { frames: [16, 23, 24, 23, 16], fps: 14, loop: false },
  /** A glance to the side and back. */
  look: { frames: [16, 15, 14, 6, 5, 4, 3, 3, 3, 3, 3, 4, 5, 6, 14, 15, 16], fps: 12, loop: false },
  /** A slow wing stretch. */
  stretch: { frames: [16, 21, 22, 25, 26, 27, 28, 29, 30, 30, 30, 29, 28, 27, 26, 25, 22, 21, 16], fps: 12, loop: false },
  /** A small sway on its feet. */
  sway: { frames: [16, 17, 18, 19, 20, 20, 19, 18, 17, 16], fps: 9, loop: false },
  /** The pointer arrived: a quick, pleased flutter. */
  perk: { frames: [16, 21, 26, 27, 28, 29, 28, 27, 26, 21, 16], fps: 18, loop: false },
} as const satisfies Record<string, Pose>

export type AmbientName = keyof typeof AMBIENT

/** How often each idle move is picked; blinks are the commonest. */
export const AMBIENT_WEIGHTS: readonly (readonly [Exclude<AmbientName, 'perk'>, number])[] = [
  ['blink', 0.45],
  ['look', 0.25],
  ['sway', 0.18],
  ['stretch', 0.12],
]

/**
 * Pick an idle move.
 * @param roll - a number in [0, 1).
 * @returns the move.
 */
export function pickAmbient(roll: number): Exclude<AmbientName, 'perk'> {
  let total = 0
  for (const [name, weight] of AMBIENT_WEIGHTS) {
    total += weight
    if (roll < total) return name
  }
  return 'blink'
}

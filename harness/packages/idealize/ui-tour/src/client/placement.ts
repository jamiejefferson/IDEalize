/**
 * Tour card placement, ported from V0's `TourLayout`: the card parks beside
 * the spotlight (right, else left, else above, else below) and clamps to the
 * container so it never hangs off an edge; with no spotlight it sits centred.
 */

/** A rectangle in container coordinates. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Width and height only. */
export interface Size {
  width: number
  height: number
}

/** A point in container coordinates. */
export interface Point {
  x: number
  y: number
}

/** V0's fixed card width in px. */
export const CARD_WIDTH = 330
/** Padding between the target and the spotlight edge. */
export const HOLE_PAD = 6
/** Spotlight corner radius. */
export const HOLE_RADIUS = 10
const GAP = 16
const MARGIN = 20

/**
 * Choose the card origin for one step.
 * @param card - measured card size.
 * @param spotlight - the spotlight rectangle, or null for the opening card.
 * @param container - the overlay's size.
 * @returns the card's top-left corner.
 */
export function placeCard(card: Size, spotlight: Rect | null, container: Size): Point {
  if (spotlight === null) {
    return {
      x: (container.width - card.width) / 2,
      y: (container.height - card.height) / 2,
    }
  }
  const maxX = spotlight.x + spotlight.width
  const maxY = spotlight.y + spotlight.height
  const midX = spotlight.x + spotlight.width / 2
  const fitsRight = maxX + GAP + card.width <= container.width - MARGIN
  const fitsLeft = spotlight.x - GAP - card.width >= MARGIN
  const fitsAbove = spotlight.y - GAP - card.height >= MARGIN

  let x: number
  let y: number
  if (fitsRight) {
    x = maxX + GAP
    y = spotlight.y
  } else if (fitsLeft) {
    x = spotlight.x - GAP - card.width
    y = spotlight.y
  } else if (fitsAbove) {
    x = midX - card.width / 2
    y = spotlight.y - GAP - card.height
  } else {
    x = midX - card.width / 2
    y = maxY + GAP
  }
  return {
    x: clamp(x, card.width, container.width),
    y: clamp(y, card.height, container.height),
  }
}

/**
 * Pin a coordinate inside the container margins. A container smaller than
 * the card plus margins inverts the range; the near margin wins then.
 * @param value - proposed coordinate.
 * @param size - the card's extent on this axis.
 * @param bound - the container's extent on this axis.
 * @returns the pinned coordinate.
 */
export function clamp(value: number, size: number, bound: number): number {
  const limit = bound - size - MARGIN
  if (limit <= MARGIN) return MARGIN
  return Math.min(Math.max(value, MARGIN), limit)
}

/**
 * Grow a target rectangle into its spotlight.
 * @param target - the measured target.
 * @returns the padded spotlight rectangle.
 */
export function spotlightOf(target: Rect): Rect {
  return {
    x: target.x - HOLE_PAD,
    y: target.y - HOLE_PAD,
    width: target.width + HOLE_PAD * 2,
    height: target.height + HOLE_PAD * 2,
  }
}

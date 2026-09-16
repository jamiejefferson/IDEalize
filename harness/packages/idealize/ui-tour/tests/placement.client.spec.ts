import { describe, expect, it } from 'vitest'
import { clamp, placeCard, spotlightOf } from '../src/client/placement.ts'

const card = { width: 330, height: 200 }
const container = { width: 1200, height: 800 }

describe('placeCard', () => {
  it('centres the opening card when there is no spotlight', () => {
    expect(placeCard(card, null, container)).toEqual({ x: 435, y: 300 })
  })

  it('parks right of a target when it fits', () => {
    expect(placeCard(card, { x: 10, y: 40, width: 200, height: 600 }, container)).toEqual({ x: 226, y: 40 })
  })

  it('falls back to the left when the right edge is too close', () => {
    expect(placeCard(card, { x: 900, y: 40, width: 280, height: 600 }, container)).toEqual({ x: 554, y: 40 })
  })

  it('centres above a full-width target at the bottom', () => {
    const origin = placeCard(card, { x: 0, y: 740, width: 1200, height: 50 }, container)
    expect(origin).toEqual({ x: 435, y: 524 })
  })

  it('goes below when nothing else fits', () => {
    const origin = placeCard(card, { x: 0, y: 10, width: 1200, height: 50 }, container)
    expect(origin).toEqual({ x: 435, y: 76 })
  })

  it('clamps a card that would hang off the bottom', () => {
    const origin = placeCard(card, { x: 10, y: 700, width: 200, height: 90 }, container)
    expect(origin.y).toBe(580)
  })
})

describe('clamp', () => {
  it('pins to the near margin when the container is smaller than the card', () => {
    expect(clamp(100, 330, 300)).toBe(20)
  })
})

describe('spotlightOf', () => {
  it('pads the target on every side', () => {
    expect(spotlightOf({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 4, y: 14, width: 42, height: 52 })
  })
})

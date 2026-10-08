// The owl's idle moves start and end on its resting frame, so any of them can
// play at any moment without a jump, and every frame exists.
import { describe, expect, it } from 'vitest'
import { AMBIENT, AMBIENT_WEIGHTS, pickAmbient, POSES } from '../src/client/owl.ts'

const REST = POSES.idle.frames[0]

describe('ambient owl moves', () => {
  it('start and end on the resting frame and stay inside the 42 frames', () => {
    for (const [name, move] of Object.entries(AMBIENT)) {
      expect(move.frames[0], name).toBe(REST)
      expect(move.frames.at(-1), name).toBe(REST)
      for (const frame of move.frames) expect(frame >= 0 && frame < 42, `${name} ${String(frame)}`).toBe(true)
    }
  })

  it('pick by weight, blinks commonest, and the weights cover the whole roll', () => {
    expect(AMBIENT_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0)).toBeCloseTo(1)
    expect(pickAmbient(0)).toBe('blink')
    expect(pickAmbient(0.5)).toBe('look')
    expect(pickAmbient(0.999)).toBe('stretch')
  })
})

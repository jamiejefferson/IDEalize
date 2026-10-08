// The owl's one-pointer gestures: drag past 4 px, hold past 250 ms, click
// at once, and a second click inside 300 ms adds the double-click.
import { describe, expect, it } from 'vitest'
import { Gestures, type GestureEffect, type Timers } from '../src/client/gestures.ts'

function bench() {
  let now = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  let next = 1
  const clock: Timers = {
    set: (run, ms) => {
      const id = next++
      timers.set(id, { at: now + ms, run })
      return id
    },
    clear: (id) => { timers.delete(id as number) },
    now: () => now,
  }
  const effects: GestureEffect['kind'][] = []
  const gestures = new Gestures((effect) => { effects.push(effect.kind) }, clock)
  const advance = (ms: number) => {
    now += ms
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id)
        timer.run()
      }
    }
  }
  return { gestures, effects, advance }
}

describe('Gestures', () => {
  it('clicks at once and adds a double-click for a quick second click', () => {
    const { gestures, effects, advance } = bench()
    gestures.down(0, 0)
    advance(80)
    gestures.up()
    expect(effects).toEqual(['click'])
    advance(120)
    gestures.down(0, 0)
    advance(60)
    gestures.up()
    expect(effects).toEqual(['click', 'double-click'])
  })

  it('holds after 250 ms without moving', () => {
    const { gestures, effects, advance } = bench()
    gestures.down(10, 10)
    advance(249)
    expect(effects).toEqual([])
    advance(1)
    gestures.move(12, 11)
    advance(2000)
    gestures.up()
    expect(effects).toEqual(['hold-start', 'hold-end'])
  })

  it('drags once the pointer moves more than 4 px, and never holds', () => {
    const { gestures, effects, advance } = bench()
    gestures.down(0, 0)
    gestures.move(3, 0)
    expect(effects).toEqual([])
    gestures.move(5, 0)
    advance(1000)
    gestures.up()
    expect(effects).toEqual(['drag-start', 'drag-end'])
  })

  it('ends a hold when the pointer is lost', () => {
    const { gestures, effects, advance } = bench()
    gestures.down(0, 0)
    advance(300)
    gestures.cancel()
    expect(effects).toEqual(['hold-start', 'hold-end'])
  })
})

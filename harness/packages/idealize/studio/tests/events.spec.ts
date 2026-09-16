/** The Studio vocabulary: the two branded ids and the kinds the wire accepts. */

import { describe, expect, it } from 'vitest'
import { STUDIO_EVENT_KINDS, StudioEventId, StudioTaskId } from '../src/events.ts'

describe('the Studio ids', () => {
  it('brand a raw string without changing it', () => {
    expect(StudioEventId('e-1')).toBe('e-1')
    expect(StudioTaskId('t-1')).toBe('t-1')
  })
})

describe('the event kinds', () => {
  it('are the closed set the timeline reads', () => {
    expect([...STUDIO_EVENT_KINDS]).toEqual([
      'message', 'assignment', 'task-update', 'request', 'decision',
      'handoff', 'delivery', 'synthesis', 'system',
    ])
  })
})

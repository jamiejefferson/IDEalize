/**
 * The space and brain projection units as pure mathematics: what each fold
 * keeps, what it ignores by reference, and what the view serves.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import {
  brainProjectionDefinition,
  foldBrain,
  foldSpace,
  resolveSessionSpace,
  spaceProjectionDefinition,
} from '../src/projection.ts'

function event(type: SessionEvent['type'], data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

function header(agentPreset?: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('spaces-spec'),
    createdAt: 1,
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

function fold<S>(unit: { init(): S; apply(state: S, event: SessionEvent): S }, events: SessionEvent[]): S {
  return events.reduce((state, next) => unit.apply(state, next), unit.init())
}

describe('the space projection', () => {
  it('serves the recorded space, latest wins', () => {
    const state = fold(spaceProjectionDefinition, [
      event('idealize/space', { space: 'gallery' }, 0),
      event('idealize/space', { space: 'motion' }, 1),
    ])
    expect(spaceProjectionDefinition.view(state)).toEqual({ space: 'motion' })
  })

  it('serves Chat for a log with nothing to go on, so the sidebar lane always has a glyph', () => {
    expect(spaceProjectionDefinition.view(spaceProjectionDefinition.init())).toEqual({ space: 'chat' })
  })

  it('recognises a legacy media chat by its logged preset selection', () => {
    const state = fold(spaceProjectionDefinition, [
      event('agent-preset/selected', { agentPreset: 'soundstage' }, 0),
    ])
    expect(spaceProjectionDefinition.view(state)).toEqual({ space: 'soundstage' })
  })

  it('lets a recorded space override a later preset selection, newest evidence first', () => {
    const state = fold(spaceProjectionDefinition, [
      event('idealize/space', { space: 'terminal' }, 0),
      event('agent-preset/selected', { agentPreset: 'gallery' }, 1),
    ])
    expect(spaceProjectionDefinition.view(state)).toEqual({ space: 'terminal' })
  })

  it('returns the same state reference for an event it does not own, and for one that changes nothing', () => {
    const state = spaceProjectionDefinition.init()
    expect(spaceProjectionDefinition.apply(state, event('turn/start', { turn: 1 }, 0))).toBe(state)
    const recorded = spaceProjectionDefinition.apply(state, event('idealize/space', { space: 'gallery' }, 1))
    expect(spaceProjectionDefinition.apply(recorded, event('idealize/space', { space: 'gallery' }, 2))).toBe(recorded)
    const picked = spaceProjectionDefinition.apply(recorded, event('agent-preset/selected', { agentPreset: 'gallery' }, 3))
    expect(spaceProjectionDefinition.apply(picked, event('agent-preset/selected', { agentPreset: 'gallery' }, 4))).toBe(picked)
  })

  it('validates its wire payload against the declared ids', () => {
    expect(spaceProjectionDefinition.schema.parse({ space: 'chat' })).toEqual({ space: 'chat' })
    expect(() => spaceProjectionDefinition.schema.parse({ space: 'trajectory' })).toThrow()
  })
})

describe('the brain projection', () => {
  it('serves the recorded brain, latest wins, and nothing before the first one', () => {
    expect(brainProjectionDefinition.view(brainProjectionDefinition.init())).toEqual({})
    const state = fold(brainProjectionDefinition, [
      event('idealize/brain', { brain: 'coding' }, 0),
      event('idealize/brain', { brain: 'design', instructions: 'Say less.' }, 1),
    ])
    expect(brainProjectionDefinition.view(state)).toEqual({ brain: 'design' })
  })

  it('returns the same state reference for an event it does not own, and for one that changes nothing', () => {
    const state = brainProjectionDefinition.init()
    expect(brainProjectionDefinition.apply(state, event('idealize/space', { space: 'chat' }, 0))).toBe(state)
    const recorded = brainProjectionDefinition.apply(state, event('idealize/brain', { brain: 'coding' }, 1))
    expect(brainProjectionDefinition.apply(recorded, event('idealize/brain', { brain: 'coding' }, 2))).toBe(recorded)
  })
})

describe('reading a log directly', () => {
  it('folds the latest recorded space and brain, or nothing', () => {
    const events = [
      event('idealize/space', { space: 'chat' }, 0),
      event('idealize/brain', { brain: 'coding' }, 1),
      event('idealize/space', { space: 'gallery' }, 2),
    ]
    expect(foldSpace(events)).toBe('gallery')
    expect(foldBrain(events)).toBe('coding')
    expect(foldSpace([])).toBeUndefined()
    expect(foldBrain([])).toBeUndefined()
  })

  it('skips a recorded value this build does not declare', () => {
    expect(foldSpace([event('idealize/space', { space: 'trajectory' }, 0)])).toBeUndefined()
  })

  it('resolves a whole session, counting the creation header the fold cannot see', () => {
    expect(resolveSessionSpace({ header: header('gallery'), events: [] })).toBe('gallery')
    expect(resolveSessionSpace({ header: header('coding'), events: [] })).toBe('chat')
    expect(resolveSessionSpace({
      header: header('gallery'),
      events: [event('idealize/space', { space: 'terminal' }, 0)],
    })).toBe('terminal')
  })
})

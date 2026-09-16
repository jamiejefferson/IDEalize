/**
 * The space roster payload: the brain counts a tile reads, the models verdict
 * only the brain step reads, and the field split that keeps every tile live.
 */

import { describe, expect, it } from 'vitest'
import { MEDIA_PRESETS } from '@idealize/generate'
import type { GenerationAvailability } from '@idealize/generate'
import {
  brainPresets,
  chatModelResolves,
  ROSTER_PATH,
  spaceCapabilityRequirements,
  spaceRoster,
  type RosterPreset,
  type SpaceRosterEntry,
  type SpaceRosterFacts,
} from '../src/roster.ts'

const AVAILABLE: GenerationAvailability = { state: 'available', backends: ['fixture'], models: 1 }
const NO_MODEL: GenerationAvailability = {
  state: 'unavailable',
  reason: 'no-compatible-model',
  recovery: 'Store the provider API key in Settings.',
  keyMissing: true,
}

/** Presets authored into the writable root: the brains. */
function user(...ids: string[]): RosterPreset[] {
  return ids.map(id => ({ id, name: id, trust: 'user' as const }))
}

/** Facts with every space serviceable, so each test varies one thing. */
function facts(overrides: Partial<SpaceRosterFacts> = {}): SpaceRosterFacts {
  return {
    presets: [],
    rolePresets: ['lead-agent', 'project-agent'],
    storedSpaces: {},
    storedModels: {},
    defaultPreset: 'standard',
    mediaAvailability: { images: AVAILABLE, sound: AVAILABLE, motion: AVAILABLE },
    chatModel: true,
    desktopShell: true,
    ...overrides,
  }
}

function entry(roster: readonly SpaceRosterEntry[], id: string): SpaceRosterEntry {
  const found = roster.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no ${id} entry in the roster`)
  return found
}

describe('the roster payload', () => {
  it('serves every declared space in chooser order, so no space can be filtered out of the chooser', () => {
    expect(spaceRoster(facts()).map(space => space.id))
      .toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    expect(ROSTER_PATH).toBe('/idealize/spaces')
  })

  it('gives a refused space a live tile: a brain count, and the reason only on the fields step 2 reads', () => {
    const roster = spaceRoster(facts({
      presets: user('coding', 'design'),
      mediaAvailability: undefined,
    }))

    // Motion has no brains and no backend and is still an ordinary entry.
    expect(entry(roster, 'motion')).toMatchObject({ id: 'motion', brainCount: 0, models: 'none', reason: 'no-backend' })
    expect(entry(roster, 'motion').recovery).toContain('generation')
    // Nothing in the payload can dim or disable a tile: the only tile fields
    // are the id and the count, and every entry carries both.
    for (const space of roster) {
      expect(typeof space.brainCount).toBe('number')
      expect(Object.keys(space).filter(key => key !== 'id' && key !== 'brainCount'))
        .not.toContain('disabled')
    }
  })

  it('counts a brain in every space it works in, by default and by the stored map', () => {
    const roster = spaceRoster(facts({
      presets: user('coding', 'design', 'gallery', 'soundstage', 'lead-agent', 'project-agent'),
      storedSpaces: { design: ['chat', 'motion'] },
    }))

    expect(roster.map(space => [space.id, space.brainCount])).toEqual([
      // coding + design in Chat; coding alone in Terminal, because design's
      // stored list replaces the default pair.
      ['chat', 2],
      ['terminal', 1],
      ['gallery', 1],
      ['soundstage', 1],
      ['motion', 1],
    ])
  })

  it('counts the five seeded brains for Chat and four for Terminal, never the shipped presets they derive from', () => {
    const shipped = ['standard', 'code', 'minimal'].map(id => ({ id, name: id, trust: 'system' as const }))
    const roster = spaceRoster(facts({
      presets: [...shipped, ...user('coding', 'design', 'writing', 'admin', 'free', 'gallery', 'soundstage', 'video')],
    }))

    // Free runs on the free-tokens route, a chat route no CLI plays in the terminal.
    expect(roster.map(space => [space.id, space.brainCount])).toEqual([
      ['chat', 5],
      ['terminal', 4],
      ['gallery', 1],
      ['soundstage', 1],
      ['motion', 1],
    ])
    expect(entry(roster, 'chat').brains.map(brain => brain.id))
      .toEqual(['coding', 'design', 'writing', 'admin', 'free'])
    expect(entry(roster, 'terminal').brains.map(brain => brain.id))
      .toEqual(['coding', 'design', 'writing', 'admin'])
    expect(entry(roster, 'motion').brains).toEqual([{ id: 'video', name: 'video', default: true }])
  })

  it('keeps a system preset out of the brains even when the deployment default names it', () => {
    expect(brainPresets([
      { id: 'standard', name: 'Standard', trust: 'system' },
      { id: 'coding', name: 'Coding', trust: 'user' },
    ]).map(preset => preset.id)).toEqual(['coding'])

    const roster = spaceRoster(facts({
      presets: [{ id: 'standard', name: 'Standard', trust: 'system' }, ...user('coding')],
      defaultPreset: 'standard',
    }))
    // Nothing on the chat entry names the shipped preset, and the one brain
    // there carries the default mark instead.
    expect(entry(roster, 'chat').brains).toEqual([{ id: 'coding', name: 'coding', default: true }])
  })

  it('lists the brains of a space with their names, their own model, and one default mark', () => {
    const roster = spaceRoster(facts({
      presets: [
        { id: 'coding', name: 'Coding', trust: 'user' },
        { id: 'design', name: 'Design', trust: 'user' },
        { id: 'gallery', name: 'Gallery', trust: 'user' },
      ],
      storedModels: { design: { provider: 'openai', model: 'gpt-5' } },
      defaultPreset: 'design',
    }))

    expect(entry(roster, 'chat').brains).toEqual([
      { id: 'coding', name: 'Coding' },
      { id: 'design', name: 'Design', model: { provider: 'openai', model: 'gpt-5' }, default: true },
    ])
    // A space that declares its own agent marks that one, whatever the roster
    // default is.
    expect(entry(roster, 'gallery').brains).toEqual([{ id: 'gallery', name: 'Gallery', default: true }])
  })

  it('keeps the brain list and the tile count in step for every space', () => {
    const roster = spaceRoster(facts({ presets: user('coding', 'design', 'gallery') }))
    for (const space of roster) expect(space.brains).toHaveLength(space.brainCount)
  })

  it('counts no space for a brain carrying an agent role', () => {
    const roster = spaceRoster(facts({ presets: user('lead-agent', 'project-agent') }))
    expect(roster.every(space => space.brainCount === 0)).toBe(true)
  })

  it('states no model for Chat when nothing resolves, and says so once with a way forward', () => {
    const roster = spaceRoster(facts({ chatModel: false, presets: user('coding') }))
    expect(entry(roster, 'chat')).toMatchObject({ id: 'chat', brainCount: 1, models: 'none', reason: 'no-model' })
    expect(entry(roster, 'chat').recovery).toContain('Settings')
  })

  it('states where the terminal runs when the desktop shell is absent, and keeps its brains counted', () => {
    const browser = entry(spaceRoster(facts({ presets: user('coding'), desktopShell: false })), 'terminal')
    expect(browser).toEqual({
      id: 'terminal',
      brainCount: 1,
      brains: [{ id: 'coding', name: 'coding', default: true }],
      models: 'none',
      reason: 'desktop-only',
      recovery: 'The terminal runs in the IDEalize desktop app. Open IDEalize there to use it.',
    })

    const desktop = entry(spaceRoster(facts({ presets: user('coding') })), 'terminal')
    expect(desktop).toEqual({
      id: 'terminal',
      brainCount: 1,
      brains: [{ id: 'coding', name: 'coding', default: true }],
      models: 'some',
    })
  })

  it('passes the generation seam its own reason and recovery through unchanged', () => {
    const roster = spaceRoster(facts({
      mediaAvailability: { images: AVAILABLE, sound: NO_MODEL, motion: NO_MODEL },
    }))

    expect(entry(roster, 'gallery')).toEqual({ id: 'gallery', brainCount: 0, brains: [], models: 'some' })
    expect(entry(roster, 'soundstage')).toMatchObject({
      models: 'none',
      reason: 'no-compatible-model',
      recovery: NO_MODEL.recovery,
      keyMissing: true,
    })
    // A connected catalogue with nothing for the artefact says so, and a
    // verdict that names no key fact adds none.
    const connected = spaceRoster(facts({
      mediaAvailability: { motion: { ...NO_MODEL, keyMissing: false }, sound: { state: 'unavailable', reason: 'no-backend', recovery: 'x' } },
    }))
    expect(entry(connected, 'motion').keyMissing).toBe(false)
    expect('keyMissing' in entry(connected, 'soundstage')).toBe(false)
  })

  it('reads a capability the generation service reported nothing for as no backend', () => {
    const roster = spaceRoster(facts({ mediaAvailability: { images: AVAILABLE } }))
    expect(entry(roster, 'motion')).toMatchObject({ models: 'none', reason: 'no-backend' })
  })
})

describe('whether a chat model resolves', () => {
  it('accepts the deployment default model', () => {
    expect(chatModelResolves({ defaultModel: { provider: 'deepseek-official', model: 'deepseek-chat' } })).toBe(true)
  })

  it('accepts the free route when it publishes a model', () => {
    expect(chatModelResolves({ llm: { providers: { freetokens: { models: [{ id: 'free-1' }] } } } })).toBe(true)
    expect(chatModelResolves({ llm: { providers: { freetokens: { models: [{}] } } } })).toBe(false)
    expect(chatModelResolves({ llm: { providers: { 'deepseek-official': { models: [{ id: 'x' }] } } } })).toBe(false)
  })

  it('accepts a brain that overrides its own model', () => {
    expect(chatModelResolves({ activity: { models: { coding: { provider: 'openai', model: 'gpt-5' } } } })).toBe(true)
  })

  it('refuses an empty or malformed default and an empty deployment', () => {
    expect(chatModelResolves({})).toBe(false)
    expect(chatModelResolves({ defaultModel: { provider: '', model: 'x' } })).toBe(false)
    expect(chatModelResolves({ defaultModel: { provider: 'openai', model: 7 } })).toBe(false)
    expect(chatModelResolves({ activity: { models: {} }, llm: { providers: {} } })).toBe(false)
  })
})

describe('the media capability lookup', () => {
  it('resolves one requirement set per media space from the declared media presets', () => {
    const resolved = spaceCapabilityRequirements(MEDIA_PRESETS)
    expect([...resolved.keys()].sort()).toEqual(['images', 'motion', 'sound'])
    expect(resolved.get('motion')).toEqual([{ operation: 'generate', artefact: 'video', inputModalities: ['text'] }])
  })

  it('refuses at load when a space names a media preset nothing declares', () => {
    expect(() => spaceCapabilityRequirements([])).toThrow(/space 'gallery' names media preset 'images'/)
  })
})

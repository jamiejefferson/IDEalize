/**
 * The declared space table, the legacy-derivation ladder on all three
 * branches, and the per-brain space defaults.
 */

import { describe, expect, it } from 'vitest'
import {
  CHAT_ONLY_PRESETS,
  DEFAULT_SPACE,
  deriveSpace,
  isSpaceId,
  LAUNCHABLE_SPACE_IDS,
  presetSpaces,
  RETIRED_ROLE_PRESETS,
  SPACE_IDS,
  SPACES,
  spaceById,
} from '../src/space-table.ts'

describe('the declared space table', () => {
  it('declares the six spaces in chooser order, one row each, Studio last and unlaunchable', () => {
    expect(SPACES.map(space => space.id)).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion', 'studio'])
    expect(LAUNCHABLE_SPACE_IDS).toEqual(['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
    expect(spaceById('studio')).toMatchObject({ launchable: false, composition: 'standard' })
    expect(SPACES.map(space => space.id)).toEqual([...SPACE_IDS])
    for (const id of SPACE_IDS) expect(spaceById(id).id).toBe(id)
  })

  it('gives every generating space its seeded agent: Gallery, Sound Stage, and Video for Motion', () => {
    expect(SPACES.filter(space => space.composition === 'media').map(space => [space.id, space.agentPreset])).toEqual([
      ['gallery', 'gallery'],
      ['soundstage', 'soundstage'],
      ['motion', 'video'],
    ])
    expect(spaceById('motion')).toMatchObject({ capability: 'motion', composition: 'media', agentPreset: 'video' })
    expect(spaceById('chat').agentPreset).toBeUndefined()
    expect(spaceById('terminal').agentPreset).toBeUndefined()
  })

  it('names the media capability per space and none for Chat, Terminal and Studio', () => {
    expect(SPACES.map(space => [space.id, space.capability])).toEqual([
      ['chat', undefined],
      ['terminal', undefined],
      ['gallery', 'images'],
      ['soundstage', 'sound'],
      ['motion', 'motion'],
      ['studio', undefined],
    ])
  })

  it('gives Chat, Terminal and Studio the standard composition and the media spaces the media one', () => {
    expect(SPACES.filter(space => space.composition === 'standard').map(space => space.id))
      .toEqual(['chat', 'terminal', 'studio'])
    expect(SPACES.filter(space => space.composition === 'media').map(space => space.id))
      .toEqual(['gallery', 'soundstage', 'motion'])
  })

  it('gives every space its own label and glyph key', () => {
    expect(new Set(SPACES.map(space => space.labelKey)).size).toBe(SPACES.length)
    expect(new Set(SPACES.map(space => space.iconKey)).size).toBe(SPACES.length)
  })

  it('recognises declared ids and refuses anything else', () => {
    expect(isSpaceId('gallery')).toBe(true)
    expect(isSpaceId('trajectory')).toBe(false)
    expect(isSpaceId(undefined)).toBe(false)
    expect(isSpaceId(7)).toBe(false)
  })

  it('refuses to serve a row for an id the table does not declare', () => {
    expect(() => spaceById('schedule' as never)).toThrow(/no declared space 'schedule'/)
  })
})

describe('the legacy-derivation ladder', () => {
  it('branch 1: a recorded space wins', () => {
    expect(deriveSpace({ space: 'terminal', agentPreset: 'gallery' })).toBe('terminal')
    expect(deriveSpace({ space: 'motion' })).toBe('motion')
  })

  it('branch 2: a media agent preset names its own space', () => {
    expect(deriveSpace({ agentPreset: 'gallery' })).toBe('gallery')
    expect(deriveSpace({ agentPreset: 'soundstage' })).toBe('soundstage')
    expect(deriveSpace({ agentPreset: 'video' })).toBe('motion')
  })

  it('branch 3: everything else reads as Chat, terminal chats included', () => {
    expect(deriveSpace({})).toBe(DEFAULT_SPACE)
    expect(deriveSpace({ agentPreset: 'coding' })).toBe('chat')
    // A pre-spaces terminal launch wrote nothing durable, so its chat is a
    // Chat: the alternative is guessing from a per-machine browser store.
    expect(deriveSpace({ agentPreset: 'standard' })).toBe('chat')
  })

  it('ignores a recorded value this build does not declare rather than projecting it', () => {
    expect(deriveSpace({ space: 'trajectory' as never, agentPreset: 'gallery' })).toBe('gallery')
  })
})

describe('which spaces a brain works in', () => {
  const roles = ['lead-agent', 'project-agent']

  it('defaults four activity brains to Chat and Terminal', () => {
    for (const id of ['coding', 'design', 'writing', 'admin']) {
      expect(presetSpaces(id, roles)).toEqual(['chat', 'terminal'])
    }
  })

  it('keeps Free in Chat alone, whatever list is stored: no CLI plays the free-tokens route in the terminal', () => {
    expect(CHAT_ONLY_PRESETS).toEqual(['free'])
    expect(presetSpaces('free', roles)).toEqual(['chat'])
    expect(presetSpaces('free', roles, ['chat', 'terminal'])).toEqual(['chat'])
    expect(presetSpaces('free', roles, ['gallery'])).toEqual(['chat'])
  })

  it('defaults a media agent to its own space', () => {
    expect(presetSpaces('gallery', roles)).toEqual(['gallery'])
    expect(presetSpaces('soundstage', roles)).toEqual(['soundstage'])
    expect(presetSpaces('video', roles)).toEqual(['motion'])
  })

  it('reads a stored list back without Studio, which no brain works in', () => {
    expect(presetSpaces('design', roles, ['studio', 'chat'])).toEqual(['chat'])
  })

  it('defaults an agent role to no space', () => {
    expect(presetSpaces('lead-agent', roles)).toEqual([])
    // The retired lead preset stays opt-in even when no live role names it.
    expect(presetSpaces('lead-agent', RETIRED_ROLE_PRESETS)).toEqual([])
    expect(presetSpaces('lead-agent', RETIRED_ROLE_PRESETS, ['chat'])).toEqual(['chat'])
    expect(presetSpaces('project-agent', roles)).toEqual([])
  })

  it('takes a stored list over the default, in table order, dropping undeclared ids', () => {
    expect(presetSpaces('coding', roles, ['motion', 'chat', 'trajectory'])).toEqual(['chat', 'motion'])
    expect(presetSpaces('gallery', roles, [])).toEqual([])
  })
})

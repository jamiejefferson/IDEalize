import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import GenerationRuntime, {
  applyMediaSelection,
  MEDIA_PRESET_IDS,
  MEDIA_PRESETS,
  mediaPresetStates,
  parseMediaSelection,
  presetIdForSpace,
  storedMediaModel,
} from '../src/index.ts'
import type { GenerationBackend, GenerationQueries, GenModelInfo } from '../src/index.ts'

describe('MEDIA_PRESETS', () => {
  it('declares the three default media presets in roster order', () => {
    expect(MEDIA_PRESET_IDS).toEqual(['images', 'motion', 'sound'])
  })

  it('declares task intent and required capabilities per preset, matching the artefact', () => {
    for (const preset of MEDIA_PRESETS) {
      expect(preset.taskIntent).toMatch(/^generate-/)
      expect(preset.requiredCapabilities.length).toBeGreaterThan(0)
      for (const capability of preset.requiredCapabilities) {
        expect(capability.operation).toBe('generate')
        expect(capability.artefact).toBe(preset.artefactType)
        expect(capability.inputModalities).toContain('text')
      }
    }
  })

  it('contains capability identifiers only — no provider or model ids (AC-14)', () => {
    const source = JSON.stringify(MEDIA_PRESETS)
    expect(source).not.toMatch(/openrouter|fixture|gpt|lyria|flux|gemini/i)
    expect(source).not.toMatch(/\w+\/\w+/)
  })
})

describe('presetIdForSpace', () => {
  it('maps each generating space, and each preset id, to the preset the chosen model is stored under', () => {
    expect(presetIdForSpace('gallery')).toBe('images')
    expect(presetIdForSpace('soundstage')).toBe('sound')
    expect(presetIdForSpace('motion')).toBe('motion')
    expect(presetIdForSpace('video')).toBe('motion')
    expect(presetIdForSpace('images')).toBe('images')
    expect(presetIdForSpace('chat')).toBeUndefined()
    expect(presetIdForSpace('')).toBeUndefined()
  })
})

describe('storedMediaModel', () => {
  it('reads a stored {provider, model} entry as a backend ref', () => {
    expect(storedMediaModel({ models: { sound: { provider: 'openrouter', model: 'a/b' } } }, 'sound'))
      .toEqual({ backend: 'openrouter', model: 'a/b' })
  })

  it('returns null for absent sections, absent entries, and malformed entries', () => {
    expect(storedMediaModel(undefined, 'sound')).toBeNull()
    expect(storedMediaModel({}, 'sound')).toBeNull()
    expect(storedMediaModel({ models: { sound: { provider: '', model: 'x' } } }, 'sound')).toBeNull()
    expect(storedMediaModel({ models: { sound: { provider: 'p' } } }, 'sound')).toBeNull()
  })
})

describe('parseMediaSelection', () => {
  it('refuses non-object bodies and unknown preset ids', () => {
    expect(parseMediaSelection('nope')).toMatchObject({ ok: false })
    expect(parseMediaSelection({ id: 'coding', model: null })).toMatchObject({ ok: false })
  })

  it('accepts a null model as a clear', () => {
    expect(parseMediaSelection({ id: 'images', model: null })).toEqual({ ok: true, id: 'images', model: null })
    expect(parseMediaSelection({ id: 'images' })).toEqual({ ok: true, id: 'images', model: null })
  })

  it('refuses malformed model refs and accepts {backend, model}', () => {
    expect(parseMediaSelection({ id: 'sound', model: 'a/b' })).toMatchObject({ ok: false })
    expect(parseMediaSelection({ id: 'sound', model: { backend: '', model: 'x' } })).toMatchObject({ ok: false })
    expect(parseMediaSelection({ id: 'sound', model: { backend: 'openrouter', model: 'a/b' } }))
      .toEqual({ ok: true, id: 'sound', model: { backend: 'openrouter', model: 'a/b' } })
  })
})

describe('applyMediaSelection', () => {
  const section = {
    models: {
      coding: { provider: 'deepseek-official', model: 'deepseek-chat' },
      sound: { provider: 'openrouter', model: 'old/audio' },
      broken: { provider: 42, model: 'x' },
    },
  }

  it('replaces the edited id and keeps every other well-formed entry', () => {
    expect(applyMediaSelection(section, 'sound', { backend: 'openrouter', model: 'new/audio' })).toEqual({
      coding: { provider: 'deepseek-official', model: 'deepseek-chat' },
      sound: { provider: 'openrouter', model: 'new/audio' },
    })
  })

  it('clears the entry on a null choice', () => {
    expect(applyMediaSelection(section, 'sound', null)).toEqual({
      coding: { provider: 'deepseek-official', model: 'deepseek-chat' },
    })
  })

  it('starts from empty when no section is registered', () => {
    expect(applyMediaSelection(undefined, 'images', { backend: 'fixture', model: 'fixture-still' })).toEqual({
      images: { provider: 'fixture', model: 'fixture-still' },
    })
  })
})

describe('mediaPresetStates', () => {
  function fakeQueries(catalog: { backend: string; model: GenModelInfo }[]): GenerationQueries {
    return {
      compatible: requirements => catalog.filter(entry =>
        requirements.every(requirement =>
          entry.model.artefact === requirement.artefact
          && requirement.inputModalities.every(m => entry.model.inputModalities.includes(m)))),
      availability: () => ({ state: 'unavailable', reason: 'no-backend', recovery: 'register an adapter' }),
    }
  }

  it('pairs each preset with its stored choice and filtered candidates', () => {
    const tone: GenModelInfo = {
      id: 'tone', name: 'tone', artefact: 'audio', inputModalities: ['text'], outputMediaTypes: ['audio/wav'],
    }
    const states = mediaPresetStates(
      fakeQueries([{ backend: 'fx', model: tone }]),
      { models: { sound: { provider: 'fx', model: 'tone' } } },
    )
    expect(states.map(state => state.id)).toEqual(['images', 'motion', 'sound'])
    const sound = states[2]!
    expect(sound.model).toEqual({ backend: 'fx', model: 'tone' })
    expect(sound.candidates.map(entry => entry.model.id)).toEqual(['tone'])
    expect(states[0]!.candidates).toHaveLength(0)
    expect(states[0]!.model).toBeNull()
    expect(states[0]!.availability.state).toBe('unavailable')
  })
})

describe('media presets against the live runtime', () => {
  it('surfaces registered backend models as candidates per preset', async () => {
    const ctx = new Context()
    await ctx.plugin(GenerationRuntime)
    const audio: GenerationBackend = {
      id: 'fx',
      describe: () => [],
      models: () => [{ id: 'tone', name: 'tone', artefact: 'audio', inputModalities: ['text'], outputMediaTypes: ['audio/wav'] }],
      generate: () => Promise.reject(new Error('unused')),
    }
    ctx.generation.register(audio)
    const states = mediaPresetStates(ctx.generation, undefined)
    expect(states.find(state => state.id === 'sound')?.candidates.map(entry => entry.model.id)).toEqual(['tone'])
    expect(states.find(state => state.id === 'images')?.availability).toMatchObject({
      state: 'unavailable',
      reason: 'no-compatible-model',
    })
  })
})

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import GenerationRuntime, { GENERATION_SCHEMA_VERSION, MEDIA_PRESETS, mediaPresetStates } from '@idealize/generate'
import type { GenerationProgress, GenerationRequest } from '@idealize/generate'
import * as GenFixture from '../src/index.ts'

async function mount(models?: GenFixture.FixtureModel[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(GenerationRuntime)
  await ctx.plugin(GenFixture, models === undefined ? {} : { models })
  return ctx
}

function request(model: string, artefact: 'image' | 'audio' | 'video'): GenerationRequest {
  return {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    taskIntent: `generate-${artefact}`,
    requiredCapabilities: [{ operation: 'generate', artefact, inputModalities: ['text'] }],
    model: { backend: 'fixture', model },
    prompt: 'anything',
  }
}

describe('gen-fixture', () => {
  it('AC-13: a fixture model becomes selectable for its preset with zero mode-code change', async () => {
    const ctx = await mount([
      { id: 'fixture-still', artefact: 'image' },
      { id: 'fixture-tone', artefact: 'audio' },
    ])
    const states = mediaPresetStates(ctx.generation, undefined)
    expect(states.find(state => state.id === 'images')?.candidates.map(entry => entry.model.id))
      .toEqual(['fixture-still'])
    expect(states.find(state => state.id === 'sound')?.candidates.map(entry => entry.model.id))
      .toEqual(['fixture-tone'])
    // The presets themselves still contain capability identifiers only.
    expect(JSON.stringify(MEDIA_PRESETS)).not.toContain('fixture-still')
  })

  it('publishes one capability descriptor per artefact, available without credentials', async () => {
    const ctx = await mount([
      { id: 'fixture-still', artefact: 'image' },
      { id: 'fixture-clip', artefact: 'video' },
    ])
    const backend = GenFixture.createFixtureBackend({
      models: [{ id: 'fixture-still', artefact: 'image' }, { id: 'fixture-clip', artefact: 'video' }],
    })
    expect(backend.describe().map(descriptor => `${descriptor.artefact}:${descriptor.availability}`).sort())
      .toEqual(['image:available', 'video:available'])
    expect(ctx.generation.availability(MEDIA_PRESETS[1]!.requiredCapabilities)).toMatchObject({ state: 'available' })
  })

  it('generates the fixed payload per artefact with ordered progress', async () => {
    const ctx = await mount()
    const phases: GenerationProgress['phase'][] = []
    const result = await ctx.generation.generate(request('fixture-still', 'image'), progress => phases.push(progress.phase))
    expect(result.outputs[0]!.mediaType).toBe('image/png')
    expect(result.outputs[0]!.data.length).toBeGreaterThan(0)
    expect(phases).toEqual(['queued', 'sending', 'done'])
  })

  it('rejects an aborted generation with ABORTED', async () => {
    const ctx = await mount()
    const controller = new AbortController()
    controller.abort()
    const failure = await ctx.generation
      .generate(request('fixture-still', 'image'), undefined, controller.signal)
      .catch((error: unknown) => error)
    expect((failure as { code?: string }).code).toBe('ABORTED')
  })

  it('removes its capability when the registering scope is disposed (AC-15 path)', async () => {
    const ctx = new Context()
    await ctx.plugin(GenerationRuntime)
    const scope = await ctx.plugin(GenFixture, { models: [{ id: 'fixture-tone', artefact: 'audio' as const }] })
    expect(ctx.generation.availability(MEDIA_PRESETS[2]!.requiredCapabilities)).toMatchObject({ state: 'available' })
    await scope.dispose()
    const verdict = ctx.generation.availability(MEDIA_PRESETS[2]!.requiredCapabilities)
    expect(verdict).toMatchObject({ state: 'unavailable', reason: 'no-backend' })
    expect(verdict.state === 'unavailable' && verdict.recovery.length > 0).toBe(true)
  })
})

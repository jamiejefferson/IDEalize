/** The fixture backend's edges: an empty model list, and a model nobody offers. */

import { describe, expect, it } from 'vitest'
import { createFixtureBackend } from '../src/index.ts'

describe('the fixture backend', () => {
  it('offers nothing when the composition names no models', () => {
    const backend = createFixtureBackend({})
    expect(backend.id).toBe('fixture')
    expect(backend.models()).toEqual([])
    expect(backend.describe()).toEqual([])
  })

  it('refuses a model it does not offer', async () => {
    const backend = createFixtureBackend({ backendId: 'stub', models: [{ id: 'still', artefact: 'image' }] })
    await expect(backend.generate(
      { model: { backend: 'stub', model: 'moving' } } as never,
      () => {},
      new AbortController().signal,
    )).rejects.toThrow('fixture backend "stub" offers no model "moving"')
  })
})

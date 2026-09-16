import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import GenerationRuntime, {
  GENERATION_SCHEMA_VERSION,
  GenerationError,
  isGenerationError,
  satisfies,
  satisfiesAll,
} from '../src/index.ts'
import type {
  CapabilityRequirement,
  GenerationBackend,
  GenerationRequest,
  GenerationResult,
  GenModelInfo,
} from '../src/index.ts'

function model(overrides: Partial<GenModelInfo> = {}): GenModelInfo {
  return {
    id: 'test-model',
    name: 'Test model',
    artefact: 'image',
    inputModalities: ['text'],
    outputMediaTypes: ['image/png'],
    ...overrides,
  }
}

function requirement(overrides: Partial<CapabilityRequirement> = {}): CapabilityRequirement {
  return { operation: 'generate', artefact: 'image', inputModalities: ['text'], ...overrides }
}

function result(backend: string, id: string): GenerationResult {
  return {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    backend,
    model: id,
    artefact: 'image',
    outputs: [{ mediaType: 'image/png', data: 'AAAA' }],
    timestamp: 1,
  }
}

function backend(
  id: string,
  models: GenModelInfo[],
  generate?: GenerationBackend['generate'],
): GenerationBackend {
  return {
    id,
    describe: () => [],
    models: () => models,
    generate: generate ?? (request => Promise.resolve(result(id, request.model.model))),
  }
}

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    taskIntent: 'generate-image',
    requiredCapabilities: [requirement()],
    model: { backend: 'b', model: 'test-model' },
    prompt: 'a red square',
    ...overrides,
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(GenerationRuntime)
  return ctx
}

describe('satisfies', () => {
  it('rejects an artefact mismatch', () => {
    expect(satisfies(model({ artefact: 'audio' }), requirement())).toBe(false)
  })

  it('requires every input modality', () => {
    expect(satisfies(model(), requirement({ inputModalities: ['text', 'image'] }))).toBe(false)
    expect(satisfies(model({ inputModalities: ['text', 'image'] }), requirement({ inputModalities: ['text', 'image'] }))).toBe(true)
  })

  it('accepts a model offering more modalities than required', () => {
    expect(satisfies(model({ inputModalities: ['text', 'image', 'audio'] }), requirement())).toBe(true)
  })

  it('satisfiesAll needs every requirement to hold', () => {
    const wide = model({ inputModalities: ['text', 'image'] })
    expect(satisfiesAll(wide, [requirement(), requirement({ inputModalities: ['image'] })])).toBe(true)
    expect(satisfiesAll(wide, [requirement(), requirement({ artefact: 'audio' })])).toBe(false)
  })
})

describe('GenerationRuntime registry', () => {
  it('registers backends and merges their catalogues', async () => {
    const ctx = await mount()
    ctx.generation.register(backend('b', [model()]))
    ctx.generation.register(backend('c', [model({ id: 'other', artefact: 'audio' })]))
    expect(ctx.generation.backends()).toEqual(['b', 'c'])
    expect(ctx.generation.catalog().map(entry => `${entry.backend}/${entry.model.id}`))
      .toEqual(['b/test-model', 'c/other'])
  })

  it('rejects a duplicate backend id', async () => {
    const ctx = await mount()
    ctx.generation.register(backend('b', []))
    expect(() => ctx.generation.register(backend('b', []))).toThrow(/already registered/)
  })

  it('register returns the disposer that removes the backend', async () => {
    const ctx = await mount()
    const dispose = ctx.generation.register(backend('b', [model()]))
    expect(ctx.generation.catalog()).toHaveLength(1)
    dispose()
    expect(ctx.generation.catalog()).toHaveLength(0)
    expect(ctx.generation.backends()).toHaveLength(0)
  })

  it('filters compatible models by artefact and modalities', async () => {
    const ctx = await mount()
    ctx.generation.register(backend('b', [
      model(),
      model({ id: 'img-edit', inputModalities: ['text', 'image'] }),
      model({ id: 'tone', artefact: 'audio' }),
    ]))
    const compatible = ctx.generation.compatible([requirement({ inputModalities: ['text', 'image'] })])
    expect(compatible.map(entry => entry.model.id)).toEqual(['img-edit'])
  })
})

describe('GenerationRuntime availability', () => {
  it('reports no-backend with a recovery action while nothing is registered', async () => {
    const ctx = await mount()
    const verdict = ctx.generation.availability([requirement()])
    expect(verdict).toMatchObject({ state: 'unavailable', reason: 'no-backend' })
    expect(verdict.state === 'unavailable' && verdict.recovery).toMatch(/adapter/)
  })

  it('reports no-compatible-model naming the artefact', async () => {
    const ctx = await mount()
    ctx.generation.register(backend('b', [model({ artefact: 'image' })]))
    const verdict = ctx.generation.availability([requirement({ artefact: 'audio' })])
    expect(verdict).toMatchObject({ state: 'unavailable', reason: 'no-compatible-model' })
    expect(verdict.state === 'unavailable' && verdict.recovery).toMatch(/audio/)
  })

  it('says whether a key is what is missing, from the backends\' own descriptors', async () => {
    const ctx = await mount()
    // A connected backend with nothing for audio: no key can change that.
    ctx.generation.register(backend('b', [model({ artefact: 'image' })]))
    const connected = ctx.generation.availability([requirement({ artefact: 'audio' })])
    expect(connected).toMatchObject({ state: 'unavailable', reason: 'no-compatible-model', keyMissing: false })
    expect(connected.state === 'unavailable' && connected.recovery).toBe('No connected provider offers audio generation yet.')
    // A backend describing itself as `no-credential`: storing the key is the recovery.
    const keyless = backend('k', [model({ artefact: 'image' })])
    keyless.describe = () => [{
      operation: 'generate', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/*'],
      availability: 'no-credential', schemaVersion: 1,
    }]
    const other = await mount()
    other.generation.register(keyless)
    const missing = other.generation.availability([requirement({ artefact: 'audio' })])
    expect(missing).toMatchObject({ state: 'unavailable', reason: 'no-compatible-model', keyMissing: true })
    expect(missing.state === 'unavailable' && missing.recovery).toMatch(/API key/)
  })

  it('reports availability with backend and model counts', async () => {
    const ctx = await mount()
    ctx.generation.register(backend('b', [model(), model({ id: 'second' })]))
    expect(ctx.generation.availability([requirement()]))
      .toEqual({ state: 'available', backends: ['b'], models: 2 })
  })
})

describe('GenerationRuntime.generate', () => {
  it('routes to the chosen backend with a progress sink and signal', async () => {
    const ctx = await mount()
    const seen: unknown[] = []
    ctx.generation.register(backend('b', [model()], (req, onProgress, signal) => {
      seen.push(req.model.model, typeof onProgress, signal instanceof AbortSignal)
      onProgress({ phase: 'done' })
      return Promise.resolve(result('b', req.model.model))
    }))
    const out = await ctx.generation.generate(request())
    expect(out.backend).toBe('b')
    expect(seen).toEqual(['test-model', 'function', true])
  })

  it('throws NO_ADAPTER for an unregistered backend', async () => {
    const ctx = await mount()
    const failure = await ctx.generation.generate(request()).catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('NO_ADAPTER')
  })

  it('throws NO_MODEL for a model the backend does not offer', async () => {
    const ctx = await mount()
    ctx.generation.register(backend('b', [model()]))
    const failure = await ctx.generation
      .generate(request({ model: { backend: 'b', model: 'missing' } }))
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('NO_MODEL')
  })

  it('throws INCOMPATIBLE_MODEL when required capabilities are not satisfied', async () => {
    const ctx = await mount()
    ctx.generation.register(backend('b', [model()]))
    const failure = await ctx.generation
      .generate(request({ requiredCapabilities: [requirement({ inputModalities: ['text', 'image'] })] }))
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('INCOMPATIBLE_MODEL')
  })

  it('wraps raw backend failures as PROVIDER_ERROR with the cause chained', async () => {
    const ctx = await mount()
    const raw = new Error('socket hiccup')
    ctx.generation.register(backend('b', [model()], () => Promise.reject(raw)))
    const failure = await ctx.generation.generate(request()).catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('PROVIDER_ERROR')
    expect((failure as GenerationError).cause).toBe(raw)
  })

  it('passes GenerationErrors through unchanged', async () => {
    const ctx = await mount()
    const typed = new GenerationError('slow down', 'RATE_LIMIT', { status: 429, retryAfterMs: 2000 })
    ctx.generation.register(backend('b', [model()], () => Promise.reject(typed)))
    const failure = await ctx.generation.generate(request()).catch((error: unknown) => error)
    expect(failure).toBe(typed)
    expect((failure as GenerationError).status).toBe(429)
    expect((failure as GenerationError).retryAfterMs).toBe(2000)
  })
})

describe('GenerationError', () => {
  it('carries the code and rejects nothing at construction', () => {
    const error = new GenerationError('no key', 'MISSING_CREDENTIAL')
    expect(error.code).toBe('MISSING_CREDENTIAL')
    expect(error.name).toBe('GenerationError')
    expect(isGenerationError(error)).toBe(true)
    expect(isGenerationError(new Error('plain'))).toBe(false)
  })

  it('says so when asked to refresh a backend nobody registered', async () => {
    const ctx = new Context()
    await ctx.plugin(GenerationRuntime).await()
    expect(await ctx.generation.refreshBackend('nobody')).toBe(false)
    await ctx.fiber.dispose()
  })
})

/**
 * @idealize/gen-fixture — a configurable in-memory generation backend for
 * keyless tests. Registering it makes its models selectable through the
 * generation seam and the media preset routes with zero mode-code change
 * (AC-13); `generate` returns a fixed tiny payload per artefact.
 * @module @idealize/gen-fixture
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GENERATION_SCHEMA_VERSION, GenerationError } from '@idealize/generate'
import type {
  CapabilityDescriptor,
  GenArtefact,
  GenerationBackend,
  GenModality,
  GenModelInfo,
} from '@idealize/generate'

/** 1×1 transparent PNG. */
const PNG_PIXEL
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** 44-byte silent WAV (16-bit mono, zero data frames). */
const WAV_SILENCE = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
/** A bare 24-byte `ftyp` box — enough for a media-type-correct video stub. */
const MP4_STUB = 'AAAAGGZ0eXBpc29tAAAAAGlzb20AAAAA'

const FIXTURE_PAYLOADS: Record<GenArtefact, { mediaType: string; data: string }> = {
  image: { mediaType: 'image/png', data: PNG_PIXEL },
  audio: { mediaType: 'audio/wav', data: WAV_SILENCE },
  video: { mediaType: 'video/mp4', data: MP4_STUB },
}

/** One configured fixture model. */
export interface FixtureModel {
  /** The model id the fixture backend publishes. */
  id: string
  /** The artefact kind it produces; decides which silent or blank payload it returns. */
  artefact: GenArtefact
  /** Input modalities it accepts; defaults to text only. */
  inputModalities?: GenModality[]
}

/** Plugin config. */
export interface Config {
  /** Registry id the backend registers under. */
  backendId?: string
  /** The models the backend publishes. */
  models?: FixtureModel[]
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  backendId: z.string().default('fixture'),
  models: z.array(z.object({
    id: z.string().required(),
    artefact: z.union(['image', 'video', 'audio']).required(),
    inputModalities: z.array(z.union(['text', 'image', 'audio', 'video'])).default(['text']),
  })).default([{ id: 'fixture-still', artefact: 'image', inputModalities: ['text'] }]),
})

/** Cordis plugin name. */
export const name = 'idealize-gen-fixture'
/** Required services. */
export const inject = ['generation']

/**
 * Build a fixture backend from configured models.
 * @param config - registry id and model list.
 * @returns the backend to register with `ctx.generation`.
 */
export function createFixtureBackend(config: Config): GenerationBackend {
  const id = config.backendId ?? 'fixture'
  const models: GenModelInfo[] = (config.models ?? []).map(model => ({
    id: model.id,
    name: model.id,
    artefact: model.artefact,
    inputModalities: model.inputModalities ?? ['text'],
    outputMediaTypes: [FIXTURE_PAYLOADS[model.artefact].mediaType],
  }))
  const describe = (): CapabilityDescriptor[] => {
    const byArtefact = new Map<GenArtefact, GenModelInfo[]>()
    for (const model of models) {
      const group = byArtefact.get(model.artefact) ?? []
      group.push(model)
      byArtefact.set(model.artefact, group)
    }
    return [...byArtefact.entries()].map(([artefact, group]) => ({
      operation: 'generate',
      artefact,
      inputModalities: [...new Set(group.flatMap(model => model.inputModalities))],
      outputMediaTypes: [FIXTURE_PAYLOADS[artefact].mediaType],
      availability: 'available',
      schemaVersion: GENERATION_SCHEMA_VERSION,
    }))
  }
  return {
    id,
    describe,
    models: () => models,
    generate: (request, onProgress, signal) => {
      const model = models.find(candidate => candidate.id === request.model.model)
      if (model === undefined) {
        return Promise.reject(new GenerationError(`fixture backend "${id}" offers no model "${request.model.model}"`, 'NO_MODEL'))
      }
      if (signal.aborted) {
        return Promise.reject(new GenerationError('the fixture generation was aborted', 'ABORTED'))
      }
      onProgress({ phase: 'queued' })
      onProgress({ phase: 'sending' })
      onProgress({ phase: 'done' })
      return Promise.resolve({
        schemaVersion: GENERATION_SCHEMA_VERSION,
        backend: id,
        model: model.id,
        artefact: model.artefact,
        outputs: [FIXTURE_PAYLOADS[model.artefact]],
        timestamp: Date.now(),
      })
    },
  }
}

/**
 * Register the fixture backend.
 * @param ctx - the host plugin context.
 * @param config - registry id and model list.
 */
export function apply(ctx: Context, config: Config): void {
  const backend = createFixtureBackend(config)
  ctx.effect(() => ctx.generation.register(backend), 'gen-fixture: backend')
}

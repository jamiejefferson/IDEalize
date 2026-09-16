/**
 * The model catalogue on disk, one file per service, and beside it one input
 * schema per endpoint the person has generated with.
 *
 * A service's model list belongs to the service, not to this app's release: a
 * list compiled into the build is out of date the day it ships and cannot be
 * corrected without a new one. So nothing is compiled in. The first successful
 * live fetch is written here and read on every later start, which means a
 * rate-limited or offline start shows the last list the service gave rather
 * than a stale snapshot from packaging time.
 * @module @idealize/services/adapters/catalog-cache
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GenArtefact, GenModality, GenModelInfo } from '@idealize/generate'
import type { InputProperty, InputPropertyType, InputSchema } from './input-schema.ts'

/** Directory name, under the harness home, holding one file per service. */
const DIR = 'service-catalogues'

/** What the file holds: the models, and when they were fetched. */
interface CachedCatalog {
  fetchedAt: string
  models: readonly GenModelInfo[]
}

const ARTEFACTS: readonly GenArtefact[] = ['image', 'video', 'audio']

/** One cached row, validated: a file on disk is a boundary, whoever wrote it. */
function modelFrom(raw: unknown): GenModelInfo | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  const artefact = row.artefact
  if (typeof row.id !== 'string' || row.id === '') return undefined
  if (typeof row.name !== 'string') return undefined
  if (typeof artefact !== 'string' || !ARTEFACTS.includes(artefact as GenArtefact)) return undefined
  const inputs = Array.isArray(row.inputModalities) ? row.inputModalities.filter(one => typeof one === 'string') : []
  const outputs = Array.isArray(row.outputMediaTypes) ? row.outputMediaTypes.filter(one => typeof one === 'string') : []
  if (inputs.length === 0 || outputs.length === 0) return undefined
  return {
    id: row.id,
    name: row.name,
    artefact: artefact as GenArtefact,
    inputModalities: inputs as GenModality[],
    outputMediaTypes: outputs,
  }
}

/**
 * Read the last catalogue a service gave.
 * @param home - the harness home directory.
 * @param id - the service's backend id.
 * @returns the cached models, or an empty list when there is no readable cache.
 */
export function readCatalogCache(home: string, id: string): readonly GenModelInfo[] {
  let raw: string
  try {
    raw = readFileSync(join(home, DIR, `${id}.json`), 'utf8')
  } catch {
    // No cache: a first run, or a home this service has never fetched into.
    return []
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CachedCatalog>
    if (!Array.isArray(parsed.models)) return []
    return parsed.models.flatMap((row) => {
      const model = modelFrom(row)
      return model === undefined ? [] : [model]
    })
  } catch {
    // A truncated or hand-edited file reads as no cache; the next fetch replaces it.
    return []
  }
}

/**
 * Record the catalogue a service just gave.
 * @param home - the harness home directory.
 * @param id - the service's backend id.
 * @param models - the models the live fetch returned.
 */
export function writeCatalogCache(home: string, id: string, models: readonly GenModelInfo[]): void {
  const dir = join(home, DIR)
  mkdirSync(dir, { recursive: true })
  const body: CachedCatalog = { fetchedAt: new Date().toISOString(), models }
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

const PROPERTY_TYPES: readonly InputPropertyType[] = ['string', 'number', 'integer', 'boolean', 'other']

/** One cached input property, validated the way a cached model row is. */
function propertyFrom(raw: unknown): InputProperty | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.name !== 'string' || row.name === '') return undefined
  if (typeof row.type !== 'string' || !PROPERTY_TYPES.includes(row.type as InputPropertyType)) return undefined
  const property: InputProperty = { name: row.name, type: row.type as InputPropertyType, required: row.required === true }
  if (Array.isArray(row.enum)) {
    const literals = row.enum.filter((literal): literal is string => typeof literal === 'string')
    if (literals.length > 0) property.enum = literals
  }
  if (typeof row.default === 'string' || typeof row.default === 'number' || typeof row.default === 'boolean') property.default = row.default
  if (typeof row.minimum === 'number' && Number.isFinite(row.minimum)) property.minimum = row.minimum
  if (typeof row.maximum === 'number' && Number.isFinite(row.maximum)) property.maximum = row.maximum
  return property
}

/** The file one endpoint's schema lives in: the endpoint id with `/` replaced, under the service's `inputs` directory. */
function inputSchemaPath(home: string, id: string, endpoint: string): string {
  return join(home, DIR, id, 'inputs', `${endpoint.replace(/\//g, '__')}.json`)
}

/**
 * Read the input schema a service last gave for one endpoint.
 * @param home - the harness home directory.
 * @param id - the service's backend id.
 * @param endpoint - the endpoint (model) id.
 * @returns the cached schema, or undefined when there is no readable cache.
 */
export function readInputSchemaCache(home: string, id: string, endpoint: string): InputSchema | undefined {
  let raw: string
  try {
    raw = readFileSync(inputSchemaPath(home, id, endpoint), 'utf8')
  } catch {
    // No cache: this endpoint has not been generated with from this home.
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as { properties?: unknown }
    if (!Array.isArray(parsed.properties)) return undefined
    return {
      properties: parsed.properties.flatMap((row) => {
        const property = propertyFrom(row)
        return property === undefined ? [] : [property]
      }),
    }
  } catch {
    // A truncated or hand-edited file reads as no cache; the next fetch replaces it.
    return undefined
  }
}

/**
 * Record the input schema a service just gave for one endpoint.
 * @param home - the harness home directory.
 * @param id - the service's backend id.
 * @param endpoint - the endpoint (model) id.
 * @param schema - the parsed schema.
 */
export function writeInputSchemaCache(home: string, id: string, endpoint: string, schema: InputSchema): void {
  const path = inputSchemaPath(home, id, endpoint)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ fetchedAt: new Date().toISOString(), ...schema }, null, 2)}\n`, 'utf8')
}

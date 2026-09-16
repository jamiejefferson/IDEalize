/**
 * The catalogue cache is a file boundary: every row is validated on the way
 * back in, and anything unreadable reads as no cache rather than failing the
 * service that asked.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenModelInfo } from '@idealize/generate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readCatalogCache,
  readInputSchemaCache,
  writeCatalogCache,
  writeInputSchemaCache,
} from '../src/adapters/catalog-cache.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'idealize-catalog-'))
  homes.push(dir)
  return dir
}

const model: GenModelInfo = {
  id: 'flux',
  name: 'Flux',
  artefact: 'image',
  inputModalities: ['text'],
  outputMediaTypes: ['image/png'],
}

/** Write a hand-made cache file for one service. */
function cache(dir: string, id: string, content: unknown): void {
  mkdirSync(join(dir, 'service-catalogues'), { recursive: true })
  writeFileSync(join(dir, 'service-catalogues', `${id}.json`), typeof content === 'string' ? content : JSON.stringify(content))
}

describe('the catalogue cache', () => {
  it('gives back what the service last offered', () => {
    const dir = home()
    writeCatalogCache(dir, 'fal', [model])
    expect(readCatalogCache(dir, 'fal')).toEqual([model])
  })

  it('reads no cache at all as an empty catalogue', () => {
    expect(readCatalogCache(home(), 'never-fetched')).toEqual([])
  })

  it('reads a truncated or reshaped file as an empty catalogue', () => {
    const dir = home()
    cache(dir, 'torn', 'half a json document')
    expect(readCatalogCache(dir, 'torn')).toEqual([])

    cache(dir, 'reshaped', { fetchedAt: 'now', models: 'not a list' })
    expect(readCatalogCache(dir, 'reshaped')).toEqual([])
  })

  it('drops a row it cannot trust and keeps the rest', () => {
    const dir = home()
    cache(dir, 'mixed', {
      fetchedAt: '2026-09-10T09:00:00.000Z',
      models: [
        'not an object',
        null,
        { ...model, id: '' },
        { ...model, id: 7 },
        { ...model, name: 7 },
        { ...model, artefact: 'hologram' },
        { ...model, artefact: 7 },
        { ...model, inputModalities: 'text' },
        { ...model, outputMediaTypes: 'image/png' },
        { ...model, outputMediaTypes: [] },
        { ...model, id: 'partly', outputMediaTypes: ['image/png', 7] },
        model,
      ],
    })
    expect(readCatalogCache(dir, 'mixed')).toEqual([
      { ...model, id: 'partly' },
      model,
    ])
  })
})

describe('the input-schema cache', () => {
  const property = { name: 'prompt', type: 'string', required: true } as const

  it('gives back the schema an endpoint last offered, keyed by endpoint', () => {
    const dir = home()
    writeInputSchemaCache(dir, 'fal', 'fal-ai/flux/dev', { properties: [{ ...property }] })
    expect(readInputSchemaCache(dir, 'fal', 'fal-ai/flux/dev')).toEqual({ properties: [{ ...property }] })
    expect(readInputSchemaCache(dir, 'fal', 'fal-ai/other')).toBeUndefined()
  })

  it('reads a truncated or reshaped file as no cache', () => {
    const dir = home()
    const write = (endpoint: string, content: unknown) => {
      mkdirSync(join(dir, 'service-catalogues', 'fal', 'inputs'), { recursive: true })
      writeFileSync(
        join(dir, 'service-catalogues', 'fal', 'inputs', `${endpoint}.json`),
        typeof content === 'string' ? content : JSON.stringify(content),
      )
    }
    write('torn', 'half a json document')
    expect(readInputSchemaCache(dir, 'fal', 'torn')).toBeUndefined()
    write('reshaped', { properties: 'not a list' })
    expect(readInputSchemaCache(dir, 'fal', 'reshaped')).toBeUndefined()
  })

  it('keeps every field it can trust and drops a property it cannot', () => {
    const dir = home()
    writeInputSchemaCache(dir, 'fal', 'rich', {
      properties: [
        { name: 'size', type: 'string', required: false, enum: ['square', 'wide'], default: 'square' },
        { name: 'steps', type: 'integer', required: false, minimum: 1, maximum: 50 },
      ],
    })
    expect(readInputSchemaCache(dir, 'fal', 'rich')).toEqual({
      properties: [
        { name: 'size', type: 'string', required: false, enum: ['square', 'wide'], default: 'square' },
        { name: 'steps', type: 'integer', required: false, minimum: 1, maximum: 50 },
      ],
    })

    mkdirSync(join(dir, 'service-catalogues', 'fal', 'inputs'), { recursive: true })
    writeFileSync(join(dir, 'service-catalogues', 'fal', 'inputs', 'mixed.json'), JSON.stringify({
      properties: [
        'not an object',
        null,
        { ...property, name: '' },
        { ...property, name: 7 },
        { ...property, type: 'colour' },
        { ...property, type: 7 },
        { ...property, enum: [7], default: null, minimum: Number.POSITIVE_INFINITY, maximum: 'wide' },
        property,
      ],
    }))
    expect(readInputSchemaCache(dir, 'fal', 'mixed')).toEqual({
      properties: [{ ...property }, { ...property }],
    })
  })
})

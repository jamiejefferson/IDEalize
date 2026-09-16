/**
 * The registrar: every media service in the directory gets a backend whether
 * or not a key is stored, each one reads the catalogue its last run cached,
 * and a fresh fetch is written back. Registration comes from data, so a
 * service the directory gains needs no plugin row.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GenerationRuntime from '@idealize/generate'
import type { GenModelInfo } from '@idealize/generate'
import { readCatalogCache, readInputSchemaCache, writeCatalogCache, writeInputSchemaCache } from '../src/adapters/catalog-cache.ts'
import { applyEndpoints, MEDIA_SERVICES } from '../src/media-directory.ts'
import { registerMediaServices } from '../src/registrar.ts'

const made: string[] = []
const home = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'idealize-services-'))
  made.push(path)
  return path
}
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }) })

/**
 * One directory row with a key dropped: a service that declares no queue
 * endpoint or no schema address states that by omitting the key, which is the
 * state the registrar has to answer for.
 */
function omit<T extends object, K extends keyof T>(row: T, key: K): Omit<T, K> {
  const { [key]: _dropped, ...rest } = row
  return rest
}

/** A context carrying the two services the registrar injects, plus a logger. */
async function bench(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(GenerationRuntime).await()
  ctx.provide('credentials', { resolve: () => Promise.resolve(undefined) } as never)
  return ctx
}

/** The URL one fetch call names, whichever form it arrives in. */
const urlOf = (input: string | URL | Request): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

const model = (id: string, artefact: 'image' | 'video' | 'audio'): GenModelInfo =>
  ({ id, name: id, artefact, inputModalities: ['text'], outputMediaTypes: [`${artefact}/*`] })

/**
 * A rejection carrying something that is not an Error, which is the case
 * under test: the caller has to report it without assuming a message.
 * @param value - what the caller threw.
 * @returns a promise rejected with it.
 */
function rejectWith(value: unknown): Promise<never> {
  return Promise.resolve().then<never>(() => { throw value })
}

describe('the media-service registrar', () => {
  it('registers a backend for every directory row, keyed or not', async () => {
    const ctx = await bench()
    registerMediaServices(ctx, {
      home: home(), timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      fetchImpl: () => Promise.reject(new Error('the registrar test must not touch the network')),
    })
    expect([...ctx.generation.backends()].sort()).toEqual(MEDIA_SERVICES.map(row => row.id).sort())
    // Unkeyed, and still saying what each service makes: the Add list and the
    // space launcher read exactly this before any key exists.
    const fal = ctx.generation.credentials().find(row => row.backend === 'fal')
    expect(fal).toMatchObject({ displayName: 'fal.ai', env: 'FAL_KEY', connected: false })
    expect([...(fal?.artefacts ?? [])].sort()).toEqual(['audio', 'image', 'video'])
  })

  it('seeds each backend from the catalogue its last run cached', async () => {
    const dir = home()
    writeCatalogCache(dir, 'fal', [model('acme/one', 'video')])
    const ctx = await bench()
    registerMediaServices(ctx, {
      home: dir, timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      fetchImpl: () => Promise.reject(new Error('the registrar test must not touch the network')),
    })
    expect(ctx.generation.catalog().filter(entry => entry.backend === 'fal').map(entry => entry.model.id))
      .toEqual(['acme/one'])
  })

  it('writes a fetched catalogue back, so the next start does not begin empty', async () => {
    const dir = home()
    const page = {
      models: [{ endpoint_id: 'acme/two', metadata: { display_name: 'Two', category: 'text-to-video', status: 'active', kind: 'inference' } }],
    }
    const ctx = await bench()
    registerMediaServices(ctx, {
      home: dir, timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      rows: applyEndpoints(MEDIA_SERVICES.filter(row => row.id === 'fal'), {}),
      fetchImpl: () => Promise.resolve(Response.json(page)),
    })
    await vi.waitFor(() => { expect(readCatalogCache(dir, 'fal').map(one => one.id)).toContain('acme/two') })
    const written = JSON.parse(readFileSync(join(dir, 'service-catalogues', 'fal.json'), 'utf8')) as { fetchedAt?: unknown }
    expect(written.fetchedAt).toEqual(expect.any(String))
  })

  it('keeps one input schema per endpoint on disk beside the catalogue, validated on read', () => {
    const dir = home()
    expect(readInputSchemaCache(dir, 'fal', 'acme/cut')).toBeUndefined()
    writeInputSchemaCache(dir, 'fal', 'acme/cut', {
      properties: [
        { name: 'duration', type: 'string', enum: ['4', '5'], default: '5', required: false },
        { name: 'prompt', type: 'string', required: true },
        { name: 'steps', type: 'integer', default: 30, minimum: 1, maximum: 100, required: false },
      ],
    })
    expect(readInputSchemaCache(dir, 'fal', 'acme/cut')).toEqual({
      properties: [
        { name: 'duration', type: 'string', enum: ['4', '5'], default: '5', required: false },
        { name: 'prompt', type: 'string', required: true },
        { name: 'steps', type: 'integer', default: 30, minimum: 1, maximum: 100, required: false },
      ],
    })
    const path = join(dir, 'service-catalogues', 'fal', 'inputs', 'acme__cut.json')
    expect((JSON.parse(readFileSync(path, 'utf8')) as { fetchedAt?: unknown }).fetchedAt).toEqual(expect.any(String))

    // Rows the file cannot vouch for are dropped; a file that is not a schema reads as no cache.
    writeFileSync(path, JSON.stringify({ properties: [{ name: 'ok', type: 'boolean' }, { name: '', type: 'string' }, { name: 'x', type: 'weird' }, 'junk', { name: 'e', type: 'string', enum: [1] }, { name: 'n', type: 'number', minimum: 'low', maximum: null }] }))
    expect(readInputSchemaCache(dir, 'fal', 'acme/cut')).toEqual({ properties: [{ name: 'ok', type: 'boolean', required: false }, { name: 'e', type: 'string', required: false }, { name: 'n', type: 'number', required: false }] })
    writeFileSync(path, '{"properties": 3}')
    expect(readInputSchemaCache(dir, 'fal', 'acme/cut')).toBeUndefined()
    writeFileSync(path, '{not json')
    expect(readInputSchemaCache(dir, 'fal', 'acme/cut')).toBeUndefined()
  })

  it('hands the queue backend fal\'s schema address and the disk cache callbacks', async () => {
    const dir = home()
    const document = {
      components: { schemas: { CutInput: { properties: { prompt: { type: 'string' }, fps: { type: 'string', enum: ['24', '30'], default: '24' } } } } },
    }
    const ctx = await bench()
    registerMediaServices(ctx, {
      home: dir, timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      rows: MEDIA_SERVICES.filter(row => row.id === 'fal'),
      fetchImpl: (input) => {
        if (urlOf(input).startsWith('https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=acme/cut')) return Promise.resolve(Response.json(document))
        return Promise.resolve(Response.json({ models: [] }))
      },
    })
    expect(await ctx.generation.inputs({ backend: 'fal', model: 'acme/cut' })).toEqual([{ name: 'fps', label: 'Fps', kind: 'enum', values: ['24', '30'], default: '24' }])
    expect(readInputSchemaCache(dir, 'fal', 'acme/cut')?.properties.map(property => property.name)).toEqual(['prompt', 'fps'])

    // A second registrar over the same home reads the file and never asks the network.
    const again = await bench()
    registerMediaServices(again, {
      home: dir, timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      rows: MEDIA_SERVICES.filter(row => row.id === 'fal'),
      fetchImpl: (input) => {
        if (urlOf(input).includes('openapi')) return Promise.reject(new Error('the cached schema must be read from disk'))
        return Promise.resolve(Response.json({ models: [] }))
      },
    })
    expect((await again.generation.inputs({ backend: 'fal', model: 'acme/cut' })).map(field => field.name)).toEqual(['fps'])
  })

  it('drops every backend it registered when its fiber goes', async () => {
    const ctx = await bench()
    const fiber = ctx.plugin({
      inject: ['generation', 'credentials'],
      apply: (scope: Context) => {
        registerMediaServices(scope, {
          home: home(), timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
          fetchImpl: () => Promise.reject(new Error('the registrar test must not touch the network')),
        })
      },
    })
    await fiber.await()
    expect(ctx.generation.backends().length).toBe(MEDIA_SERVICES.length)
    await fiber.dispose()
    expect(ctx.generation.backends()).toEqual([])
  })

  it('refuses an endpoint override naming a service the directory does not carry', () => {
    const partial = applyEndpoints(MEDIA_SERVICES.filter(row => row.id === 'fal'), { fal: { queueUrl: 'https://queue.example' } })
    expect(partial[0]).toMatchObject({ id: 'fal', queueUrl: 'https://queue.example' })
    expect(partial[0]?.baseUrl).toBe(MEDIA_SERVICES.find(row => row.id === 'fal')?.baseUrl)

    expect(() => applyEndpoints(MEDIA_SERVICES, { nope: { baseUrl: 'https://x' } }))
      .toThrow(/not a known media service/u)
    expect(applyEndpoints(MEDIA_SERVICES, { fal: { baseUrl: 'https://x/v1' } })
      .find(row => row.id === 'fal')?.baseUrl).toBe('https://x/v1')
  })

  it('refuses to register a queue row missing the endpoints it would be talked to on', async () => {
    const ctx = await bench()
    const [fal] = MEDIA_SERVICES.filter(row => row.id === 'fal')
    expect(() => { registerMediaServices(ctx, {
      home: home(), timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      rows: [omit(fal!, 'queueUrl')],
      fetchImpl: () => Promise.reject(new Error('the registrar test must not touch the network')),
    }) }).toThrow('missing its queueUrl, categories or auth')
  })

  it('names the service in the log when a refresh fails, and keeps its timer until disposal', async () => {
    const ctx = await bench()
    const warnings: string[] = []
    ctx.logger.warn = ((message: string) => { warnings.push(message) }) as typeof ctx.logger.warn
    registerMediaServices(ctx, {
      home: home(), timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 60,
      rows: applyEndpoints(MEDIA_SERVICES.filter(row => row.id === 'fal'), {}),
      fetchImpl: () => Promise.reject(new Error('the catalogue is unreachable')),
    })
    await vi.waitFor(() => { expect(warnings[0]).toContain('fal catalogue refresh failed') })
    await ctx.fiber.dispose()
  })

  it('carries a queue row’s own input-schema endpoint through to its backend', async () => {
    const ctx = await bench()
    const [fal] = applyEndpoints(MEDIA_SERVICES.filter(row => row.id === 'fal'), {})
    registerMediaServices(ctx, {
      home: home(), timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      rows: [{ ...fal!, inputSchemaUrl: 'https://queue.example/openapi' }],
      fetchImpl: () => Promise.reject(new Error('the registrar test must not touch the network')),
    })
    expect([...ctx.generation.backends()]).toEqual(['fal'])
    await ctx.fiber.dispose()
  })

  it('registers a row that names no input-schema endpoint, and takes the app’s own fetch', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      calls.push(urlOf(input))
      return Promise.resolve(Response.json({ models: [] }))
    })
    const ctx = await bench()
    const [fal] = applyEndpoints(MEDIA_SERVICES.filter(row => row.id === 'fal'), {})
    registerMediaServices(ctx, {
      home: home(), timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      rows: [omit(fal!, 'inputSchemaUrl')],
    })
    await vi.waitFor(() => { expect(calls.length).toBeGreaterThan(0) })
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  })

  it('reports a thrown value that is no Error', async () => {
    const ctx = await bench()
    const warnings: string[] = []
    ctx.logger.warn = ((message: string) => { warnings.push(message) }) as typeof ctx.logger.warn
    registerMediaServices(ctx, {
      home: home(), timeoutMs: 1000, pollIntervalMs: 1, refreshMinutes: 0,
      rows: applyEndpoints(MEDIA_SERVICES.filter(row => row.id === 'fal'), {}),
      fetchImpl: () => rejectWith('the catalogue said no'),
    })
    await vi.waitFor(() => { expect(warnings[0]).toContain('the catalogue said no') })
    await ctx.fiber.dispose()
  })
})

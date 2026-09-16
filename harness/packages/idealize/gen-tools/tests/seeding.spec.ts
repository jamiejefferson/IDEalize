/**
 * Seeding the media agents: where the presets land when the composition names
 * no root, and what happens when the roster cannot be read.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, seedMediaAgents } from '../src/index.ts'
import { MEDIA_AGENTS } from '../src/presets.ts'

const contexts: Context[] = []
const homes: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** A host root over a scratch DSH home, with a roster that answers `list`. */
async function mount(config: { root?: string }, roster: () => Promise<{ id: string }[]>) {
  const home = await mkdtemp(join(tmpdir(), 'idealize-gen-tools-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  contexts.push(ctx)
  const warnings: string[] = []
  ctx.provide('agentPresets', { list: roster } as never)
  ctx.logger.warn = ((message: string) => { warnings.push(message) }) as typeof ctx.logger.warn
  await ctx.plugin({ name: 'idealize-gen-tools', inject: [], apply }, config).await()
  return { home, warnings }
}

/**
 * A rejection carrying something that is not an Error, which is the case
 * under test: the caller has to report it without assuming a message.
 * @param value - what the caller threw.
 * @returns a promise rejected with it.
 */
function rejectWith(value: unknown): Promise<never> {
  return Promise.resolve().then<never>(() => { throw value })
}

describe('seeding the media agents', () => {
  it('writes them under the harness home when the composition names no root', async () => {
    const { home } = await mount({}, async () => [])
    await vi.waitFor(async () => {
      expect((await readdir(join(home, '.agent-presets'))).sort()).toEqual(MEDIA_AGENTS.map(agent => agent.id).sort())
    })
  })

  it('reads an empty root the same way', async () => {
    const { home } = await mount({ root: '' }, async () => [])
    await vi.waitFor(async () => {
      expect((await readdir(join(home, '.agent-presets'))).length).toBeGreaterThan(0)
    })
  })

  it('writes them where the composition names, expanding a home-relative path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idealize-gen-tools-root-'))
    homes.push(root)
    await mount({ root }, async () => [])
    await vi.waitFor(async () => {
      expect((await readdir(root)).sort()).toEqual(MEDIA_AGENTS.map(agent => agent.id).sort())
    })
  })

  it('reports a roster it cannot read rather than failing the mount', async () => {
    const { warnings } = await mount({}, () => Promise.reject(new Error('the roster is locked')))
    await vi.waitFor(() => { expect(warnings[0]).toBe('gen-tools: seeding failed: the roster is locked') })
  })

  it('reports a thrown value that is no Error', async () => {
    const { warnings } = await mount({}, () => rejectWith('the roster said no'))
    await vi.waitFor(() => { expect(warnings[0]).toBe('gen-tools: seeding failed: the roster said no') })
  })

  it('leaves a roster that already carries a media agent alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idealize-gen-tools-root-'))
    homes.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('agentPresets', { list: async () => [{ id: MEDIA_AGENTS[0]!.id }] } as never)
    await seedMediaAgents(ctx, root)
    expect(await readdir(root)).toEqual([])
  })
})

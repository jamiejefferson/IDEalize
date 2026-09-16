/**
 * The package's invariant companion: a reroute notice exists only for an
 * actual fallback, so the stored and used models must differ. This suite owns
 * its service topology (the file name opts out of the global invariant host),
 * so the reporter records instead of throwing.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as GenToolsInvariant from '../src/invariant.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** The registered installer, run against a reporter that records. */
async function installed() {
  const ctx = new Context()
  contexts.push(ctx)
  let installer: ((child: Context, fail: (message: string) => never) => void) | undefined
  ctx.provide('invariants', {
    register(_name: string, install: (child: Context, fail: (message: string) => never) => void) {
      installer = install
      return () => {}
    },
  })
  await ctx.plugin(GenToolsInvariant)
  await ctx.fiber.await()
  const reported: string[] = []
  installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
  const emit = (type: string, data: unknown) => { ctx.emit('session/event', {} as never, { type, data } as never) }
  return { reported, emit }
}

const route = (backend: string, model: string) => ({ backend, model })

describe('the generation-tools invariant companion', () => {
  it('says nothing about a reroute that changed the model', async () => {
    const { reported, emit } = await installed()
    emit('generation/rerouted', { presetId: 'portrait', stored: route('fal', 'flux'), used: route('fal', 'sdxl') })
    emit('generation/rerouted', { presetId: 'portrait', stored: route('fal', 'flux'), used: route('replicate', 'flux') })
    // Any other session event is somebody else's business.
    emit('artefact/created', { record: { id: 'a-1' } })
    expect(reported).toEqual([])
  })

  it('names a notice that reroutes to the model it started with', async () => {
    const { reported, emit } = await installed()
    emit('generation/rerouted', { presetId: 'portrait', stored: route('fal', 'flux'), used: route('fal', 'flux') })
    expect(reported).toEqual([
      "generation/rerouted for preset 'portrait' names the same stored and used model — the notice exists only for actual fallbacks",
    ])
  })
})

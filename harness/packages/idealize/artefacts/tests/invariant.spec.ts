/**
 * The package's invariant companion: an `artefact/created` event reaching
 * session observers must already resolve to a durable record. This suite owns
 * its service topology (the file name opts out of the global invariant host),
 * so the reporter records instead of throwing.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as ArtefactsInvariant from '../src/invariant.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** The registered installer, run against a reporter that records. */
async function installed(store?: { get(id: string): unknown }) {
  const ctx = new Context()
  contexts.push(ctx)
  if (store !== undefined) ctx.provide('artefacts', store)
  let installer: ((child: Context, fail: (message: string) => never) => void) | undefined
  ctx.provide('invariants', {
    register(_name: string, install: (child: Context, fail: (message: string) => never) => void) {
      installer = install
      return () => {}
    },
  })
  await ctx.plugin(ArtefactsInvariant)
  await ctx.fiber.await()
  const reported: string[] = []
  installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
  const emit = (type: string, id: string) => {
    ctx.emit('session/event', {} as never, { type, data: { record: { id } } } as never)
  }
  return { reported, emit }
}

describe('the artefacts invariant companion', () => {
  it('says nothing when the store already holds the record', async () => {
    const { reported, emit } = await installed({ get: (id: string) => (id === 'a-1' ? { id } : undefined) })
    emit('artefact/created', 'a-1')
    // Any other session event is somebody else's business.
    emit('artefact/failed', 'a-9')
    expect(reported).toEqual([])
  })

  it('names an event appended with no store mounted at all', async () => {
    const { reported, emit } = await installed()
    emit('artefact/created', 'a-2')
    expect(reported).toEqual(["artefact/created for 'a-2' was appended with no mounted artefact store"])
  })

  it('names an event the store cannot resolve', async () => {
    const { reported, emit } = await installed({ get: () => undefined })
    emit('artefact/created', 'a-3')
    expect(reported).toEqual([
      "artefact/created for 'a-3' has no durable artefact record — events must publish at the commit point",
    ])
  })
})

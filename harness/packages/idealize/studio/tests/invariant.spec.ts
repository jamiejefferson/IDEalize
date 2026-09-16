/**
 * The package's invariant companion: an announced timeline record must
 * already be retained, so the project's timeline reaches at least the
 * announced seq. This suite owns its service topology (the file name opts out
 * of the global invariant host), so the reporter records instead of throwing.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as StudioInvariant from '../src/invariant.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** Let the check's microtask run. */
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

/** The registered installer, run against a reporter that records. */
async function installed(studio?: { lastSeq(project: string): number }) {
  const ctx = new Context()
  contexts.push(ctx)
  if (studio !== undefined) ctx.provide('idealizeStudio', studio)
  let installer: ((child: Context, fail: (message: string) => never) => void) | undefined
  ctx.provide('invariants', {
    register(_name: string, install: (child: Context, fail: (message: string) => never) => void) {
      installer = install
      return () => {}
    },
  })
  await ctx.plugin(StudioInvariant)
  await ctx.fiber.await()
  const reported: string[] = []
  installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
  const announce = async (seq: number) => {
    ctx.emit('idealize/studio-event', { id: 'e-1', project: 'apollo', seq } as never)
    await settle()
  }
  return { reported, announce }
}

describe('the studio invariant companion', () => {
  it('says nothing when the timeline already holds the announced record', async () => {
    const { reported, announce } = await installed({ lastSeq: () => 7 })
    await announce(7)
    await announce(3)
    expect(reported).toEqual([])
  })

  it('says nothing when no store is mounted to ask', async () => {
    const { reported, announce } = await installed()
    await announce(7)
    expect(reported).toEqual([])
  })

  it('names a record announced ahead of the timeline that must replay it', async () => {
    const { reported, announce } = await installed({ lastSeq: () => 4 })
    await announce(5)
    expect(reported).toEqual(["studio event e-1 (seq 5) was announced but apollo's timeline ends at 4"])
  })
})

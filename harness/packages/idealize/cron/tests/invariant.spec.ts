/**
 * The package's invariant companion: a run that executed reports the wall
 * time it took, and a run skipped because the task was busy reports none.
 * This suite owns its service topology (the file name opts out of the global
 * invariant host), so the reporter records instead of throwing.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as CronInvariant from '../src/invariant.ts'

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
  await ctx.plugin(CronInvariant)
  await ctx.fiber.await()
  const reported: string[] = []
  installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
  const emit = (run: { status: string; durationMs?: number }) => {
    ctx.emit('idealize/cron-run', run as never, { id: 't-1', name: 'Nightly digest' } as never)
  }
  return { reported, emit }
}

describe('the cron invariant companion', () => {
  it('says nothing about a run that reports the time it took', async () => {
    const { reported, emit } = await installed()
    emit({ status: 'ok', durationMs: 1200 })
    emit({ status: 'error', durationMs: 3 })
    emit({ status: 'skipped-busy' })
    expect(reported).toEqual([])
  })

  it('names a run that executed without reporting its duration', async () => {
    const { reported, emit } = await installed()
    emit({ status: 'ok' })
    expect(reported).toEqual(['cron task t-1 emitted a ok run without durationMs'])
  })

  it('names a skipped run carrying a duration it never spent', async () => {
    const { reported, emit } = await installed()
    emit({ status: 'skipped-busy', durationMs: 40 })
    expect(reported).toEqual(['cron task t-1 emitted a skipped-busy run carrying durationMs'])
  })
})

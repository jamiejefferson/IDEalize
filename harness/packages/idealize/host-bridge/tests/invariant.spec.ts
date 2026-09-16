/**
 * The package's invariant companion: a schedule the host says finished must
 * reach the shell's feed as a `cron-run` notification. This suite owns its
 * service topology (the file name opts out of the global invariant host), so
 * the reporter records instead of throwing and both answers are readable.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { BridgeBuffer } from '../src/buffer.ts'
import * as BridgeInvariant from '../src/invariant.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** The registered installer, run against a reporter that records. */
async function installed(bridge?: { buffer: BridgeBuffer }) {
  const ctx = new Context()
  contexts.push(ctx)
  if (bridge !== undefined) ctx.provide('idealizeBridge', bridge)
  let installer: ((child: Context, fail: (message: string) => never) => void) | undefined
  ctx.provide('invariants', {
    register(_name: string, install: (child: Context, fail: (message: string) => never) => void) {
      installer = install
      return () => {}
    },
  })
  await ctx.plugin(BridgeInvariant)
  await ctx.fiber.await()
  const reported: string[] = []
  installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
  return { ctx, reported }
}

/** Let the check's microtask run. */
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('the host bridge’s invariant companion', () => {
  it('says nothing when the finished schedule reached the feed', async () => {
    const buffer = new BridgeBuffer()
    const { ctx, reported } = await installed({ buffer })
    ctx.on('idealize/cron-run', (_run, task) => {
      buffer.push({ kind: 'cron-run', title: `${task.name} — ok`, body: '' })
    })
    ctx.emit('idealize/cron-run', { status: 'ok' } as never, { id: 't-1', name: 'Nightly digest' } as never)
    await settle()
    expect(reported).toEqual([])
  })

  it('says nothing when two schedules finish in one tick', async () => {
    const buffer = new BridgeBuffer()
    const { ctx, reported } = await installed({ buffer })
    ctx.on('idealize/cron-run', (_run, task) => {
      buffer.push({ kind: 'cron-run', title: `${task.name} — ok`, body: '' })
    })
    ctx.emit('idealize/cron-run', { status: 'ok' } as never, { id: 't-1', name: 'Nightly digest' } as never)
    ctx.emit('idealize/cron-run', { status: 'ok' } as never, { id: 't-2', name: 'Weekly sweep' } as never)
    await settle()
    expect(reported).toEqual([])
  })

  it('reports a finished schedule the feed never carried', async () => {
    const { ctx, reported } = await installed({ buffer: new BridgeBuffer() })
    ctx.emit('idealize/cron-run', { status: 'ok' } as never, { id: 't-9', name: 'Lost sweep' } as never)
    await settle()
    expect(reported).toEqual([
      'cron task t-9 finished (ok) but the bridge buffer holds no matching cron-run event',
    ])
  })

  it('reports a feed that carried somebody else’s event instead', async () => {
    const buffer = new BridgeBuffer()
    const { ctx, reported } = await installed({ buffer })
    ctx.on('idealize/cron-run', () => { buffer.push({ kind: 'mail', title: 'a message', body: '' }) })
    ctx.emit('idealize/cron-run', { status: 'failed' } as never, { id: 't-8', name: 'Sweep' } as never)
    await settle()
    expect(reported).toHaveLength(1)
  })

  it('stands down where no bridge is composed', async () => {
    const { ctx, reported } = await installed()
    ctx.emit('idealize/cron-run', { status: 'ok' } as never, { id: 't-0', name: 'Nobody listens' } as never)
    await settle()
    expect(reported).toEqual([])
  })

  it('registers under the package name, which is then reserved', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(BridgeInvariant)
    await ctx.fiber.await()
    expect(BridgeInvariant.name).toBe('idealize-host-bridge-invariant')
    expect(() => { ctx.invariants.register('@idealize/host-bridge', () => {}) }).toThrow(/already registered/)
  })
})

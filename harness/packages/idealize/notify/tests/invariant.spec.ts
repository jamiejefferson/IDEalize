/**
 * The package's invariant companion: an attention alert reaches the window
 * only after its delivery record is on disk. This suite owns its service
 * topology (the file name opts out of the global invariant host), so the
 * reporter records instead of throwing.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attentionLedgerPath } from '../src/attention-store.ts'
import * as NotifyInvariant from '../src/invariant.ts'

type FeedEvent = { kind: string; title: string; studioEvent?: string }

const contexts: Context[] = []
const homes: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})


/**
 * The registered installer over a scratch home whose ledger holds `events`.
 * A `null` ledger writes content the parser refuses, which is the
 * read-failure path.
 */
async function installed(events: string[] | null, options: { bridge?: boolean } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'idealize-notify-inv-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  const path = attentionLedgerPath(home)
  await mkdir(dirname(path), { recursive: true })
  if (events === null) {
    await writeFile(path, 'half a ledger')
  } else {
    const notifications = events.map(event => ({ event, project: 'apollo', row: 'studio', at: '2026-09-10T09:00:00.000Z', state: 'sent' }))
    await writeFile(path, JSON.stringify({ read: {}, notifications }))
  }

  const ctx = new Context()
  contexts.push(ctx)
  const listeners: ((event: FeedEvent) => void)[] = []
  if (options.bridge !== false) {
    ctx.provide('idealizeBridge', {
      buffer: { subscribe: (listener: (event: FeedEvent) => void) => { listeners.push(listener); return () => {} } },
    })
  }
  let installer: ((child: Context, fail: (message: string) => never) => void) | undefined
  ctx.provide('invariants', {
    register(_name: string, install: (child: Context, fail: (message: string) => never) => void) {
      installer = install
      return () => {}
    },
  })
  await ctx.plugin(NotifyInvariant)
  await ctx.fiber.await()
  const reported: string[] = []
  installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
  await ctx.fiber.await()

  const push = (event: FeedEvent) => {
    for (const listener of listeners) listener(event)
  }
  return { reported, push, listeners }
}

describe('the notify invariant companion', () => {
  it('says nothing when the ledger already holds the delivery record', async () => {
    const { reported, push } = await installed(['e-1'])
    push({ kind: 'attention', title: 'Apollo needs you', studioEvent: 'e-1' })
    // Any other feed event is somebody else's business.
    push({ kind: 'cron-run', title: 'Nightly digest — ok' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reported).toEqual([])
  })

  it('names an alert that points at no Studio event', async () => {
    const { reported, push } = await installed([])
    push({ kind: 'attention', title: 'Something happened' })
    expect(reported).toEqual(['an attention alert titled "Something happened" names no Studio event'])
  })

  it('names an alert the ledger has no record of', async () => {
    const { reported, push } = await installed(['e-other'])
    push({ kind: 'attention', title: 'Apollo needs you', studioEvent: 'e-1' })
    await vi.waitFor(() => {
      expect(reported).toEqual(['attention alert for Studio event e-1 reached the feed with no delivery record'])
    })
  })

  it('says the ledger could not be read rather than passing the alert', async () => {
    const { reported, push } = await installed(null)
    push({ kind: 'attention', title: 'Apollo needs you', studioEvent: 'e-1' })
    await vi.waitFor(() => { expect(reported).toHaveLength(1) })
    expect(reported[0]).toContain('the attention ledger could not be read while checking e-1')
  })

  it('watches nothing when no feed is composed', async () => {
    const { listeners } = await installed([], { bridge: false })
    expect(listeners).toEqual([])
  })
})

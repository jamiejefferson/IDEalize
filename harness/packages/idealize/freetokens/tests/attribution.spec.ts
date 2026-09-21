/**
 * The attribution warm-up: a session's label resolves off the event loop as
 * the session enters the store, so the request path reads the cache instead
 * of blocking on git, and resolves exactly what the blocking path would.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => ({ sync: 0, async: 0, failAsync: false }))

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return {
    ...real,
    execFileSync: ((...args: Parameters<typeof real.execFileSync>) => {
      spawned.sync += 1
      return real.execFileSync(...args)
    }) as typeof real.execFileSync,
    execFile: ((...args: unknown[]) => {
      spawned.async += 1
      if (spawned.failAsync) throw new Error('spawn git ENOENT')
      return (real.execFile as (...inner: unknown[]) => unknown)(...args)
    }) as typeof real.execFile,
  }
})

const { execFileSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
const { IdealizeAttribution, PROJECT_HEADER } = await import('../src/attribution.ts')

const scratches: string[] = []
const contexts: Context[] = []

beforeEach(() => {
  spawned.sync = 0
  spawned.async = 0
  spawned.failAsync = false
})

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true })
})

/** One attribution service over a fake session store. */
async function attribution(sessions: Record<string, string>) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('sessions', {
    get: (id: string) => (id in sessions ? { header: { cwd: sessions[id] } } : undefined),
  } as never)
  await ctx.plugin(IdealizeAttribution).await()
  return { ctx, meter: ctx.idealizeAttribution }
}

/** A scratch directory, a git repository when asked. */
function scratch(repo: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'idealize-attr-warm-'))
  scratches.push(dir)
  if (repo) execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}

describe('the attribution warm-up', () => {
  it('fills the cache so the request path does not spawn', async () => {
    const repo = scratch(true)
    const { meter } = await attribution({ 's-1': repo })
    await meter.warm(repo)
    expect(spawned.async).toBe(1)
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(repo) })
    expect(spawned.sync).toBe(0)
    // A cwd already resolved is not resolved again.
    await meter.warm(repo)
    expect(spawned.async).toBe(1)
  })

  it('warms a session as it enters the store', async () => {
    const repo = scratch(true)
    const { ctx, meter } = await attribution({ 's-1': repo })
    ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit('session/created', { header: { cwd: repo } })
    expect(spawned.async).toBe(1)
    // The listener's resolution is the one in flight; awaiting it again joins it.
    await meter.warm(repo)
    expect(spawned.async).toBe(1)
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(repo) })
    expect(spawned.sync).toBe(0)
  })

  it('resolves what the blocking path resolves, in a repository and outside one', async () => {
    for (const dir of [scratch(true), scratch(false)]) {
      const cold = await attribution({ 's-1': dir })
      const warm = await attribution({ 's-1': dir })
      await warm.meter.warm(dir)
      expect(warm.meter.headersFor('s-1')).toEqual(cold.meter.headersFor('s-1'))
      expect(warm.meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(dir) })
    }
  })

  it('keeps the blocking path as the fallback while a warm-up is in flight', async () => {
    const repo = scratch(true)
    const { meter } = await attribution({ 's-1': repo })
    const pending = meter.warm(repo)
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(repo) })
    expect(spawned.sync).toBe(1)
    await pending
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(repo) })
  })

  it('swallows a git that cannot run, and ignores a session without a cwd', async () => {
    const gone = join(scratch(false), 'removed')
    const { meter } = await attribution({ 's-1': gone })
    await expect(meter.warm(gone)).resolves.toBeUndefined()
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: 'removed' })
    expect(spawned.sync).toBe(0)

    spawned.failAsync = true
    const other = scratch(false)
    await expect(meter.warm(other)).resolves.toBeUndefined()

    await meter.warm(undefined)
    await meter.warm('')
    expect(spawned.async).toBe(2)
  })
})

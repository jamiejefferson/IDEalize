/**
 * The clean-up and tidy act only on a data folder's own logs. A composition whose
 * store lives elsewhere must leave no trace in the data folder: one test run
 * wrote its marker into a real app's folder before this guard existed, which
 * would have stopped that app's own clean-up from ever running.
 */

import { mkdir, mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { installHousekeeping } from '../src/housekeeping.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function mount(sessions: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: sessions })
  const store = (ctx as unknown as { sessionPersistence: JsonlSessionPersistence }).sessionPersistence
  const old = Date.now() - 3 * 86_400_000
  const meta = { version: SESSION_FORMAT_VERSION, id: SessionId('blank'), createdAt: old, cwd: '/tmp/project' }
  await store.create(meta)
  await store.append(meta.id, [{ type: 'permission/preset', seq: 0, time: old, data: { preset: 'workspace-write' } }] as SessionEvent[])
  await utimes(store.locate(meta).path, new Date(old), new Date(old))
  return ctx
}

async function top(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'idealize-housekeeping-'))
  roots.push(path)
  return path
}

describe('housekeeping', () => {
  it('sets blank chats aside when the logs are the data folder\'s own', async () => {
    const home = await top()
    const ctx = await mount(join(home, 'sessions'))
    await installHousekeeping(ctx, home)
    expect((await readdir(join(home, 'sessions'))).filter(name => name.startsWith('.blank-chats-'))).toHaveLength(1)
    expect((await stat(join(home, 'idealize', 'blank-chats-set-aside.json'))).isFile()).toBe(true)
  })

  it('does nothing and writes nothing when the logs live somewhere else', async () => {
    const home = await top()
    const elsewhere = await top()
    const ctx = await mount(join(elsewhere, 'sessions'))
    await installHousekeeping(ctx, home, 1)
    await new Promise(done => setTimeout(done, 30))
    expect(await readdir(home)).toEqual([])
    expect((await readdir(join(elsewhere, 'sessions'))).some(name => name.startsWith('.blank-chats-'))).toBe(false)
  })

  it('runs the tidy later, without holding up start-up', async () => {
    const home = await top()
    await mkdir(join(home, 'sessions'), { recursive: true })
    const ctx = await mount(join(home, 'sessions'))
    await installHousekeeping(ctx, home, 1)
    await vi.waitFor(async () => { expect((await stat(join(home, 'idealize', 'tidy.json'))).isFile()).toBe(true) })
  })
})

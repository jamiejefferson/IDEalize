// While every agent is paused (feedback 495cec0a), a task that runs an agent
// waits instead of firing, and runs once when the pause is released; a
// reminder runs no agent and still fires.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdealizeCron } from '../src/index.ts'
import type { CronRun } from '../src/store.ts'

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  vi.useRealTimers()
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A scheduler whose pause service answers from `paused`, with every fire recorded instead of run. */
async function boot(paused: { value: boolean }): Promise<{ cron: IdealizeCron; fired: string[] }> {
  root = await mkdtemp(join(tmpdir(), 'idealize-cron-pause-'))
  ctx = new Context()
  ctx.provide('workspaceRegistry', { list: () => [{ path: '/Users/jj/Project' }] })
  ctx.provide('idealizePause', { held: () => paused.value })
  await ctx.plugin(IdealizeCron, { storePath: join(root, 'idealize-cron.json'), notifier: () => undefined })
  const cron = ctx.idealizeCron
  const fired: string[] = []
  vi.spyOn(cron, 'fire').mockImplementation((taskId: string): Promise<CronRun> => {
    fired.push(taskId)
    return Promise.resolve({ taskId, firedAt: new Date().toISOString(), status: 'ok' })
  })
  return { cron, fired }
}

describe('the schedule while agents are paused', () => {
  it('holds an agent task through every fire it misses, then runs it once on release', async () => {
    const paused = { value: true }
    const { cron, fired } = await boot(paused)
    vi.useFakeTimers()
    const task = await cron.saveTask({ name: 'Digest', schedule: { kind: 'every', seconds: 60 }, cwd: '/Users/jj/Project', prompt: 'Write the digest.' })
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fired).toEqual([])
    paused.value = false
    expect((await cron.releaseHeld()).map(run => run.taskId)).toEqual([task.id])
    expect(fired).toEqual([task.id])
    // Released, the task fires on its own schedule again, and nothing is owed twice.
    expect(await cron.releaseHeld()).toEqual([])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fired).toEqual([task.id, task.id])
  })

  it('still fires a reminder, which runs no agent', async () => {
    const { cron, fired } = await boot({ value: true })
    vi.useFakeTimers()
    const reminder = await cron.saveTask({ name: 'Stretch', schedule: { kind: 'every', seconds: 60 }, cwd: '/Users/jj', remind: true })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fired).toEqual([reminder.id])
    expect(await cron.releaseHeld()).toEqual([])
  })

  it('forgets an owed task that was deleted before the release', async () => {
    const paused = { value: true }
    const { cron, fired } = await boot(paused)
    vi.useFakeTimers()
    const task = await cron.saveTask({ name: 'Digest', schedule: { kind: 'every', seconds: 60 }, cwd: '/Users/jj/Project', prompt: 'Write the digest.' })
    await vi.advanceTimersByTimeAsync(60_000)
    await cron.deleteTask(task.id)
    paused.value = false
    expect(await cron.releaseHeld()).toEqual([])
    expect(fired).toEqual([])
  })
})

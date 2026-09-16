// The task document: a one-off task round-trips with its remind and done
// marks, and the change hook fires on every task-list write and never on a
// run record (the pane refetches on the former only).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CronStore, cronStorePath } from '../src/store.ts'
import type { CronTask } from '../src/store.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const dentist: CronTask = {
  id: 'dentist',
  name: 'Dentist',
  schedule: { kind: 'at', at: '2099-03-04T09:30:00.000Z' },
  prompt: '',
  cwd: '/Users/jj/Life',
  remind: true,
  enabled: true,
  createdAt: '2026-09-08T10:00:00.000Z',
}

describe('the cron store', () => {
  it('keeps a one-off reminder, its remind mark, and later its done mark', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-cron-store-'))
    const store = new CronStore(cronStorePath(root))
    await store.upsertTask(dentist)
    expect(await store.tasks()).toEqual([dentist])
    await store.upsertTask({ ...dentist, done: '2099-03-04T09:30:01.000Z' })
    const [stored] = await store.tasks()
    expect(stored).toMatchObject({ schedule: { kind: 'at' }, remind: true, done: '2099-03-04T09:30:01.000Z' })
    const raw = JSON.parse(await readFile(cronStorePath(root), 'utf8')) as { tasks: CronTask[] }
    expect(raw.tasks[0]?.done).toBe('2099-03-04T09:30:01.000Z')
  })

  it('reports a change after each task write and not after a run record', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-cron-store-'))
    const changed = vi.fn()
    const store = new CronStore(cronStorePath(root), changed)
    await store.upsertTask(dentist)
    expect(changed).toHaveBeenCalledTimes(1)
    await store.recordRun({ taskId: 'dentist', firedAt: '2099-03-04T09:30:00.000Z', status: 'ok', durationMs: 1 })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(await store.deleteTask('dentist')).toBe(true)
    expect(changed).toHaveBeenCalledTimes(2)
    // Deleting an unknown id writes nothing and reports nothing.
    expect(await store.deleteTask('dentist')).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('reads a document that names only one of the two lists', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-cron-store-'))
    const path = cronStorePath(root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ tasks: [dentist] }))

    const store = new CronStore(path)
    expect((await store.tasks()).map(task => task.id)).toEqual(['dentist'])
    expect(await store.runs()).toEqual([])

    await writeFile(path, JSON.stringify({ runs: [{ taskId: 'dentist', at: '2026-09-10T09:00:00.000Z', status: 'ok' }] }))
    const runsOnly = new CronStore(path)
    expect(await runsOnly.tasks()).toEqual([])
    expect(await runsOnly.runs()).toHaveLength(1)
  })

  it('keeps the last 500 runs and answers for one task alone', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-cron-store-'))
    const path = cronStorePath(root)
    await mkdir(dirname(path), { recursive: true })
    // Seeded at the cap so one more recording is what trims the oldest.
    const seeded = Array.from({ length: 500 }, (_row, index) => ({
      taskId: index % 2 === 0 ? 'dentist' : 'other',
      firedAt: `2026-09-10T00:00:00.${String(index).padStart(3, '0')}Z`,
      status: 'ok' as const,
    }))
    await writeFile(path, JSON.stringify({ tasks: [], runs: seeded }))

    const store = new CronStore(path)
    await store.recordRun({ taskId: 'dentist', firedAt: '2026-09-11T00:00:00.000Z', status: 'ok' })
    const all = await store.runs()
    expect(all).toHaveLength(500)
    expect(all[0]?.firedAt).toBe('2026-09-10T00:00:00.001Z')
    expect((await store.runs('dentist')).every(run => run.taskId === 'dentist')).toBe(true)
  })

  it('lets the next call run after one that failed', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-cron-store-'))
    // A directory where the document belongs: the write cannot land.
    const path = cronStorePath(root)
    await mkdir(path, { recursive: true })
    const store = new CronStore(path)
    await expect(store.upsertTask(dentist)).rejects.toThrow()
    expect(await store.tasks()).toEqual([])
  })
})

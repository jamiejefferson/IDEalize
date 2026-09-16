// @vitest-environment jsdom
/**
 * SCH-06 / AC-43: tasks written before Schedule's seat moved are still the
 * tasks this view shows. Nothing about the record changed, and the
 * proof is that nothing had to: a document produced by `@idealize/cron`'s own
 * `CronStore` — the single owner of task ids, fields and file format, left
 * untouched by this slice — reads straight back into the view.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { CronStore, cronStorePath } from '@idealize/cron'
import type { CronTask } from '@idealize/cron'
import { ScheduleView } from '../src/client/ScheduleView.tsx'
import type { ScheduleViewProps } from '../src/client/ScheduleView.tsx'
import { createScheduleStore } from '../src/client/store.ts'
import type { ScheduleTranslate } from '../src/client/schedule-model.ts'
import { en } from '../src/client/locales.ts'

const t: ScheduleTranslate = makeTranslate(en, commonEn)

/** Two tasks exactly as the rail pane saved them before this slice. */
const EXISTING: CronTask[] = [
  {
    id: 'task-brief',
    name: 'Daily product brief',
    schedule: { kind: 'weekly', at: '09:00', timeZone: 'Europe/London', days: [1, 2, 3, 4, 5] },
    prompt: 'Summarise yesterday’s progress.',
    cwd: '/Users/jj/Briefs',
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'task-builds',
    name: 'Watch failed builds',
    schedule: { kind: 'every', seconds: 1800 },
    prompt: 'Check CI.',
    cwd: '/Users/jj/idealize',
    enabled: true,
    createdAt: '2026-08-02T00:00:00.000Z',
  },
]

let home: string

beforeEach(async () => {
  // A Thursday, so the weekday task fires on the shown week's weekdays.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 7, 20, 10, 0) })
  home = await mkdtemp(join(tmpdir(), 'idealize-schedule-continuity-'))
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await rm(home, { recursive: true, force: true })
})

describe('tasks that predate the seat move', () => {
  it('reads a pre-existing idealize-cron.json through the view unchanged', async () => {
    // The document as it sits on a user's disk today.
    const path = cronStorePath(home)
    await writeFile(path, JSON.stringify({ tasks: EXISTING, runs: [] }, null, 2))

    // Read back through the owning package's own store, not a hand parser.
    const store = new CronStore(path)
    const tasks = await store.tasks()
    expect(tasks.map(task => task.id)).toEqual(['task-brief', 'task-builds'])

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify(tasks.map(task => ({ ...task, running: false }))),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))))

    const position = createScheduleStore()
    const view = render(<ScheduleView {...({
      useSchedule: bindSnapshotSelector(position.state),
      setDate: position.setDate,
      setMode: position.setMode,
      setGrain: position.setGrain,
      workspaces: () => [],
      currentCwd: () => undefined,
      ensureSession: () => Promise.resolve(null),
      t,
    } as unknown as ScheduleViewProps)} />)

    // Both records render, keyed by the ids the cron store minted: the
    // interval task in the Day lane's ALL DAY row, the weekday task as a block.
    expect((await view.findAllByText('Watch failed builds')).length).toBe(1)
    expect(view.container.querySelector('[data-schedule-allday] [data-schedule-task="task-builds"]')).not.toBeNull()
    expect(view.container.querySelector('[data-schedule-lane] [data-schedule-task="task-brief"]')).not.toBeNull()
    // And in the Week grid: the interval task in every column, the weekday task on the five weekdays.
    act(() => { position.setGrain('week') })
    await waitFor(() => { expect(view.getAllByText('Watch failed builds').length).toBe(7) })
    const item = view.container.querySelector('[data-schedule-task="task-brief"]')
    expect(item?.getAttribute('title')).toContain('Daily product brief · WEEKDAYS')

    // And the view left the document alone: reading is not a migration.
    expect(JSON.parse(await readFile(path, 'utf8')) as unknown).toEqual({ tasks: EXISTING, runs: [] })
  })
})

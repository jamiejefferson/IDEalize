// @vitest-environment jsdom
// The Schedule pane's states over a stubbed cron service: the Day lane the
// "calendar wires" frame leads with (all-day row, hour blocks, drag to
// reschedule, tap a slot to create), the Week grid behind the switcher, the
// load states, the task editor, and Create with chat — plus the position store
// that carries the navigated day, the grain and an open editor across the
// drawer unmounting the pane. Nothing persists to storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { SessionBinding } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ScheduleView } from '../src/client/ScheduleView.tsx'
import type { ScheduleViewProps } from '../src/client/ScheduleView.tsx'
import { createScheduleStore } from '../src/client/store.ts'
import type { ScheduleStore } from '../src/client/store.ts'
import {
  detailLine, laneBlocks, laneHours, occursOn, parseDraft, repeatBadge, snapMinutes, startOf, tappedSchedule, timeOf, withTime,
} from '../src/client/schedule-model.ts'
import type { ScheduleTranslate, TaskView } from '../src/client/schedule-model.ts'
import { en } from '../src/client/locales.ts'

const t: ScheduleTranslate = makeTranslate(en, commonEn)

const LONDON = 'Europe/London'

const brief: TaskView = {
  id: 'brief',
  name: 'Daily product brief',
  schedule: { kind: 'weekly', at: '09:00', timeZone: LONDON, days: [1, 2, 3, 4, 5] },
  prompt: 'Summarise yesterday’s progress.',
  cwd: '/Users/jj/Briefs',
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  nextFireAt: '2099-01-01T09:00:00.000Z',
  running: false,
}

const builds: TaskView = {
  id: 'builds',
  name: 'Watch failed builds',
  schedule: { kind: 'every', seconds: 1800 },
  prompt: 'Check CI.',
  cwd: '/Users/jj/idealize',
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  nextFireAt: '2099-01-02T09:00:00.000Z',
  running: false,
}

/** Records every fetch; answers the cron + models routes from `tasks`. */
interface RecordedCall {
  url: string
  init?: { method?: string; body?: string }
}

function stubFetch(tasks: TaskView[]) {
  const calls: RecordedCall[] = []
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, ...init === undefined ? {} : { init } })
    if (url.startsWith('/idealize/cron/tasks') && init?.method === 'POST') {
      const saved = { ...JSON.parse(init.body ?? '{}') as TaskView, id: 'saved', running: false }
      return json(saved)
    }
    if (url.startsWith('/idealize/cron/tasks')) return json(tasks)
    if (url.startsWith('/idealize/cron/delete')) return json({ deleted: true })
    if (url.startsWith('/idealize/models/state')) {
      return json({ mode: 'auto', default: { provider: 'openai', model: 'codex' }, preferences: {}, providers: [] })
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }))
  return calls
}

/** The view's injected face over a real position store, as the service builds it. */
function face(store: ScheduleStore, overrides: Partial<ScheduleViewProps> = {}) {
  return {
    useSchedule: bindSnapshotSelector(store.state),
    setDate: store.setDate,
    setMode: store.setMode,
    setGrain: store.setGrain,
    workspaces: () => [{ name: 'Briefs', path: '/Users/jj/Briefs' }],
    currentCwd: () => '/Users/jj/Briefs',
    ensureSession: () => Promise.resolve(null),
    t,
    ...overrides,
  } as unknown as ScheduleViewProps
}

function mount(overrides: Partial<ScheduleViewProps> = {}, store = createScheduleStore()) {
  const props = face(store, overrides)
  return { view: render(<ScheduleView {...props} />), store }
}

/** Mount on the Week grid (the Day lane is the default). */
function mountWeek(overrides: Partial<ScheduleViewProps> = {}, store = createScheduleStore()) {
  store.setGrain('week')
  return mount(overrides, store)
}

const triage: TaskView = {
  id: 'triage',
  name: 'Triage feedback',
  schedule: { kind: 'weekly', at: '11:05', timeZone: LONDON, days: [2, 4] },
  prompt: 'Triage.',
  cwd: '/Users/jj/idealize',
  provider: 'anthropic',
  model: 'claude',
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  nextFireAt: '2099-01-03T09:00:00.000Z',
  running: false,
}

beforeEach(() => {
  // A Thursday on the working week so every weekly fixture shows in the week grid.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 7, 20, 10, 0) })
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

describe('schedule model', () => {
  it('names repeats the way the wireframe badges do', () => {
    expect(repeatBadge(brief.schedule, t)).toBe('WEEKDAYS')
    expect(repeatBadge(builds.schedule, t)).toBe('EVERY 30 MIN')
    expect(repeatBadge({ kind: 'every', seconds: 7200 }, t)).toBe('EVERY 2 HOURS')
    expect(repeatBadge({ kind: 'weekly', at: '11:05', timeZone: LONDON, days: [4, 2] }, t)).toBe('TUE + THU')
    expect(repeatBadge({ kind: 'weekly', at: '13:00', timeZone: LONDON, days: [4] }, t)).toBe('THURSDAY')
  })

  it('reads a draft out of a fenced reply', () => {
    const reply = 'Done.\n```json\n{"name":"Brief","schedule":{"kind":"weekly","at":"09:00","days":[1,2,3,4,5]},"prompt":"Review."}\n```'
    expect(parseDraft(reply, LONDON)).toEqual({
      name: 'Brief',
      schedule: { kind: 'weekly', at: '09:00', timeZone: LONDON, days: [1, 2, 3, 4, 5] },
      prompt: 'Review.',
    })
    expect(parseDraft('no block here', LONDON)).toBeUndefined()
  })

  it('lays the day lane out from the frame: 08:00–14:00 widened to fit, 72px an hour, overlaps one column right', () => {
    expect(laneHours([])).toEqual({ start: 8, end: 14 })
    expect(laneHours([6 * 60 + 30, 17 * 60])).toEqual({ start: 6, end: 19 })
    expect(timeOf(9 * 60 + 5)).toBe('09:05')
    expect(snapMinutes(9 * 60 + 7, 15)).toBe(9 * 60)
    expect(snapMinutes(23 * 60 + 59, 15)).toBe(23 * 60 + 45)
    const placed = laneBlocks([triage, brief, builds], 8)
    expect(placed.map(block => [block.task.id, block.top, block.column])).toEqual([['brief', 72, 0], ['triage', 222, 0]])
    const clash = laneBlocks([brief, { ...triage, schedule: { ...triage.schedule, at: '09:30' } }], 8)
    expect(clash.map(block => block.column)).toEqual([0, 1])
    expect(detailLine(brief, t)).toBe('09:00 · Default · Briefs')
    expect(detailLine(triage, t)).toBe('11:05 · anthropic · claude · idealize')
  })

  it('maps a tap to a draft schedule on the tapped day at the tapped time', () => {
    expect(tappedSchedule(new Date(2026, 7, 20), '14:35', LONDON))
      .toEqual({ kind: 'weekly', at: '14:35', timeZone: LONDON, days: [4] })
    expect(tappedSchedule(new Date(2026, 7, 23), '09:00', LONDON))
      .toEqual({ kind: 'weekly', at: '09:00', timeZone: LONDON, days: [0] })
  })
})

describe('the Schedule view’s Day lane', () => {
  it('opens on today’s lane: interval tasks in ALL DAY, timed tasks as blocks at their hour with the detail line', async () => {
    stubFetch([brief, builds, triage])
    const { view } = mount()
    expect(view.getByRole('tab', { name: 'Day' }).getAttribute('aria-selected')).toBe('true')
    const allDay = await view.findByText('Watch failed builds')
    expect(allDay.closest('[data-schedule-allday]')).not.toBeNull()
    expect(view.getByText('ALL DAY')).toBeTruthy()
    // Thursday 20 Aug: the weekday brief at 09:00 (one hour below the 08:00 start) and the TUE + THU triage at 11:05.
    const block = view.container.querySelector('[data-schedule-task="brief"]') as HTMLElement
    expect(block.style.top).toBe(`${String(72 + 2)}px`)
    expect(block.getAttribute('data-tone')).toBe('next')
    expect(view.getByText('09:00 · Default · Briefs')).toBeTruthy()
    expect(view.getByText('WEEKDAYS')).toBeTruthy()
    expect(view.getByText('Triage feedback')).toBeTruthy()
    expect(view.getByText('TUE + THU')).toBeTruthy()
    // Tomorrow is Friday: the triage task does not occur, the brief does.
    fireEvent.click(view.getByRole('button', { name: 'Next' }))
    expect(view.getByText('21 August 2026')).toBeTruthy()
    expect(view.queryByText('Triage feedback')).toBeNull()
    expect(view.getByText('Daily product brief')).toBeTruthy()
  })

  it('drags a block to another time and saves it snapped to the quarter hour; a plain click opens the editor', async () => {
    const calls = stubFetch([brief])
    const { view } = mount()
    const block = await view.findByText('Daily product brief')
    // 100px down the 72px-an-hour lane is 83 minutes: 09:00 becomes 10:23, snapped to 10:30.
    fireEvent.pointerDown(block, { button: 0, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(block, { clientY: 300, pointerId: 1 })
    expect(view.getByText('Drag a task to change its schedule.')).toBeTruthy()
    fireEvent.pointerUp(block, { pointerId: 1 })
    fireEvent.click(block)
    await waitFor(() => {
      const post = calls.find(call => call.url === '/idealize/cron/tasks' && call.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post?.init?.body ?? '{}') as TaskView).toMatchObject({ id: 'brief', schedule: { kind: 'weekly', at: '10:30' } })
    })
    expect(await view.findByRole('status')).toHaveProperty('textContent', 'Daily product brief moved to 10:30')
    expect(view.queryByRole('heading', { name: 'Edit task' })).toBeNull()
    // A press that does not travel is a click.
    const again = view.getByText('Daily product brief')
    fireEvent.pointerDown(again, { button: 0, clientY: 200, pointerId: 2 })
    fireEvent.pointerUp(again, { pointerId: 2 })
    fireEvent.click(again)
    expect(await view.findByRole('heading', { name: 'Edit task' })).toBeTruthy()
  })

  it('opens Create-with-chat seeded with the tapped half hour on an empty lane slot', async () => {
    stubFetch([])
    const { view } = mount()
    await view.findByText('20 August 2026')
    const lane = view.getByRole('group', { name: 'Hours on Thursday' })
    // 180px into the lane from 08:00 is 10:30.
    fireEvent.click(lane, { clientY: 180 })
    expect(await view.findByRole('heading', { name: 'New scheduled task' })).toBeTruthy()
    expect(view.getByText(/Planned for Thursday at 10:30/)).toBeTruthy()
  })
})

describe('the Schedule view’s Week grid', () => {
  it('shows the Week calendar behind the switcher: each task under its day column, the soonest fire highlighted', async () => {
    stubFetch([brief, builds])
    const { view } = mount()
    fireEvent.click(await view.findByRole('tab', { name: 'Week' }))
    await waitFor(() => { expect(view.getAllByText('Watch failed builds').length).toBe(7) })
    // The weekday task fires Monday to Friday of the shown week, not the weekend.
    expect(view.getAllByText('Daily product brief').length).toBe(5)
    expect(view.container.querySelectorAll('[data-schedule-task="brief"][data-tone="next"]').length).toBe(5)
    expect(view.getByText('20 August 2026')).toBeTruthy()
    expect(view.getByText('Plan and manage recurring tasks.')).toBeTruthy()
  })

  it('opens the editor from a week item, saves the edited name, and deletes on confirm', async () => {
    const calls = stubFetch([brief])
    const { view } = mountWeek()
    fireEvent.click((await view.findAllByText('Daily product brief'))[0]!)
    expect(await view.findByRole('heading', { name: 'Edit task' })).toBeTruthy()
    expect(view.getByText('Every weekday')).toBeTruthy()
    expect(view.getByText('09:00 · Europe/London')).toBeTruthy()
    fireEvent.change(view.getByLabelText('Task name'), { target: { value: 'Morning brief' } })
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      const post = calls.find(call => call.url === '/idealize/cron/tasks' && call.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post?.init?.body ?? '{}') as TaskView).toMatchObject({ id: 'brief', name: 'Morning brief' })
    })
    expect(await view.findByText('Plan and manage recurring tasks.')).toBeTruthy()

    fireEvent.click((await view.findAllByText('Daily product brief'))[0]!)
    fireEvent.click(await view.findByRole('button', { name: 'Delete task' }))
    fireEvent.click(view.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => {
      expect(calls.some(call => call.url === '/idealize/cron/delete?id=brief')).toBe(true)
    })
  })

  it('opens Create-with-chat seeded 09:00 from a tap on an empty week column', async () => {
    stubFetch([])
    const { view } = mountWeek()
    const dashes = await view.findAllByText('—')
    const monday = dashes[0]?.parentElement as HTMLElement
    fireEvent.click(monday)
    expect(await view.findByRole('heading', { name: 'New scheduled task' })).toBeTruthy()
    expect(view.getByText(/Planned for Monday at 09:00/)).toBeTruthy()
  })

  it('hands the tapped slot to the create chat as the seeded default schedule', async () => {
    stubFetch([])
    const prompt = vi.fn((_content: { type: string; text: string }[]) => Promise.resolve({ ok: true }))
    const binding = {
      sessionId: 'session-3',
      session: {
        getSnapshot: () => ({ running: false, chat: { order: [], nodes: new Map() } }),
        subscribe: () => () => undefined,
        prompt,
      },
      ctx: {},
    } as unknown as SessionBinding
    const { view } = mountWeek({ ensureSession: () => Promise.resolve(binding) })
    const dashes = await view.findAllByText('—')
    // Thursday's column is the fourth of the Monday-first week.
    fireEvent.click(dashes[3]?.parentElement as HTMLElement)
    await view.findByRole('heading', { name: 'New scheduled task' })
    fireEvent.change(view.getByLabelText('Describe the task'), { target: { value: 'Water the plants' } })
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    await waitFor(() => { expect(prompt).toHaveBeenCalled() })
    const seeded = (prompt.mock.calls[0]?.[0] ?? [])[0]?.text ?? ''
    expect(seeded).toContain('"at":"09:00"')
    expect(seeded).toContain('"days":[4]')
    expect(seeded).toContain('default the schedule to it')
  })

  it('creates with chat: seeds the session prompt, shows the parsed draft, and posts it', async () => {
    const calls = stubFetch([])
    let listener: (() => void) | undefined
    let order: string[] = []
    const nodes = new Map<string, unknown>()
    const prompt = vi.fn((content: { type: string; text: string }[]) => {
      nodes.set('u1', { kind: 'user', key: 'u1', data: { content: [{ type: 'text', text: content[0]?.text ?? '' }] } })
      nodes.set('a1', {
        kind: 'assistant',
        key: 'a1',
        data: {
          status: 'done',
          blocks: [{ kind: 'text', text: 'I’ve turned that into a task.\n```json\n{"name":"Daily product brief","schedule":{"kind":"weekly","at":"09:00","days":[1,2,3,4,5]},"prompt":"Review yesterday’s work."}\n```' }],
        },
      })
      order = ['u1', 'a1']
      listener?.()
      return Promise.resolve({ ok: true })
    })
    const binding = {
      sessionId: 'session-1',
      session: {
        getSnapshot: () => ({ running: false, chat: { order, nodes } }),
        subscribe: (fn: () => void) => { listener = fn; return () => { listener = undefined } },
        prompt,
      },
      ctx: {},
    } as unknown as SessionBinding
    const ensureSession = vi.fn(() => Promise.resolve(binding))
    const { view } = mount({ ensureSession })
    await act(async () => { await Promise.resolve() })
    fireEvent.click(view.getByRole('button', { name: 'New task' }))
    expect(view.getByRole('heading', { name: 'New scheduled task' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Create task' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(view.getByLabelText('Describe the task'), { target: { value: 'Every weekday at 9, review yesterday’s work.' } })
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    await waitFor(() => { expect(ensureSession).toHaveBeenCalledWith('/Users/jj/Briefs') })
    await waitFor(() => { expect(prompt).toHaveBeenCalled() })
    const seeded = (prompt.mock.calls[0]?.[0] ?? [])[0]?.text ?? ''
    expect(seeded).toContain('scheduled task in IDEalize')
    // The user's words lead, so the session title derives from them.
    expect(seeded.startsWith('Every weekday at 9')).toBe(true)
    // The transcript shows the user's words, not the seed; the draft card reads the block.
    expect(await view.findByText('Every weekday at 9, review yesterday’s work.')).toBeTruthy()
    expect(view.queryByText(/scheduled task in IDEalize/)).toBeNull()
    expect(view.getByText('TASK DRAFT')).toBeTruthy()
    expect(view.getByText('09:00 · WEEKDAYS')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Create task' }))
    await waitFor(() => {
      const post = calls.find(call => call.url === '/idealize/cron/tasks' && call.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post?.init?.body ?? '{}') as TaskView).toMatchObject({
        name: 'Daily product brief',
        cwd: '/Users/jj/Briefs',
        schedule: { kind: 'weekly', at: '09:00', days: [1, 2, 3, 4, 5] },
      })
    })
    expect(await view.findByText('Plan and manage recurring tasks.')).toBeTruthy()
  })

  it('hands "Edit fields" to the editor as a new task', async () => {
    stubFetch([])
    const nodes = new Map<string, unknown>([
      ['a1', { kind: 'assistant', key: 'a1', data: { status: 'done', blocks: [{ kind: 'text', text: '```json\n{"name":"Triage","schedule":{"kind":"every","seconds":1800},"prompt":"Triage feedback."}\n```' }] } }],
    ])
    const binding = {
      sessionId: 'session-2',
      session: {
        getSnapshot: () => ({ running: false, chat: { order: ['a1'], nodes } }),
        subscribe: () => () => undefined,
        prompt: () => Promise.resolve({ ok: true }),
      },
      ctx: {},
    } as unknown as SessionBinding
    const { view } = mount({ ensureSession: () => Promise.resolve(binding) })
    fireEvent.click(await view.findByRole('button', { name: 'New task' }))
    fireEvent.change(view.getByLabelText('Describe the task'), { target: { value: 'Triage feedback every half hour' } })
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    fireEvent.click(await view.findByRole('button', { name: 'Edit fields' }))
    expect(await view.findByRole('heading', { name: 'New task' })).toBeTruthy()
    expect((view.getByLabelText('Task name') as HTMLInputElement).value).toBe('Triage')
    expect(view.getByText('Every 30 minutes')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Create task' })).toBeTruthy()
  })
})

describe('the Schedule view’s Month grid', () => {
  it('shows six whole weeks of the navigated month, marking today and the days that carry work', async () => {
    stubFetch([brief, builds])
    const { view } = mount()
    fireEvent.click(await view.findByRole('tab', { name: 'Month' }))
    const grid = await waitFor(() => {
      const found = view.container.querySelector('[data-schedule-month]')
      expect(found).not.toBeNull()
      return found!
    })

    // Six rows of seven, Monday first, so the grid keeps its height as the
    // months change; August 2026 starts on a Saturday, so the first cell is
    // Monday 27 July.
    const cells = grid.querySelectorAll('[data-schedule-day]')
    expect(cells).toHaveLength(42)
    expect(cells[0]?.getAttribute('data-schedule-day')).toBe(new Date(2026, 6, 27).toDateString())
    expect(cells[0]?.hasAttribute('data-outside')).toBe(true)
    expect(grid.querySelector(`[data-schedule-day="${new Date(2026, 7, 1).toDateString()}"]`)?.hasAttribute('data-outside')).toBe(false)

    // The clock is 20 August 2026, which is both today and the navigated day.
    const today = grid.querySelector(`[data-schedule-day="${new Date(2026, 7, 20).toDateString()}"]`)
    expect(today?.hasAttribute('data-today')).toBe(true)
    expect(today?.hasAttribute('data-selected')).toBe(true)

    // The interval task runs every day and the weekday task on weekdays, so a
    // Thursday carries two and the Saturday after it one.
    // The cell shows a dot; the count is on the attribute and the label, so a
    // month of daily work does not read as a wall of identical numbers.
    expect(today?.querySelector('[data-schedule-count]')?.getAttribute('data-schedule-count')).toBe('2')
    expect(today?.getAttribute('aria-label')).toBe('20 August 2026, 2 scheduled')
    const saturday = grid.querySelector(`[data-schedule-day="${new Date(2026, 7, 22).toDateString()}"]`)
    expect(saturday?.querySelector('[data-schedule-count]')?.getAttribute('data-schedule-count')).toBe('1')

    // The navigator names the month, and the week strip is gone: the grid is
    // the day picker, and two of them would say the same thing twice.
    expect(view.getByText('August 2026')).toBeTruthy()
    expect(view.container.querySelector('[data-schedule-view] button[aria-pressed]')).toBeNull()
  })

  it('steps a whole month at a time, and lands on the day it is asked for', async () => {
    stubFetch([brief])
    const { view, store } = mount()
    fireEvent.click(await view.findByRole('tab', { name: 'Month' }))
    await waitFor(() => { expect(view.getByText('August 2026')).toBeTruthy() })

    fireEvent.click(view.getByRole('button', { name: 'Next' }))
    await waitFor(() => { expect(view.getByText('September 2026')).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: 'Previous' }))
    fireEvent.click(view.getByRole('button', { name: 'Previous' }))
    await waitFor(() => { expect(view.getByText('July 2026')).toBeTruthy() })

    // Picking a day is the whole job: the date moves and the Day lane opens on
    // it, which is where that day's work is read and changed.
    fireEvent.click(view.getByRole('button', { name: 'Today' }))
    await waitFor(() => { expect(view.getByText('August 2026')).toBeTruthy() })
    fireEvent.click(view.container.querySelector(`[data-schedule-day="${new Date(2026, 7, 25).toDateString()}"]`)!)
    await waitFor(() => { expect(store.state.getSnapshot().grain).toBe('day') })
    expect(new Date(store.state.getSnapshot().dateMs!).toDateString()).toBe(new Date(2026, 7, 25).toDateString())
    expect(view.getByText('25 August 2026')).toBeTruthy()
  })
})

describe('the Schedule view’s load states', () => {
  it('says it is loading, then shows the week, and never calls a column empty before the answer lands', async () => {
    let release: ((tasks: TaskView[]) => void) | undefined
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      // Only the task load is held back; the feed probe answers at once so it cannot take the release.
      if (!url.startsWith('/idealize/cron/tasks')) return Promise.resolve(new Response('not found', { status: 404 }))
      return new Promise<Response>((resolve) => {
        release = (tasks) => { resolve(new Response(JSON.stringify(tasks), { status: 200, headers: { 'content-type': 'application/json' } })) }
      })
    }))
    const { view } = mountWeek()
    expect(view.getByText('Loading the schedule…')).toBeTruthy()
    expect(view.queryByText('—')).toBeNull()
    await act(async () => { release?.([brief]); await Promise.resolve() })
    expect((await view.findAllByText('Daily product brief')).length).toBe(5)
    expect(view.queryByText('Loading the schedule…')).toBeNull()
  })

  it('states the cause of a failed load and recovers through Retry', async () => {
    let ok = false
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (!url.startsWith('/idealize/cron/tasks')) return Promise.resolve(new Response('not found', { status: 404 }))
      if (!ok) return Promise.resolve(new Response('down', { status: 503 }))
      return Promise.resolve(new Response(JSON.stringify([brief]), { status: 200, headers: { 'content-type': 'application/json' } }))
    }))
    const { view } = mountWeek()
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t reach the scheduler.')
    // The cause is the failure itself, not a generic apology (SCH-10).
    expect(alert.textContent).toContain('Cause: tasks 503')
    ok = true
    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    expect((await view.findAllByText('Daily product brief')).length).toBe(5)
    expect(view.queryByRole('alert')).toBeNull()
  })
})

describe('the Schedule view’s position store', () => {
  it('restores the navigated week, the grain and an open editor when the drawer remounts the pane', async () => {
    stubFetch([brief])
    const store = createScheduleStore()
    const first = mount({}, store)
    await first.view.findAllByText('Daily product brief')
    fireEvent.click(first.view.getByRole('tab', { name: 'Week' }))
    fireEvent.click(first.view.getByRole('button', { name: 'Next' }))
    expect(first.view.getByText('27 August 2026')).toBeTruthy()

    // What the drawer does to a closed pane: it unmounts it entirely.
    cleanup()
    const again = mount({}, store)
    expect(again.view.getByText('27 August 2026')).toBeTruthy()
    expect(again.view.getByRole('tab', { name: 'Week' }).getAttribute('aria-selected')).toBe('true')

    // An in-progress edit survives the same round trip.
    fireEvent.click((await again.view.findAllByText('Daily product brief'))[0]!)
    fireEvent.change(await again.view.findByLabelText('Task name'), { target: { value: 'Half-written' } })
    cleanup()
    const third = mount({}, store)
    expect(await third.view.findByRole('heading', { name: 'Edit task' })).toBeTruthy()
  })

  it('persists nothing: a relaunch opens on today’s Day lane', async () => {
    stubFetch([])
    const first = mount()
    await first.view.findByText('20 August 2026')
    // In the Day lane the arrows step one day.
    fireEvent.click(first.view.getByRole('button', { name: 'Next' }))
    expect(first.view.getByText('21 August 2026')).toBeTruthy()
    fireEvent.click(first.view.getByRole('tab', { name: 'Week' }))
    cleanup()

    // A relaunch: a brand-new store. Nothing was written to storage: the
    // navigated day and the grain never persisted — a calendar opens on today.
    expect(localStorage.length).toBe(0)
    const relaunched = mount({}, createScheduleStore())
    expect(await relaunched.view.findByText('20 August 2026')).toBeTruthy()
    expect(relaunched.view.getByRole('tab', { name: 'Day' }).getAttribute('aria-selected')).toBe('true')
  })
})

// ── One calendar for the agent and the pane (JJ, 8 Sep 2026) ────────────────

/** A one-off reminder on the fixture Thursday at 14:00 local, as calendar_add stores it. */
const dentist: TaskView = {
  id: 'dentist',
  name: 'Dentist',
  schedule: { kind: 'at', at: new Date(2026, 7, 20, 14, 0).toISOString() },
  prompt: '',
  cwd: '/Users/jj/Life',
  remind: true,
  enabled: true,
  createdAt: '2026-08-20T09:00:00.000Z',
  nextFireAt: new Date(2026, 7, 20, 14, 0).toISOString(),
  running: false,
}

/** The same reminder after it fired: `done` set, no next fire. */
const { nextFireAt: _pending, ...dentistFired } = dentist
void _pending
const dentistDone: TaskView = {
  ...dentistFired,
  id: 'dentist-done',
  name: 'Dentist (fired)',
  done: new Date(2026, 7, 20, 14, 0, 30).toISOString(),
}

/** A stand-in for the browser's EventSource that records its instances and lets a test push a frame. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((message: { data: string }) => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  close(): void { this.closed = true }
}

describe('one-off entries in the calendar', () => {
  it('names a one-off ONCE, places it on its day only, keeps its day when its time moves, and reads it out of a chat reply', () => {
    expect(repeatBadge(dentist.schedule, t)).toBe('ONCE')
    expect(occursOn(dentist.schedule, new Date(2026, 7, 20))).toBe(true)
    expect(occursOn(dentist.schedule, new Date(2026, 7, 21))).toBe(false)
    expect(startOf(dentist.schedule)).toBe('14:00')
    expect(startOf(builds.schedule)).toBe('00:00')
    expect(withTime(builds.schedule, '10:00')).toBe(builds.schedule)
    expect(detailLine(dentist, t)).toBe('14:00 · Default · Life')
    const moved = withTime(dentist.schedule, '10:30')
    expect(moved.kind).toBe('at')
    expect(new Date(moved.kind === 'at' ? moved.at : '').getTime()).toBe(new Date(2026, 7, 20, 10, 30).getTime())
    expect(parseDraft('```json\n{"name":"Dentist","schedule":{"kind":"at","at":"2099-03-04T09:30:00Z"},"prompt":""}\n```', LONDON))
      .toEqual({ name: 'Dentist', schedule: { kind: 'at', at: '2099-03-04T09:30:00.000Z' }, prompt: '' })
  })

  it('shows a one-off as a block on its day with the ONCE badge, and DONE once it has fired', async () => {
    stubFetch([dentist, dentistDone])
    const { view } = mount()
    const block = await view.findByText('Dentist')
    expect(block.closest('[data-schedule-task="dentist"]')).not.toBeNull()
    expect(view.getByText('ONCE')).toBeTruthy()
    // Fired: the block stays on its day, reads DONE, and takes the done tone instead of next.
    const done = view.container.querySelector('[data-schedule-task="dentist-done"]') as HTMLElement
    expect(done.getAttribute('data-tone')).toBe('done')
    expect(view.getByText('DONE')).toBeTruthy()
    expect(view.container.querySelector('[data-schedule-task="dentist"]')?.getAttribute('data-tone')).toBe('next')
    // The next day carries neither: a one-off has one day.
    fireEvent.click(view.getByRole('button', { name: 'Next' }))
    expect(view.queryByText('Dentist')).toBeNull()
    expect(view.queryByText('Dentist (fired)')).toBeNull()
  })

  it('lists a one-off once in the Week grid and counts it in the Month grid', async () => {
    stubFetch([dentist])
    const { view } = mountWeek()
    await waitFor(() => { expect(view.getAllByText('Dentist').length).toBe(1) })
    expect(view.getByText('14:00')).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: 'Month' }))
    await waitFor(() => {
      expect(view.container.querySelector('[data-schedule-day="Thu Aug 20 2026"] [data-schedule-count="1"]')).not.toBeNull()
    })
    expect(view.container.querySelector('[data-schedule-day="Fri Aug 21 2026"] [data-schedule-count]')).toBeNull()
  })

  it('opens a fired one-off in the editor stating when it fired, with the notify row on', async () => {
    stubFetch([dentistDone])
    const { view } = mount()
    fireEvent.click(await view.findByText('Dentist (fired)'))
    expect(await view.findByRole('heading', { name: 'Edit task' })).toBeTruthy()
    expect(view.getAllByText('Once, 20 August 2026 at 14:00').length).toBe(2)
    expect(view.getByText('Fired 20 August 2026 at 14:00')).toBeTruthy()
    const notify = view.getByLabelText('Desktop notification when it fires') as HTMLInputElement
    expect(notify.checked).toBe(true)
    // A reminder has no instructions, so its notification cannot be switched off.
    expect(notify.disabled).toBe(true)
  })

  it('refetches when the host bridge feed says the calendar changed, so an agent’s entry appears without a reopen', async () => {
    const tasks: TaskView[] = []
    const calls = stubFetch(tasks)
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    const { view } = mount()
    await view.findByText('20 August 2026')
    await waitFor(() => { expect(FakeEventSource.instances.length).toBe(1) })
    const [stream] = FakeEventSource.instances
    expect(stream?.url).toBe('/idealize/events/stream?since=0')
    const reads = () => calls.filter(call => call.url === '/idealize/cron/tasks' && call.init?.method !== 'POST').length
    expect(reads()).toBe(1)
    // The agent's calendar_add landed in the store; the bridge announces it.
    tasks.push(dentist)
    act(() => { stream?.onmessage?.({ data: JSON.stringify({ seq: 1, kind: 'cron-changed', title: 'Calendar changed', body: '' }) }) })
    expect(await view.findByText('Dentist')).toBeTruthy()
    expect(reads()).toBe(2)
    // Frames about other things do not refetch.
    act(() => { stream?.onmessage?.({ data: JSON.stringify({ seq: 2, kind: 'mail', title: '', body: '' }) }) })
    act(() => { stream?.onmessage?.({ data: ': comment' }) })
    expect(reads()).toBe(2)
    view.unmount()
    expect(stream?.closed).toBe(true)
  })
})

describe('the pane without a host bridge', () => {
  it('opens no stream when the feed probe fails, and still shows the tasks it loaded', async () => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/idealize/cron/tasks')) return json([brief])
      return Promise.reject(new Error('bridge absent'))
    }))
    const { view } = mount()
    expect(await view.findByText('Daily product brief')).toBeTruthy()
    await act(async () => { await Promise.resolve() })
    expect(FakeEventSource.instances.length).toBe(0)
  })
})

describe('editing a one-off', () => {
  it('turns a weekly task into a one-off from REPEAT, moves its date and time, toggles the notification, and saves a blank-instruction reminder with remind set', async () => {
    const calls = stubFetch([brief])
    const { view } = mountWeek()
    fireEvent.click((await view.findAllByText('Daily product brief'))[0]!)
    await view.findByRole('heading', { name: 'Edit task' })
    // A timed rule's RUN AT changes its clock time and zone in place.
    fireEvent.click(view.getByRole('button', { name: /RUN AT/ }))
    fireEvent.change(view.getByLabelText('Run at'), { target: { value: '10:15' } })
    fireEvent.change(view.getByLabelText('Time zone'), { target: { value: 'Europe/Paris' } })
    expect(view.getByText('10:15 · Europe/Paris')).toBeTruthy()
    // REPEAT → Once: the draft becomes a one-off an hour from now (11:00 on the fixture clock).
    fireEvent.click(view.getByRole('button', { name: /REPEAT/ }))
    fireEvent.change(view.getByLabelText('Repeat'), { target: { value: 'once' } })
    expect(view.getAllByText('Once, 20 August 2026 at 11:00').length).toBe(2)
    expect(view.getByText('Next run: today at 11:00')).toBeTruthy()
    // RUN AT now takes a date and time; the row opens and closes like the others.
    fireEvent.click(view.getByRole('button', { name: /RUN AT/ }))
    fireEvent.click(view.getByRole('button', { name: /RUN AT/ }))
    expect(view.queryByLabelText('Date and time')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /RUN AT/ }))
    const when = view.getByLabelText('Date and time') as HTMLInputElement
    expect(when.value).toBe('2026-08-20T11:00')
    fireEvent.change(when, { target: { value: '2026-08-21T09:30' } })
    expect(view.getAllByText('Once, 21 August 2026 at 09:30').length).toBe(2)
    expect(view.getByText('Next run: tomorrow at 09:30')).toBeTruthy()
    fireEvent.change(when, { target: { value: '' } })
    expect(view.getAllByText('Once, 21 August 2026 at 09:30').length).toBe(2)
    // NOTIFY toggles while there are instructions; blank instructions pin it on.
    const notify = view.getByLabelText('Desktop notification when it fires') as HTMLInputElement
    expect(notify.checked).toBe(false)
    fireEvent.click(notify)
    expect(view.getByText('Notify me when it fires')).toBeTruthy()
    fireEvent.click(notify)
    expect(view.getByText('No notification')).toBeTruthy()
    fireEvent.change(view.getByLabelText('Special instructions'), { target: { value: '' } })
    expect(notify.checked).toBe(true)
    expect(notify.disabled).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      const post = calls.find(call => call.url === '/idealize/cron/tasks' && call.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(post?.init?.body ?? '{}') as TaskView).toMatchObject({
        id: 'brief', prompt: '', remind: true, schedule: { kind: 'at', at: new Date(2026, 7, 21, 9, 30).toISOString() },
      })
    })
  })

  it('does not drag a fired one-off, and a drag that snaps back to the same quarter hour saves nothing', async () => {
    const calls = stubFetch([dentistDone, brief, { ...builds, enabled: false }])
    const { view } = mount()
    const done = await view.findByText('Dentist (fired)')
    fireEvent.pointerDown(done, { button: 0, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(done, { clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(done, { pointerId: 1 })
    const live = view.getByText('Daily product brief')
    // 6px is past the slop and 5 minutes down: snapped to the quarter hour it is still 09:00.
    fireEvent.pointerDown(live, { button: 0, clientY: 200, pointerId: 2 })
    fireEvent.pointerMove(live, { clientY: 206, pointerId: 2 })
    fireEvent.pointerUp(live, { pointerId: 2 })
    await act(async () => { await Promise.resolve() })
    expect(calls.some(call => call.init?.method === 'POST')).toBe(false)
    expect(view.container.querySelector('[data-schedule-task="builds"]')?.getAttribute('data-tone')).toBe('paused')
  })
})

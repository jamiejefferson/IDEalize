// The calendar the agent and the pane share: the tools write the same task
// document the routes do, in the calling chat's project; a fire raises the
// desktop notification through the notify sink; a one-off records done; every
// task-list write emits `idealize/cron-changed` ahead of the run's own event;
// and the standing prompt section reaches the assembled prompt.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, CALENDAR_SECTION, createCalendarTools, describeSchedule, desktopNotifier, fireTimeLine, IdealizeCron } from '../src/index.ts'
import type { CronNotifier } from '../src/index.ts'
import type { CronTask } from '../src/store.ts'

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.useRealTimers()
})

/** A scheduler over a temp document with a recording notify sink; `shell` false composes no desktop shell. */
interface Booted { cron: IdealizeCron; notified: { title: string; body: string }[]; events: string[] }

async function boot(shell = true, thrown?: unknown): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'idealize-calendar-'))
  ctx = new Context()
  const notified: { title: string; body: string }[] = []
  const sink: CronNotifier = {
    notify: (notification) => {
      if (thrown !== undefined) throw thrown
      notified.push(notification)
    },
  }
  const events: string[] = []
  ctx.on('idealize/cron-changed', () => { events.push('cron-changed') })
  ctx.on('idealize/cron-run', (run) => { events.push(`cron-run:${run.status}`) })
  await ctx.plugin(IdealizeCron, { storePath: join(root, 'idealize-cron.json'), notifier: () => shell ? sink : undefined })
  return { cron: ctx.idealizeCron, notified, events }
}

/** The tool execution context a chat in `cwd` supplies. */
const chatIn = (cwd?: string) => ({ agent: { session: { header: cwd === undefined ? {} : { cwd } } } }) as never

const LONDON = 'Europe/London'

describe('the calendar tools', () => {
  it('adds a one-off reminder to the person\'s calendar in the chat\'s project, lists it, and removes it', async () => {
    const { cron, events } = await boot()
    const [add, list, remove] = createCalendarTools(cron, LONDON)
    const entry = await add!.execute({ title: 'Dentist', at: '2099-03-04T09:30:00Z' }, chatIn('/Users/jj/Life')) as { id: string; remind: boolean; schedule: string; nextFireAt?: string }
    expect(entry).toMatchObject({ remind: true, schedule: 'once at 2099-03-04T09:30:00.000Z', nextFireAt: '2099-03-04T09:30:00.000Z' })
    const [stored] = await cron.store.tasks()
    // A reminder has no prompt, runs no agent, and notifies; it lives in the chat's folder.
    expect(stored).toMatchObject({ id: entry.id, name: 'Dentist', prompt: '', remind: true, cwd: '/Users/jj/Life', schedule: { kind: 'at' } })
    expect(events).toEqual(['cron-changed'])

    const listed = await list!.execute({}, chatIn()) as { id: string; title: string }[]
    expect(listed.map(item => item.title)).toEqual(['Dentist'])
    // Once fired, the entry lists as done with no next fire, and include_done false hides it.
    await cron.fire(entry.id)
    const [fired] = await list!.execute({}, chatIn()) as { done?: string; nextFireAt?: string }[]
    expect(typeof fired?.done).toBe('string')
    expect(fired?.nextFireAt).toBeUndefined()
    expect(await list!.execute({ include_done: false }, chatIn())).toEqual([])
    events.length = 0
    // The routes see the same document: the pane's task view is the tool's entry.
    expect((await cron.taskViews()).map(task => task.id)).toEqual([entry.id])

    expect(await remove!.execute({ id: entry.id }, chatIn())).toEqual({ id: entry.id, removed: true })
    expect(await cron.store.tasks()).toEqual([])
    expect(await remove!.execute({ id: entry.id }, chatIn())).toEqual({ id: entry.id, removed: false })
  })

  it('adds a repeating task with a prompt, defaulting the zone and keeping remind off unless asked', async () => {
    const { cron } = await boot()
    const [add] = createCalendarTools(cron, LONDON)
    await add!.execute({ title: 'Brief', weekly_at: '09:00', weekly_days: [1, 2, 3, 4, 5], prompt: 'Write the brief.' }, chatIn('/Users/jj/Briefs'))
    await add!.execute({ title: 'Standup', daily_at: '10:00', time_zone: 'Asia/Tokyo', prompt: 'Post the standup.', remind: true }, chatIn('/Users/jj/Briefs'))
    const tasks = await cron.store.tasks()
    expect(tasks[0]).toMatchObject({ name: 'Brief', schedule: { kind: 'weekly', at: '09:00', timeZone: LONDON, days: [1, 2, 3, 4, 5] }, prompt: 'Write the brief.' })
    expect(tasks[0]?.remind).toBeUndefined()
    expect(tasks[1]).toMatchObject({ name: 'Standup', schedule: { kind: 'daily', at: '10:00', timeZone: 'Asia/Tokyo' }, remind: true })
  })

  it('refuses a past one-off, an ambiguous when, a chat without a folder, and weekly without days', async () => {
    const { cron } = await boot()
    const [add] = createCalendarTools(cron, LONDON)
    await expect(add!.execute({ title: 'Late', at: '2000-01-01T00:00:00Z' }, chatIn('/Users/jj/Life'))).rejects.toThrow(/in the past/)
    await expect(add!.execute({ title: 'Both', at: '2099-01-01T00:00:00Z', every_seconds: 60 }, chatIn('/Users/jj/Life'))).rejects.toThrow(/exactly one of/)
    await expect(add!.execute({ title: 'Never' }, chatIn('/Users/jj/Life'))).rejects.toThrow(/exactly one of/)
    await expect(add!.execute({ title: 'Nowhere', at: '2099-01-01T00:00:00Z' }, chatIn())).rejects.toThrow(/no project folder/)
    await expect(add!.execute({ title: 'Weekly', weekly_at: '09:00' }, chatIn('/Users/jj/Life'))).rejects.toThrow(/weekly_days/)
    await expect(add!.execute({ title: 'Fast', every_seconds: 5, prompt: 'x' }, chatIn('/Users/jj/Life'))).rejects.toThrow(/at least 60/)
    expect(await cron.store.tasks()).toEqual([])
  })
})

describe('a fire', () => {
  it('notifies the person for a reminder, runs nothing, records done, and announces the change before the run', async () => {
    const { cron, notified, events } = await boot()
    const task = await cron.saveTask({ name: 'Dentist', schedule: { kind: 'at', at: '2099-03-04T09:30:00.000Z' }, prompt: '', remind: true, cwd: '/Users/jj/Life' })
    events.length = 0
    const run = await cron.fire(task.id)
    expect(run).toMatchObject({ taskId: task.id, status: 'ok', detail: 'reminder' })
    expect(run.sessionId).toBeUndefined()
    expect(typeof run.durationMs).toBe('number')
    expect(notified).toEqual([{ title: 'Dentist', body: fireTimeLine(run.firedAt) }])
    expect(notified[0]?.body).toMatch(/\d{2}:\d{2}/)
    const [stored] = await cron.store.tasks()
    expect(stored?.done).toBe(run.firedAt)
    // The pane refetches on cron-changed and already finds the task done when the run lands.
    expect(events).toEqual(['cron-changed', 'cron-run:ok'])
    expect((await cron.taskViews())[0]?.nextFireAt).toBeUndefined()
    // Renaming the fired reminder still saves: the past-instant refusal exempts a done task.
    await expect(cron.saveTask({ ...stored!, name: 'Dentist (done)' })).resolves.toMatchObject({ name: 'Dentist (done)', done: run.firedAt })
  })

  it('notifies beside the agent run when a prompted task asks to remind, in the task\'s zone', async () => {
    const { cron, notified } = await boot()
    const task = await cron.saveTask({ name: 'Standup', schedule: { kind: 'daily', at: '10:00', timeZone: 'Asia/Tokyo' }, prompt: 'Post it.', remind: true, cwd: '/Users/jj/Briefs' })
    // No agent services are composed here, so the run itself fails; the notification does not wait on it.
    const run = await cron.fire(task.id)
    expect(run.status).toBe('error')
    expect(run.detail).toMatch(/agent services unavailable/)
    expect(notified).toEqual([{ title: 'Standup', body: fireTimeLine(run.firedAt, 'Asia/Tokyo') }])
    expect((await cron.store.tasks())[0]?.done).toBeUndefined()
  })

  it('stays silent for a prompted task without remind, and drops the notification when no desktop shell is composed', async () => {
    const { cron, notified } = await boot(false)
    const quiet = await cron.saveTask({ name: 'Quiet', schedule: { kind: 'every', seconds: 3600 }, prompt: 'Check CI.', cwd: '/Users/jj/idealize' })
    await cron.fire(quiet.id)
    const loud = await cron.saveTask({ name: 'Loud', schedule: { kind: 'at', at: '2099-01-01T00:00:00.000Z' }, prompt: '', remind: true, cwd: '/Users/jj/idealize' })
    const run = await cron.fire(loud.id)
    expect(run.status).toBe('ok')
    expect(notified).toEqual([])
  })

  it('refuses a reminder-less task with no prompt on the routes\' path too, and the older refusals still hold', async () => {
    const { cron } = await boot()
    const input: Partial<CronTask> = { name: 'Blank', schedule: { kind: 'every', seconds: 60 }, prompt: '   ', cwd: '/Users/jj/x' }
    await expect(cron.saveTask(input)).rejects.toThrow(/needs a prompt, or remind/)
    await expect(cron.saveTask({ name: 'No when', prompt: 'x', cwd: '/Users/jj/x' })).rejects.toThrow(/needs a schedule/)
    await expect(cron.saveTask({ ...input, prompt: 'x', cwd: 'relative' })).rejects.toThrow(/absolute cwd/)
  })

  it('logs and carries on when the desktop shell throws on notify, and disarms a timer when its task is deleted', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-calendar-'))
    ctx = new Context()
    const warnings: string[] = []
    ctx.logger.warn = ((message: string) => { warnings.push(message) }) as typeof ctx.logger.warn
    await ctx.plugin(IdealizeCron, {
      storePath: join(root, 'idealize-cron.json'),
      notifier: () => ({ notify: () => { throw new Error('shell went away') } }),
    })
    const cron = ctx.idealizeCron
    const task = await cron.saveTask({ name: 'Loud', schedule: { kind: 'every', seconds: 3600 }, prompt: '', remind: true, cwd: '/Users/jj/x' })
    const run = await cron.fire(task.id)
    expect(run.status).toBe('ok')
    expect(warnings).toEqual(['idealize-cron: notification failed: shell went away'])
    // The hourly task is armed; deleting it clears the timer and the record.
    expect(await cron.deleteTask(task.id)).toBe(true)
    expect(await cron.taskViews()).toEqual([])
  })
})

describe('the calendar prompt section', () => {
  it('reaches the assembled prompt in the tool-guidance band after the artefacts section', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-calendar-'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '', includeHarnessIdentity: false, includeRuntimeContext: false })
    process.env.DSH_HOME = root
    try {
      apply(ctx)
      await vi.waitFor(async () => {
        expect((await ctx!.systemPrompt.assemble({})).sections.map(section => section.name)).toContain(CALENDAR_SECTION.name)
      })
      const assembly = await ctx.systemPrompt.assemble({})
      const names = assembly.sections.map(section => section.name)
      expect(names.indexOf(CALENDAR_SECTION.name)).toBeGreaterThan(names.indexOf('deployment:persona'))
      expect(CALENDAR_SECTION.order).toBe(122)
      expect(renderPrompt(assembly)).toContain('calendar_add, calendar_list, calendar_remove')
    } finally {
      delete process.env.DSH_HOME
    }
  })
})

describe('what the model reads back', () => {
  const entry = {
    id: 'e1', title: 'Dentist', schedule: 'once at 2099-03-04T09:30:00.000Z', enabled: true, remind: true, prompt: '', cwd: '/Users/jj/Life',
  }

  it('describes every schedule kind as a sentence', () => {
    expect(describeSchedule({ kind: 'at', at: '2099-03-04T09:30:00.000Z' })).toBe('once at 2099-03-04T09:30:00.000Z')
    expect(describeSchedule({ kind: 'every', seconds: 900 })).toBe('every 900 seconds')
    expect(describeSchedule({ kind: 'daily', at: '10:00', timeZone: 'Asia/Tokyo' })).toBe('daily at 10:00 (Asia/Tokyo)')
    expect(describeSchedule({ kind: 'weekly', at: '09:00', timeZone: LONDON, days: [1, 5] })).toBe('weekly on days [1, 5] at 09:00 (Europe/London)')
  })

  it('reports a saved entry from the task itself when the view list has not caught up', async () => {
    const saved: CronTask = {
      id: 'late',
      name: 'Late',
      schedule: { kind: 'every', seconds: 60 },
      prompt: 'x',
      cwd: '/p',
      enabled: true,
      createdAt: '2026-09-08T00:00:00.000Z',
    }
    const [add] = createCalendarTools({
      saveTask: () => Promise.resolve(saved),
      taskViews: () => Promise.resolve([]),
      deleteTask: () => Promise.resolve(false),
    }, LONDON)
    expect(await add!.execute({ title: 'Late', every_seconds: 60, prompt: 'x' }, chatIn('/p'))).toEqual({
      id: 'late', title: 'Late', schedule: 'every 60 seconds', enabled: true, remind: false, prompt: 'x', cwd: '/p',
    })
  })

  it('renders the add, list and remove results as plain lines, and titles the pending cards', () => {
    const [add, list, remove] = createCalendarTools({
      saveTask: () => Promise.reject(new Error('unused')),
      taskViews: () => Promise.resolve([]),
      deleteTask: () => Promise.resolve(false),
    }, LONDON)
    const text = (blocks: { type: string; text?: string }[]): string => blocks.map(block => block.text ?? '').join('')
    expect(text(add!.output.render({}, { ...entry, nextFireAt: '2099-03-04T09:30:00.000Z' })))
      .toBe('Added "Dentist" to the calendar (e1): once at 2099-03-04T09:30:00.000Z; next 2099-03-04T09:30:00.000Z; the person will be notified.')
    expect(text(add!.output.render({}, { ...entry, remind: false }))).toBe('Added "Dentist" to the calendar (e1): once at 2099-03-04T09:30:00.000Z.')
    expect(text(list!.output.render({}, []))).toBe('The calendar is empty.')
    expect(text(list!.output.render({}, [
      { ...entry, done: '2099-03-04T09:30:01.000Z' },
      { ...entry, id: 'e2', title: 'Brief', nextFireAt: '2099-03-05T09:00:00.000Z' },
      { ...entry, id: 'e3', title: 'Paused', enabled: false },
      { ...entry, id: 'e4', title: 'Plain' },
    ]))).toBe([
      '- Dentist (e1): once at 2099-03-04T09:30:00.000Z; fired 2099-03-04T09:30:01.000Z',
      '- Brief (e2): once at 2099-03-04T09:30:00.000Z; next 2099-03-05T09:00:00.000Z',
      '- Paused (e3): once at 2099-03-04T09:30:00.000Z; paused',
      '- Plain (e4): once at 2099-03-04T09:30:00.000Z',
    ].join('\n'))
    expect(text(remove!.output.render({}, { id: 'e1', removed: true }))).toBe('Removed calendar entry e1.')
    expect(text(remove!.output.render({}, { id: 'e1', removed: false }))).toBe('No calendar entry has the id e1.')
    expect(add!.presentCall?.({ title: 'Dentist' })).toEqual({ card: 'generic', title: 'calendar: Dentist' })
    expect(list!.presentCall?.({})).toEqual({ card: 'generic', title: 'calendar', kind: 'read' })
    expect(remove!.presentCall?.({ id: 'e1' })).toEqual({ card: 'generic', title: 'calendar: remove e1' })
  })
})

describe('the desktop shell probe', () => {
  it('finds the notify face only when a desktop shell offering it is composed', async () => {
    ctx = new Context()
    expect(desktopNotifier(ctx)).toBeUndefined()
    // A service can be provided once per context: one context per shape.
    ctx.provide('desktopActions', { openTerminal: () => {} } as never)
    expect(desktopNotifier(ctx)).toBeUndefined()
    await ctx.fiber.dispose()
    ctx = new Context()
    const shell = { notify: () => {} }
    ctx.provide('desktopActions', shell as never)
    expect(desktopNotifier(ctx)).toBe(shell)
  })
})

describe('the composed plugin', () => {
  it('registers the three tools with the tool registry and notifies through the composed desktop shell', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-calendar-'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '', includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(ToolRuntime)
    const notified: { title: string; body: string }[] = []
    ctx.provide('desktopActions', { notify: (notification: { title: string; body: string }) => { notified.push(notification) } } as never)
    process.env.DSH_HOME = root
    try {
      apply(ctx)
      await vi.waitFor(() => { expect(ctx!.tools.schemas().map(schema => schema.name).sort()).toEqual(['calendar_add', 'calendar_list', 'calendar_remove']) })
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('calendar-1'),
        name: 'calendar_list',
        arguments: {},
      })
      expect(result.isError).toBe(false)
      expect(result.content).toEqual([{ type: 'text', text: 'The calendar is empty.' }])
      const task = await ctx.idealizeCron.saveTask({ name: 'Dentist', schedule: { kind: 'at', at: '2099-03-04T09:30:00.000Z' }, prompt: '', remind: true, cwd: '/Users/jj/Life' })
      const run = await ctx.idealizeCron.fire(task.id)
      expect(notified).toEqual([{ title: 'Dentist', body: fireTimeLine(run.firedAt) }])
    } finally {
      delete process.env.DSH_HOME
    }
  })

  it('logs a notification the shell refused, whatever it threw', async () => {
    for (const thrown of [new Error('the shell is gone'), 'the shell said no']) {
      const { cron } = await boot(true, thrown)
      const warnings: string[] = []
      const host = ctx!
      host.logger.warn = ((message: string) => { warnings.push(message) }) as typeof host.logger.warn
      const task = await cron.saveTask({
        name: 'Dentist',
        schedule: { kind: 'at', at: '2099-03-04T09:30:00Z' },
        cwd: '/Users/jj/Life',
        remind: true,
      })
      const run = await cron.fire(task.id)

      expect(run.status).toBe('ok')
      expect(warnings[0]).toContain('idealize-cron: notification failed')
      await ctx?.fiber.dispose()
      ctx = undefined
    }
  })

  it('fires a task when its own moment arrives', async () => {
    const { cron, notified } = await boot()
    const task = await cron.saveTask({
      name: 'Dentist',
      schedule: { kind: 'at', at: new Date(Date.now() + 400).toISOString() },
      cwd: '/Users/jj/Life',
      remind: true,
    })

    await vi.waitFor(() => { expect(notified.map(one => one.title)).toEqual(['Dentist']) }, { timeout: 5_000 })
    expect((await cron.store.runs(task.id)).map(run => run.status)).toEqual(['ok'])
    // The fire marks the one-off done after recording the run; wait for that
    // write too, so the scratch folder is quiet before it is removed.
    await vi.waitFor(async () => { expect((await cron.store.tasks())[0]?.done).toBeTypeOf('string') })
  })

  it('splits a wait longer than a Node timer can hold, and re-arms at the boundary', async () => {
    const { cron } = await boot()
    // Far enough out that the first delay exceeds the ~24.8-day timer cap.
    const task = await cron.saveTask({
      name: 'Dentist',
      schedule: { kind: 'at', at: '2099-03-04T09:30:00Z' },
      cwd: '/Users/jj/Life',
      remind: true,
    })
    vi.useFakeTimers()
    // Re-arm under the fake clock, then run out the bounded timer: the task is
    // still in the future, so it re-arms rather than firing.
    await cron.toggleTask(task.id)
    await cron.toggleTask(task.id)
    vi.advanceTimersByTime(2_000_000_000)
    vi.useRealTimers()

    expect(await cron.store.runs(task.id)).toEqual([])
  })
})

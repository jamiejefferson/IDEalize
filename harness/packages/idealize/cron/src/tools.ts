/**
 * The calendar tools (`calendar_add`, `calendar_list`, `calendar_remove`)
 * and the standing prompt section that names them. They write the same task
 * document the Schedule pane's routes write, so an entry the agent adds is on
 * the person's calendar and fires whether or not the chat that added it is
 * still open (JJ, 8 Sep 2026: a reminder set from chat neither appeared in the
 * calendar nor fired).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Schedule } from './schedule.ts'
import type { CronTask } from './store.ts'
import type { TaskView } from './index.ts'

/** The slice of the scheduler the tools use; the service implements it. */
export interface CalendarWriter {
  saveTask(input: Partial<CronTask>): Promise<CronTask>
  taskViews(): Promise<TaskView[]>
  deleteTask(id: string): Promise<boolean>
}

/**
 * The standing guidance every agent's prompt carries about the calendar
 * (order 122, the tool-guidance band, after the artefact folders section).
 */
export const CALENDAR_SECTION = {
  name: 'idealize:calendar',
  order: 122,
  text: 'The calendar tools (calendar_add, calendar_list, calendar_remove) are the person\'s calendar, shown in the Schedule pane; '
    + 'a reminder or scheduled task set any other way does not reach it and will not fire once this chat closes.',
} as const

/**
 * One schedule as a sentence for tool results.
 * @param schedule - the task's schedule.
 * @returns `once at <instant>`, `every <n> seconds`, `daily at HH:mm (<zone>)`, or `weekly on days [...] at HH:mm (<zone>)`.
 */
export function describeSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'at':
      return `once at ${schedule.at}`
    case 'every':
      return `every ${String(schedule.seconds)} seconds`
    case 'daily':
      return `daily at ${schedule.at} (${schedule.timeZone})`
    case 'weekly':
      return `weekly on days [${schedule.days.join(', ')}] at ${schedule.at} (${schedule.timeZone})`
  }
}

/** The calendar_add arguments as the schema types them. */
interface AddArgs {
  title: string
  at?: string
  every_seconds?: number
  daily_at?: string
  weekly_at?: string
  weekly_days?: number[]
  time_zone?: string
  prompt?: string
  remind?: boolean
}

/**
 * Turn the flat `when` arguments into one schedule; exactly one of `at`,
 * `every_seconds`, `daily_at`, `weekly_at` may be present.
 * @param args - the tool arguments after schema validation.
 * @param zone - the zone for time-of-day rules when `time_zone` is absent.
 * @returns the schedule.
 * @throws when none or more than one selector is given, or weekly lacks days.
 */
export function scheduleOf(args: AddArgs, zone: string): Schedule {
  const selectors = [args.at, args.every_seconds, args.daily_at, args.weekly_at].filter(value => value !== undefined).length
  const oneOf = 'calendar_add takes exactly one of at, every_seconds, daily_at, weekly_at'
  if (selectors > 1) throw new Error(oneOf)
  const timeZone = args.time_zone ?? zone
  if (args.at !== undefined) return { kind: 'at', at: new Date(args.at).toISOString() }
  if (args.every_seconds !== undefined) return { kind: 'every', seconds: args.every_seconds }
  if (args.daily_at !== undefined) return { kind: 'daily', at: args.daily_at, timeZone }
  if (args.weekly_at !== undefined) {
    if (args.weekly_days === undefined || args.weekly_days.length === 0) throw new Error('weekly_at needs weekly_days (0 = Sunday to 6 = Saturday)')
    return { kind: 'weekly', at: args.weekly_at, timeZone, days: args.weekly_days }
  }
  throw new Error(oneOf)
}

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    schedule: { type: 'string', required: true, description: 'The rule as a sentence.' },
    nextFireAt: { type: 'string', description: 'ISO-8601 instant of the next fire; absent when the entry is done or paused.' },
    done: { type: 'string', description: 'ISO-8601 instant a one-off entry fired.' },
    enabled: { type: 'boolean', required: true },
    remind: { type: 'boolean', required: true, description: 'Whether a desktop notification is raised at each fire.' },
    prompt: { type: 'string', required: true, description: 'What the agent does at each fire; empty for a reminder only.' },
    cwd: { type: 'string', required: true, description: 'The project folder the entry belongs to and runs in.' },
  },
} as const

/** The trailing status of one listed entry: fired, next, paused, or nothing. */
function statusOf(entry: { done?: string; nextFireAt?: string; enabled: boolean }): string {
  if (entry.done !== undefined) return `; fired ${entry.done}`
  if (entry.nextFireAt !== undefined) return `; next ${entry.nextFireAt}`
  return entry.enabled ? '' : '; paused'
}

/** Project one task view into the tool result entry. */
function entryOf(task: TaskView): {
  id: string
  title: string
  schedule: string
  nextFireAt?: string
  done?: string
  enabled: boolean
  remind: boolean
  prompt: string
  cwd: string
} {
  return {
    id: task.id,
    title: task.name,
    schedule: describeSchedule(task.schedule),
    ...task.nextFireAt === undefined ? {} : { nextFireAt: task.nextFireAt },
    ...task.done === undefined ? {} : { done: task.done },
    enabled: task.enabled,
    remind: task.remind === true || task.prompt === '',
    prompt: task.prompt,
    cwd: task.cwd,
  }
}

/**
 * Build the three calendar tools over one scheduler.
 * @param cron - the scheduler the tools write through.
 * @param zone - the zone for time-of-day rules when the call names none (the host's zone).
 * @returns the registry-ready definitions, add / list / remove.
 */
export function createCalendarTools(cron: CalendarWriter, zone: string): ToolDefinition[] {
  const add = defineTool({
    name: 'calendar_add',
    description: 'Add an entry to the person\'s calendar: a reminder, a scheduled task, or anything they call a calendar entry. '
      + 'Give exactly one of: at (ISO-8601 datetime, fires once), every_seconds (at least 60), daily_at (HH:mm), or weekly_at (HH:mm) with weekly_days. '
      + 'Without a prompt the entry is a reminder: at the time, the person gets a desktop notification carrying the title. '
      + 'With a prompt an agent runs it in this project at the time; set remind to also notify the person. '
      + 'The entry appears in the Schedule pane at once and fires whether or not this chat is open. A past "at" is refused.',
    parameters: {
      title: { type: 'string', required: true, description: 'What the person will see: the entry title and the notification title.' },
      at: { type: 'string', description: 'ISO-8601 datetime for a one-off entry, e.g. 2026-09-08T14:00:00+01:00.' },
      every_seconds: { type: 'integer', description: 'Repeat every N seconds, at least 60.' },
      daily_at: { type: 'string', description: 'Repeat every day at HH:mm in time_zone.' },
      weekly_at: { type: 'string', description: 'Repeat at HH:mm on weekly_days in time_zone.' },
      weekly_days: { type: 'array', items: { type: 'integer' }, description: 'Weekdays for weekly_at: 0 = Sunday to 6 = Saturday.' },
      time_zone: { type: 'string', description: `IANA zone for daily_at and weekly_at; defaults to ${zone}.` },
      prompt: { type: 'string', description: 'What the agent should do when the entry fires, written to be followed with nobody present. Omit for a reminder.' },
      remind: { type: 'boolean', description: 'Also raise a desktop notification at each fire. Always on for an entry without a prompt.' },
    },
    output: {
      schema: ENTRY_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Added "${value.title}" to the calendar (${value.id}): ${value.schedule}`
          + (value.nextFireAt === undefined ? '' : `; next ${value.nextFireAt}`)
          + (value.remind ? '; the person will be notified' : '')
          + '.',
      }],
    },
    presentCall: args => ({ card: 'generic', title: `calendar: ${args.title}` }),
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('this chat has no project folder; a calendar entry needs one to run in')
      const prompt = args.prompt?.trim() ?? ''
      const task = await cron.saveTask({
        name: args.title,
        schedule: scheduleOf(args, zone),
        prompt,
        cwd,
        remind: args.remind === true || prompt === '',
      })
      const view = (await cron.taskViews()).find(candidate => candidate.id === task.id)
      return entryOf(view ?? { ...task, running: false })
    },
  })

  const list = defineTool({
    name: 'calendar_list',
    description: 'List the person\'s calendar: every entry in the Schedule pane with its rule, next fire, and whether a one-off has already fired. '
      + 'Use it before answering any question about what is scheduled or set as a reminder.',
    parameters: {
      include_done: { type: 'boolean', description: 'Include one-off entries that have already fired. Default true.' },
    },
    output: {
      schema: { type: 'array', items: ENTRY_SCHEMA },
      render: (_args, value) => [{
        type: 'text',
        text: value.length === 0
          ? 'The calendar is empty.'
          : value.map(entry => `- ${entry.title} (${entry.id}): ${entry.schedule}${statusOf(entry)}`).join('\n'),
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'calendar', kind: 'read' }),
    async execute(args) {
      const views = await cron.taskViews()
      return views.filter(task => args.include_done !== false || task.done === undefined).map(entryOf)
    },
  })

  const remove = defineTool({
    name: 'calendar_remove',
    description: 'Remove one entry from the person\'s calendar by the id calendar_list or calendar_add returned. Its run history stays.',
    parameters: {
      id: { type: 'string', required: true, description: 'The entry id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true }, removed: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.removed ? `Removed calendar entry ${value.id}.` : `No calendar entry has the id ${value.id}.`,
      }],
    },
    presentCall: args => ({ card: 'generic', title: `calendar: remove ${args.id}` }),
    async execute(args) {
      return { id: args.id, removed: await cron.deleteTask(args.id) }
    },
  })

  return [add, list, remove]
}

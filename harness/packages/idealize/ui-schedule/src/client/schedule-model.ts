/**
 * Pure helpers behind the Schedule view: the cron task wire fields, the copy
 * derived from a schedule (repeat badges, sentences), the week the calendar
 * shows, and the task-draft parser the Create-with-chat state reads from an
 * assistant reply.
 * @module @idealize/ui-schedule/client/schedule-model
 */

import type { ScheduleKey } from './locales.ts'

/** Translate seat the schedule copy helpers read (the `idealize-schedule` namespace's bound `t`). */
export type ScheduleTranslate = (key: ScheduleKey, params?: Record<string, unknown>) => string

/** Schedule union, restated from @idealize/cron's wire fields; `at` is a one-off ISO-8601 instant. */
export type Schedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; seconds: number }
  | { kind: 'daily'; at: string; timeZone: string }
  | { kind: 'weekly'; at: string; timeZone: string; days: number[] }

/** A task as `GET /idealize/cron/tasks` reports it. */
export interface TaskView {
  id: string
  name: string
  schedule: Schedule
  prompt: string
  cwd: string
  provider?: string
  model?: string
  /** Raise a desktop notification at each fire. */
  remind?: boolean
  /** The instant a one-off fired; a done task stays listed and never fires again. */
  done?: string
  enabled: boolean
  createdAt: string
  nextFireAt?: string
  running: boolean
}

/** The editable fields of a task: an existing one (id set) or a draft. */
export interface TaskDraft {
  id?: string
  name: string
  schedule: Schedule
  prompt: string
  cwd: string
  provider?: string
  model?: string
  remind?: boolean
  done?: string
  enabled: boolean
}

/** Monday to Friday (0 = Sunday). */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5]

/**
 * The short day label for a `Date.getDay()` index.
 * @param day - day index, 0 = Sunday.
 * @param t - the schedule namespace's bound translate.
 * @returns the localised short label (en "SUN" … "SAT").
 */
export function dayShort(day: number, t: ScheduleTranslate): string {
  return t(`sched.day.${day}` as ScheduleKey)
}

/**
 * The full day name for a `Date.getDay()` index.
 * @param day - day index, 0 = Sunday.
 * @param t - the schedule namespace's bound translate.
 * @returns the localised day name (en "Sunday" … "Saturday").
 */
export function dayName(day: number, t: ScheduleTranslate): string {
  return t(`sched.dayname.${day}` as ScheduleKey)
}

/**
 * The browser's zone, the default for new tasks.
 * @returns the IANA zone name.
 */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort().every((day, index) => day === [...b].sort()[index])
}

/** Minutes as "EVERY 30 MIN" / "EVERY 2 HOURS" (the all-day badge). */
function everyBadge(seconds: number, t: ScheduleTranslate): string {
  const minutes = Math.round(seconds / 60)
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? t('sched.badge.everyHour') : t('sched.badge.everyHours', { n: hours })
  }
  return t('sched.badge.everyMin', { n: minutes })
}

/**
 * The uppercase badge on a task block: WEEKDAYS, TUE + THU, THURSDAY, DAILY, EVERY 30 MIN.
 * @param schedule - the task's schedule.
 * @param t - the schedule namespace's bound translate.
 * @returns the localised badge.
 */
export function repeatBadge(schedule: Schedule, t: ScheduleTranslate): string {
  if (schedule.kind === 'at') return t('sched.badge.once')
  if (schedule.kind === 'every') return everyBadge(schedule.seconds, t)
  if (schedule.kind === 'daily') return t('sched.badge.daily')
  if (sameDays(schedule.days, WEEKDAYS)) return t('sched.badge.weekdays')
  if (schedule.days.length === 7) return t('sched.badge.daily')
  if (schedule.days.length === 1) return dayName(schedule.days[0] ?? 0, t).toUpperCase()
  return [...schedule.days].sort().map(day => dayShort(day, t)).join(' + ')
}

/**
 * The REPEAT row sentence: Every weekday, Every day, Tuesdays and Thursdays, Every 30 minutes.
 * @param schedule - the task's schedule.
 * @param t - the schedule namespace's bound translate.
 * @returns the localised sentence.
 */
export function repeatSentence(schedule: Schedule, t: ScheduleTranslate): string {
  if (schedule.kind === 'at') {
    const when = new Date(schedule.at)
    return t('sched.sent.once', { date: longDate(when, t('sched.dateLocale')), time: localTimeOf(schedule.at) })
  }
  if (schedule.kind === 'every') {
    const minutes = Math.round(schedule.seconds / 60)
    if (minutes % 60 === 0) {
      const hours = minutes / 60
      return hours === 1 ? t('sched.sent.hour') : t('sched.sent.hours', { n: hours })
    }
    return t('sched.sent.minutes', { n: minutes })
  }
  if (schedule.kind === 'daily' || schedule.days.length === 7) return t('sched.repeat.daily')
  if (sameDays(schedule.days, WEEKDAYS)) return t('sched.repeat.weekdays')
  const names = [...schedule.days].sort().map(day => t(`sched.days.${day}` as ScheduleKey))
  if (names.length === 1) return names[0] ?? ''
  return t('sched.sent.two', { a: names.slice(0, -1).join(t('sched.sent.sep')), b: names[names.length - 1] })
}

/**
 * Minutes since midnight of an `HH:mm` time.
 * @param at - the time, e.g. `"09:00"`.
 * @returns the minute count.
 */
export function minutesOf(at: string): number {
  const [hours = 0, minutes = 0] = at.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * The browser-local `HH:mm` of an ISO-8601 instant (a one-off's time of day).
 * @param iso - the instant.
 * @returns the zero-padded local time.
 */
export function localTimeOf(iso: string): string {
  const when = new Date(iso)
  return timeOf(when.getHours() * 60 + when.getMinutes())
}

/**
 * `HH:mm` for minutes since midnight (clamped to the day).
 * @param minutes - minutes since midnight.
 * @returns the zero-padded time.
 */
export function timeOf(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 23 * 60 + 59)
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/**
 * Snap minutes to the nearest step (a drag lands on the quarter hour, a tap on the half hour).
 * @param minutes - minutes since midnight.
 * @param step - the grid step in minutes.
 * @returns the snapped minutes, inside the day.
 */
export function snapMinutes(minutes: number, step: number): number {
  return Math.min(Math.max(Math.round(minutes / step) * step, 0), 24 * 60 - step)
}

/** Height of one hour in the Day lane, the wireframe's 72px row. */
export const HOUR_PX = 72

/** Height of a task block in the Day lane (the wireframe's 54–62px blocks). */
export const BLOCK_PX = 56

/**
 * The hour span the Day lane draws: the wireframe's 08:00–14:00 widened until
 * every timed task of the day fits, with an hour of air below the last.
 * @param minutes - the start minutes of the day's timed tasks.
 * @returns the first and last labelled hours (the last is exclusive of a row).
 */
export function laneHours(minutes: readonly number[]): { start: number; end: number } {
  let start = 8
  let end = 14
  for (const m of minutes) {
    start = Math.min(start, Math.floor(m / 60))
    end = Math.max(end, Math.floor(m / 60) + 2)
  }
  return { start, end: Math.min(end, 24) }
}

/**
 * Lay the day's timed tasks in the lane: blocks whose starts fall inside an
 * earlier block step one column right, as the wireframe's overlapping blocks do.
 * @param tasks - the day's timed tasks, any order.
 * @param startHour - the lane's first hour.
 * @returns each task with its top (px) and column index.
 */
export function laneBlocks<T extends { schedule: Schedule }>(
  tasks: readonly T[],
  startHour: number,
): { task: T; top: number; column: number }[] {
  const timed = tasks.filter(task => task.schedule.kind !== 'every')
  timed.sort((a, b) => minutesOf(startOf(a.schedule)) - minutesOf(startOf(b.schedule)))
  const placed: { task: T; top: number; column: number }[] = []
  for (const task of timed) {
    const top = ((minutesOf(startOf(task.schedule)) - startHour * 60) / 60) * HOUR_PX
    const overlapping = placed.filter(block => top - block.top < BLOCK_PX)
    const column = overlapping.length === 0 ? 0 : Math.max(...overlapping.map(block => block.column)) + 1
    placed.push({ task, top, column })
  }
  return placed
}

/**
 * The `HH:mm` a schedule starts at on its day: a one-off's local time, a
 * time-of-day rule's `at`, and midnight for an interval (which has no time).
 * @param schedule - the task's schedule.
 * @returns the start time.
 */
export function startOf(schedule: Schedule): string {
  if (schedule.kind === 'every') return '00:00'
  if (schedule.kind === 'at') return localTimeOf(schedule.at)
  return schedule.at
}

/**
 * The same schedule at another time of day; interval schedules have no time
 * and return unchanged, a one-off keeps its day and moves its clock time.
 * @param schedule - the task's schedule.
 * @param at - the new `HH:mm`.
 * @returns the rescheduled schedule.
 */
export function withTime(schedule: Schedule, at: string): Schedule {
  if (schedule.kind === 'every') return schedule
  if (schedule.kind === 'at') {
    const when = new Date(schedule.at)
    when.setHours(Math.floor(minutesOf(at) / 60), minutesOf(at) % 60, 0, 0)
    return { kind: 'at', at: when.toISOString() }
  }
  return { ...schedule, at }
}

/**
 * The block's detail line: "09:00 · Codex · Briefs" (time, the model or Default, the run folder).
 * @param task - the task.
 * @param t - the schedule namespace's bound translate.
 * @returns the line.
 */
export function detailLine(task: Pick<TaskView, 'schedule' | 'provider' | 'model' | 'cwd'>, t: ScheduleTranslate): string {
  const parts = [modelLabel(task, t), folderName(task.cwd)].filter(part => part !== '')
  if (task.schedule.kind !== 'every') parts.unshift(startOf(task.schedule))
  return parts.join(' · ')
}

/**
 * Whether a schedule has a fire on the given local calendar day: a one-off on
 * its own day only, a weekly rule on its listed weekdays, the rest every day.
 * @param schedule - the task's schedule.
 * @param date - the local calendar day.
 * @returns true when the schedule fires that day.
 */
export function occursOn(schedule: Schedule, date: Date): boolean {
  if (schedule.kind === 'at') return sameDay(new Date(schedule.at), date)
  if (schedule.kind !== 'weekly') return true
  return schedule.days.includes(date.getDay())
}

/**
 * The schedule a calendar tap drafts: a weekly task on the tapped day at the
 * tapped time, so the editor opens showing exactly the slot that was clicked.
 * @param day - the calendar day the tap landed on.
 * @param at - the tapped "HH:mm" (a week column's default).
 * @param timeZone - the zone stamped on the draft.
 * @returns the weekly schedule.
 */
export function tappedSchedule(day: Date, at: string, timeZone: string): Schedule {
  return { kind: 'weekly', at, timeZone, days: [day.getDay()] }
}

/**
 * The Monday-first week containing `date`.
 * @param date - any local date in the week.
 * @returns seven local dates at midnight, Monday first.
 */
export function weekOf(date: Date): Date[] {
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + index)
    return day
  })
}

/**
 * The calendar grid for a date's month: whole weeks, Monday first, so the
 * month's first and last weeks are filled out with the adjacent months' days.
 * Six rows always, so the grid does not change height as the user steps
 * through months.
 * @param date - any local date in the month.
 * @returns 42 local dates at midnight, in reading order.
 */
export function monthOf(date: Date): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

/**
 * Whether a date falls in the same local month as another.
 * @param date - the date to test.
 * @param month - any date in the month.
 * @returns true when year and month match.
 */
export function inMonth(date: Date, month: Date): boolean {
  return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth()
}

/**
 * Whether two dates fall on the same local calendar day.
 * @param a - one date.
 * @param b - the other date.
 * @returns true when year, month, and day match.
 */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * "20 August 2026" in the pane's date navigator.
 * @param date - the shown day.
 * @param locale - BCP 47 tag (the dictionary's `sched.dateLocale`).
 * @returns the localised long date.
 */
export function longDate(date: Date, locale = 'en-GB'): string {
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * "September 2026" in the pane's date navigator, when the grid is a month.
 * @param date - any day in the shown month.
 * @param locale - BCP 47 tag (the dictionary's `sched.dateLocale`).
 * @returns the localised month and year.
 */
export function monthLabel(date: Date, locale = 'en-GB'): string {
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

/**
 * The footer's "Next run: tomorrow at 09:00" line, from the host-computed
 * next fire for saved tasks; drafts get an approximation in the browser's
 * own clock (time-of-day rules in the browser zone).
 * @param draft - the edited task.
 * @param nextFireAt - the host-computed next fire, when the saved schedule is untouched.
 * @param now - the current time.
 * @param t - the schedule namespace's bound translate.
 * @returns the localised next-run line.
 */
export function nextRunLine(draft: TaskDraft, nextFireAt: string | undefined, now: Date, t: ScheduleTranslate): string {
  if (draft.done !== undefined) return t('sched.nextrun.done', { time: localTimeOf(draft.done), date: longDate(new Date(draft.done), t('sched.dateLocale')) })
  if (!draft.enabled) return t('sched.nextrun.paused')
  const next = nextFireAt !== undefined ? new Date(nextFireAt) : approximateNextFire(draft.schedule, now)
  const time = next.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(next, now)) return t('sched.nextrun.today', { time })
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay(next, tomorrow)) return t('sched.nextrun.tomorrow', { time })
  return t('sched.nextrun.day', { day: dayName(next.getDay(), t), time })
}

function approximateNextFire(schedule: Schedule, now: Date): Date {
  if (schedule.kind === 'at') return new Date(schedule.at)
  if (schedule.kind === 'every') return new Date(now.getTime() + schedule.seconds * 1_000)
  const target = minutesOf(schedule.at)
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now)
    candidate.setDate(now.getDate() + offset)
    candidate.setHours(Math.floor(target / 60), target % 60, 0, 0)
    if (candidate.getTime() > now.getTime() && occursOn(schedule, candidate)) return candidate
  }
  return new Date(now.getTime() + 7 * 24 * 3_600_000)
}

/**
 * The last path segment, for "Save to" summaries.
 * @param path - a POSIX or Windows path, trailing separators allowed.
 * @returns the final segment, or the input when it has none.
 */
export function folderName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path
}

/**
 * "Default" or the task's pinned model label.
 * @param draft - the provider/model half of a draft.
 * @param t - the schedule namespace's bound translate.
 * @returns the localised model label.
 */
export function modelLabel(draft: Pick<TaskDraft, 'provider' | 'model'>, t: ScheduleTranslate): string {
  if (draft.model === undefined) return t('sched.model.default')
  return draft.provider === undefined ? draft.model : `${draft.provider} · ${draft.model}`
}

/** Separates the user's words from the seed in one Create-with-chat message. */
const SEED_MARKER = '\n\n---\nTask format: '

/**
 * One Create-with-chat message: the user's words first (so the session title
 * derives from them), then the seed that asks for prose plus one fenced JSON
 * task block the pane parses.
 * @param words - what the user typed.
 * @param timeZone - the zone times are read in.
 * @param cwd - the folder the task runs in.
 * @param slot - the tapped calendar slot, when the state opened from a tap; the model defaults the schedule to it.
 * @returns the message text to submit.
 */
export function seededMessage(words: string, timeZone: string, cwd: string, slot?: Schedule): string {
  return words + SEED_MARKER + [
    'you are helping me create a scheduled task in IDEalize, an agent run that repeats on a schedule.',
    'Reply with one or two plain sentences, then exactly one fenced ```json block with these fields:',
    '{"name": string, "schedule": {"kind": "daily", "at": "HH:mm"} | {"kind": "weekly", "at": "HH:mm", "days": [0-6, 0 = Sunday]} | {"kind": "every", "seconds": number >= 60} | {"kind": "at", "at": ISO-8601 datetime, once}, "prompt": string}.',
    '"prompt" is the instruction the agent runs each time, written to be followed without me present.',
    `Times use ${timeZone}. The task runs in ${cwd}. If I later ask for changes, reply with the whole updated block.`,
    ...slot === undefined ? [] : [`I tapped the calendar slot ${JSON.stringify(slot)}; default the schedule to it unless my words say otherwise.`],
  ].join('\n')
}

/**
 * Split one seeded user message back into the words the user typed.
 * @param text - a message `seededMessage` produced, or any other text.
 * @returns the text before the seed marker; the whole text when no marker is present.
 */
export function stripSeed(text: string): string {
  const at = text.indexOf(SEED_MARKER)
  return at === -1 ? text : text.slice(0, at)
}

/** A draft parsed from an assistant reply, or undefined when no valid block is present. */
export interface ParsedDraft {
  name: string
  schedule: Schedule
  prompt: string
}

/**
 * Read the last fenced JSON block of an assistant reply as a task draft.
 * @param text - assistant reply text.
 * @param timeZone - zone stamped on time-of-day schedules.
 * @returns the draft, or undefined when the block is missing or invalid.
 */
export function parseDraft(text: string, timeZone: string): ParsedDraft | undefined {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  const last = blocks[blocks.length - 1]?.[1]
  if (last === undefined) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(last)
  } catch {
    // A truncated or prose-polluted block: the reply simply carries no draft.
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as { name?: unknown; prompt?: unknown; schedule?: Record<string, unknown> }
  if (typeof candidate.name !== 'string' || typeof candidate.prompt !== 'string') return undefined
  const schedule = candidate.schedule
  if (schedule === undefined) return undefined
  const at = typeof schedule.at === 'string' && /^\d{2}:\d{2}$/.test(schedule.at) ? schedule.at : undefined
  let parsed: Schedule | undefined
  if (schedule.kind === 'at' && typeof schedule.at === 'string' && !Number.isNaN(Date.parse(schedule.at))) {
    parsed = { kind: 'at', at: new Date(schedule.at).toISOString() }
  } else if (schedule.kind === 'every' && typeof schedule.seconds === 'number' && schedule.seconds >= 60) {
    parsed = { kind: 'every', seconds: Math.round(schedule.seconds) }
  } else if (schedule.kind === 'daily' && at !== undefined) {
    parsed = { kind: 'daily', at, timeZone }
  } else if (schedule.kind === 'weekly' && at !== undefined && Array.isArray(schedule.days)) {
    const days = schedule.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
    if (days.length > 0) parsed = { kind: 'weekly', at, timeZone, days }
  }
  if (parsed === undefined) return undefined
  return { name: candidate.name, schedule: parsed, prompt: candidate.prompt }
}

/**
 * The reply with its fenced JSON blocks removed, for the transcript row.
 * @param text - the assistant reply text.
 * @returns the trimmed prose.
 */
export function replyProse(text: string): string {
  return text.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim()
}

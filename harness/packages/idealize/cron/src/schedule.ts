/**
 * Schedule arithmetic for IDEalize cron tasks. Four shapes: a one-off instant
 * (`at`, an ISO-8601 datetime; the task fires once and records itself done),
 * a fixed-rate interval (`every`, >= 60 seconds), a daily time-of-day
 * (`daily`, `HH:mm` in an explicit IANA zone), and a weekly time-of-day on
 * chosen weekdays (`weekly`, same `HH:mm` + zone, `days` 0 = Sunday … 6 =
 * Saturday). Cron-expression parsing is queued work. Repeating times are
 * computed against the wall clock at each arm, so a sleeping laptop
 * reschedules on wake instead of firing a burst.
 */

export type Schedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; seconds: number }
  | { kind: 'daily'; at: string; timeZone: string }
  | { kind: 'weekly'; at: string; timeZone: string; days: number[] }

/** Monday to Friday, the Schedule pane's "Every weekday" repeat. */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5]

/**
 * Validate one schedule.
 * @param schedule - the candidate schedule.
 * @returns a human-readable reason it is invalid, or undefined when it is fine.
 */
export function invalidReason(schedule: Schedule): string | undefined {
  if (schedule.kind === 'at') {
    if (typeof schedule.at !== 'string' || Number.isNaN(Date.parse(schedule.at))) {
      return 'one-off schedules need an ISO-8601 datetime in "at"'
    }
    return undefined
  }
  if (schedule.kind === 'every') {
    if (!Number.isSafeInteger(schedule.seconds) || schedule.seconds < 60) {
      return 'interval schedules need a whole number of seconds, at least 60'
    }
    return undefined
  }
  if (schedule.kind === 'weekly') {
    if (!Array.isArray(schedule.days) || schedule.days.length === 0) return 'weekly schedules need at least one day'
    if (schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return 'weekly days are 0 (Sunday) to 6 (Saturday)'
  }
  if (!/^\d{2}:\d{2}$/.test(schedule.at)) return `${schedule.kind} schedules need an HH:mm time`
  const [hours = 0, minutes = 0] = schedule.at.split(':').map(Number)
  if (hours > 23 || minutes > 59) return `${schedule.kind} time out of range`
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: schedule.timeZone })
  } catch {
    return `unknown time zone "${schedule.timeZone}"`
  }
  return undefined
}

/** The wall-clock parts of one instant in one zone. */
function zoneParts(instant: Date, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; wd: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  /* v8 ignore next -- the formatter is asked for every part it is read for, so each one is present; the guard only types the lookup. */
  const get = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0')
  /* v8 ignore next -- the formatter is asked for the weekday, so it is present; the guard only types the lookup. */
  const weekday = parts.find(part => part.type === 'weekday')?.value ?? 'Sun'
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), wd: WEEKDAY_NAMES.indexOf(weekday) }
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The zone's weekday at one instant.
 * @param instant - the instant to read.
 * @param timeZone - an IANA zone name.
 * @returns the weekday, 0 (Sunday) to 6 (Saturday).
 */
export function zoneWeekday(instant: Date, timeZone: string): number {
  return zoneParts(instant, timeZone).wd
}

/**
 * Next fire time strictly after `from`; a one-off returns its instant whatever
 * `from` is, so an overdue one-off arms with no delay.
 *
 * The daily form walks forward in one-minute steps until the zone's wall clock
 * reads the target HH:mm — slower than calendar arithmetic but immune to the
 * offset-guessing bugs that plague hand-rolled zone maths. A time skipped by
 * a DST gap resolves to the first instant the wall clock shows it again (the
 * next day), which is the conservative reading of "fire at 02:30". The
 * weekly form repeats the daily walk until the zone's weekday is one of
 * `days` (at most eight walks).
 * @param schedule - a schedule `invalidReason` accepts.
 * @param from - the instant the search starts after.
 * @returns the next fire instant, strictly after `from`.
 */
export function nextFire(schedule: Schedule, from: Date): Date {
  if (schedule.kind === 'at') return new Date(schedule.at)
  if (schedule.kind === 'every') {
    return new Date(from.getTime() + schedule.seconds * 1_000)
  }
  if (schedule.kind === 'weekly') {
    let cursor = from
    for (let walk = 0; walk < 8; walk++) {
      const candidate = nextFire({ kind: 'daily', at: schedule.at, timeZone: schedule.timeZone }, cursor)
      if (schedule.days.includes(zoneParts(candidate, schedule.timeZone).wd)) return candidate
      cursor = candidate
    }
    // Unreachable for a non-empty day set; a week out rather than never.
    /* v8 ignore next -- invalidReason refuses an empty day set, so the eight-day walk always lands. */
    return new Date(from.getTime() + 7 * 24 * 3_600_000)
  }
  const [hours, minutes] = schedule.at.split(':').map(Number)
  // Align to the next minute boundary, then step.
  const start = new Date(Math.ceil((from.getTime() + 1) / 60_000) * 60_000)
  const stepMs = 60_000
  // 36 hours of minutes bounds the walk across any gap or overlap.
  for (let i = 0; i < 36 * 60; i++) {
    const candidate = new Date(start.getTime() + i * stepMs)
    const parts = zoneParts(candidate, schedule.timeZone)
    if (parts.h === hours && parts.mi === minutes) return candidate
  }
  // Unreachable for a valid zone; fall back a day out rather than never.
  /* v8 ignore next -- invalidReason refuses an unknown zone, so a 36-hour walk always meets the wall-clock minute. */
  return new Date(from.getTime() + 24 * 3_600_000)
}

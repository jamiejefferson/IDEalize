// Schedule arithmetic: the weekly kind the Schedule pane's REPEAT row writes.
import { describe, expect, it } from 'vitest'
import { invalidReason, nextFire, WEEKDAYS, zoneWeekday } from '../src/schedule.ts'

const LONDON = 'Europe/London'

describe('weekly schedules', () => {
  it('rejects an empty or out-of-range day set', () => {
    expect(invalidReason({ kind: 'weekly', at: '09:00', timeZone: LONDON, days: [] })).toMatch(/at least one day/)
    expect(invalidReason({ kind: 'weekly', at: '09:00', timeZone: LONDON, days: [7] })).toMatch(/0 \(Sunday\) to 6/)
    expect(invalidReason({ kind: 'weekly', at: '09:00', timeZone: LONDON, days: [...WEEKDAYS] })).toBeUndefined()
  })

  it('skips to the next listed weekday at the wall-clock time', () => {
    // Thursday 20 August 2026, 10:00 London (BST, UTC+1).
    const from = new Date('2026-08-20T09:00:00Z')
    const next = nextFire({ kind: 'weekly', at: '09:00', timeZone: LONDON, days: [...WEEKDAYS] }, from)
    expect(next.toISOString()).toBe('2026-08-21T08:00:00.000Z')
    expect(zoneWeekday(next, LONDON)).toBe(5)
    const tuesday = nextFire({ kind: 'weekly', at: '11:05', timeZone: LONDON, days: [2] }, from)
    expect(tuesday.toISOString()).toBe('2026-08-25T10:05:00.000Z')
  })

  it('fires today when the time is still ahead on a listed day', () => {
    const from = new Date('2026-08-20T07:00:00Z')
    const next = nextFire({ kind: 'weekly', at: '09:00', timeZone: LONDON, days: [4] }, from)
    expect(next.toISOString()).toBe('2026-08-20T08:00:00.000Z')
  })
})

describe('one-off schedules', () => {
  it('accepts an ISO-8601 instant and rejects anything else', () => {
    expect(invalidReason({ kind: 'at', at: '2026-09-08T14:00:00+01:00' })).toBeUndefined()
    expect(invalidReason({ kind: 'at', at: 'next Tuesday' })).toMatch(/ISO-8601/)
    // The routes parse JSON, so a number can arrive where the string belongs.
    expect(invalidReason({ kind: 'at', at: 1_700_000_000 as unknown as string })).toMatch(/ISO-8601/)
  })

  it('fires at its instant whatever the arm time is, so an overdue one-off arms with no delay', () => {
    const at = '2026-09-08T13:00:00.000Z'
    expect(nextFire({ kind: 'at', at }, new Date('2026-09-01T00:00:00Z')).toISOString()).toBe(at)
    expect(nextFire({ kind: 'at', at }, new Date('2026-09-09T00:00:00Z')).toISOString()).toBe(at)
  })

  it('refuses a time that is not HH:mm, one out of range, and a zone nobody has', () => {
    expect(invalidReason({ kind: 'daily', at: '9am', timeZone: LONDON })).toBe('daily schedules need an HH:mm time')
    expect(invalidReason({ kind: 'daily', at: '25:00', timeZone: LONDON })).toBe('daily time out of range')
    expect(invalidReason({ kind: 'daily', at: '09:70', timeZone: LONDON })).toBe('daily time out of range')
    expect(invalidReason({ kind: 'daily', at: '09:00', timeZone: 'Mars/Olympus' })).toBe('unknown time zone "Mars/Olympus"')
  })
})

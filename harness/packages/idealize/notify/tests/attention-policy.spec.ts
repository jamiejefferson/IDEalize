/**
 * The MVP notification table, row by row: which recorded Studio events
 * interrupt the person, which stay in the timeline, and what the alert says.
 */

import { describe, expect, it } from 'vitest'
import { attentionNotice, notificationPolicyFor, USER_PARTICIPANT } from '../src/attention.ts'
import type { PolicyEvent, PolicyRow } from '../src/attention.ts'

const event = (over: Partial<PolicyEvent>): PolicyEvent => ({ kind: 'task-update', author: 'agent-alpha', ...over })

const userTask = { requester: USER_PARTICIPANT, goal: 'Ship the walk' }
const agentTask = { requester: 'agent-beta', goal: 'Ship the walk' }

describe('the MVP notification policy', () => {
  it('leaves routine progress to the timeline', () => {
    for (const subtype of ['queued', 'working', 'resumed', 'progress']) {
      expect(notificationPolicyFor(event({ subtype }))).toEqual({ row: 'progress', alert: false })
    }
    expect(notificationPolicyFor(event({ kind: 'assignment', subtype: 'new-task', target: 'agent-beta' })))
      .toEqual({ row: 'progress', alert: false })
  })

  it('alerts on a direct mention of the person, and stays quiet for a mention of an agent', () => {
    expect(notificationPolicyFor(event({ kind: 'message', target: USER_PARTICIPANT })))
      .toEqual({ row: 'mention', alert: true })
    expect(notificationPolicyFor(event({ kind: 'message', target: 'agent-beta' })))
      .toEqual({ row: 'other', alert: false })
  })

  it('alerts when a request names the person, and not when it names another agent', () => {
    for (const subtype of ['needs-input', 'needs-action'] as const) {
      expect(notificationPolicyFor(event({ kind: 'request', subtype, target: USER_PARTICIPANT })))
        .toEqual({ row: subtype, alert: true })
      expect(notificationPolicyFor(event({ kind: 'request', subtype, target: 'agent-beta' })))
        .toEqual({ row: subtype, alert: false })
    }
    // A request the fold does not read is a plain timeline item.
    expect(notificationPolicyFor(event({ kind: 'request', subtype: 'fyi', target: USER_PARTICIPANT })))
      .toEqual({ row: 'other', alert: false })
  })

  it('follows the blocker to its owner', () => {
    expect(notificationPolicyFor(event({ subtype: 'blocked', target: USER_PARTICIPANT })))
      .toEqual({ row: 'blocked-user', alert: true })
    expect(notificationPolicyFor(event({ subtype: 'blocked', target: 'agent-beta' })))
      .toEqual({ row: 'blocked-other', alert: false })
    // An unassigned blocker owes the person nothing yet.
    expect(notificationPolicyFor(event({ subtype: 'blocked' })))
      .toEqual({ row: 'blocked-other', alert: false })
  })

  it('keeps a completion quiet and alerts on a failure only when the person asked for the work', () => {
    expect(notificationPolicyFor(event({ subtype: 'done' }), userTask)).toEqual({ row: 'done', alert: false })
    expect(notificationPolicyFor(event({ subtype: 'failed' }), userTask)).toEqual({ row: 'failed', alert: true })
    expect(notificationPolicyFor(event({ subtype: 'failed' }), agentTask)).toEqual({ row: 'failed', alert: false })
    // A failure whose task the fold does not hold names no requester.
    expect(notificationPolicyFor(event({ subtype: 'failed' }))).toEqual({ row: 'failed', alert: false })
  })

  it('leaves every other kind and subtype to the timeline', () => {
    expect(notificationPolicyFor(event({ subtype: 'renamed' }))).toEqual({ row: 'other', alert: false })
    expect(notificationPolicyFor(event({ kind: 'synthesis' }))).toEqual({ row: 'other', alert: false })
    expect(notificationPolicyFor(event({ kind: 'handoff', subtype: 'offered', target: USER_PARTICIPANT })))
      .toEqual({ row: 'other', alert: false })
  })
})

describe('the alert’s words', () => {
  it('names the author and carries the event’s own text', () => {
    expect(attentionNotice('mention', event({ kind: 'message', body: 'look at this' })))
      .toEqual({ title: 'agent-alpha mentioned you', body: 'look at this' })
    expect(attentionNotice('needs-input', event({ body: 'which font?' })).title).toBe('agent-alpha needs your input')
    expect(attentionNotice('needs-action', event({ body: 'approve the key' })).title).toBe('agent-alpha needs you to act')
    expect(attentionNotice('blocked-user', event({ body: 'waiting on the key' })).title).toBe('agent-alpha is blocked on you')
    expect(attentionNotice('failed', event({})).title).toBe('agent-alpha could not finish')
  })

  it('falls back to the task’s goal when the event carries no text', () => {
    expect(attentionNotice('failed', event({ body: '' }), userTask).body).toBe('Ship the walk')
    expect(attentionNotice('failed', event({})).body).toBe('')
  })

  it('cuts a long body to one alert’s worth', () => {
    const long = 'x'.repeat(400)
    const notice = attentionNotice('mention', event({ kind: 'message', body: long }))
    expect(notice.body).toHaveLength(160)
    expect(notice.body.endsWith('…')).toBe(true)
  })

  it('answers for the rows that raise no alert', () => {
    for (const row of ['progress', 'blocked-other', 'done', 'other'] satisfies PolicyRow[]) {
      expect(attentionNotice(row, event({})).title).toBe('agent-alpha')
    }
  })
})

/**
 * The fold's state machine: assignment, execution transitions, requests and
 * their resolution, terminal attention and its acknowledgement, queue
 * promotion through the displayed task, and the documented unknown-subtype
 * default.
 */

import { describe, expect, it } from 'vitest'
import { StudioEventId } from '../src/events.ts'
import type { StudioEvent, StudioEventInput } from '../src/events.ts'
import { foldStudioState } from '../src/fold.ts'

let seq = 0

function event(input: Omit<StudioEventInput, 'project'>): StudioEvent {
  seq += 1
  return {
    ...input,
    project: '/work/demo',
    id: StudioEventId(`se-${seq}`),
    seq,
    at: new Date(2026, 8, 1, 12, 0, seq).toISOString(),
    visibility: 'studio',
  }
}

function assign(taskId: string, owner: string, goal: string): StudioEvent {
  return event({ kind: 'assignment', subtype: 'new-task', taskId, target: owner, author: 'user', body: goal })
}

function update(taskId: string, subtype: string, extra: Partial<StudioEventInput> = {}): StudioEvent {
  return event({ kind: 'task-update', subtype, taskId, author: 'agent-a', ...extra })
}

describe('foldStudioState', () => {
  it('creates a queued task from an assignment and works it', () => {
    const state = foldStudioState([assign('t1', 'agent-a', 'Write the brief'), update('t1', 'working')])
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({ id: 't1', owner: 'agent-a', goal: 'Write the brief', state: 'working', attention: 'none' })
    expect(state.agents['agent-a']).toMatchObject({ active: 't1', displayed: 't1', queued: [] })
  })

  it('moves a task to waiting on a request and back to working on its resolution', () => {
    const ask = event({ kind: 'request', subtype: 'needs-input', taskId: 't1', target: 'user', author: 'agent-a', body: 'Which palette?' })
    const events = [assign('t1', 'agent-a', 'g'), update('t1', 'working'), ask]
    const waiting = foldStudioState(events)
    expect(waiting.tasks[0]).toMatchObject({ state: 'waiting', attention: 'needs-input', attentionOwner: 'user', requestEvent: ask.id })
    const resolved = foldStudioState([...events, event({ kind: 'system', subtype: 'resolve-request', author: 'user', source: { event: ask.id } })])
    expect(resolved.tasks[0]).toMatchObject({ state: 'working', attention: 'none' })
    expect(resolved.tasks[0]?.requestEvent).toBeUndefined()
  })

  it('records an unassigned blocker with its request event', () => {
    const blocked = update('t1', 'blocked', { body: 'No key stored' })
    const state = foldStudioState([assign('t1', 'agent-a', 'g'), blocked])
    expect(state.tasks[0]).toMatchObject({ state: 'waiting', attention: 'blocked', requestEvent: blocked.id })
    expect(state.tasks[0]?.attentionOwner).toBeUndefined()
  })

  it('keeps completion attention through later work until acknowledged', () => {
    const events = [assign('t1', 'agent-a', 'g'), update('t1', 'done'), assign('t2', 'agent-a', 'next')]
    const before = foldStudioState(events)
    expect(before.tasks[0]).toMatchObject({ state: 'done', attention: 'completion' })
    expect(before.agents['agent-a']).toMatchObject({ displayed: 't2', unresolved: ['t1'] })
    const after = foldStudioState([...events, event({ kind: 'system', subtype: 'acknowledge-delivery', taskId: 't1', author: 'user' })])
    expect(after.tasks[0]).toMatchObject({ state: 'done', attention: 'none', acknowledgedBy: 'user' })
    expect(after.agents['agent-a']?.unresolved).toEqual([])
  })

  it('clears failure attention on acknowledgement and leaves the task failed', () => {
    const events = [assign('t1', 'agent-a', 'g'), update('t1', 'failed')]
    expect(foldStudioState(events).tasks[0]).toMatchObject({ state: 'failed', attention: 'failure' })
    const after = foldStudioState([...events, event({ kind: 'system', subtype: 'acknowledge-failure', taskId: 't1', author: 'user' })])
    expect(after.tasks[0]).toMatchObject({ state: 'failed', attention: 'none' })
  })

  it('refuses the wrong acknowledgement kind', () => {
    const events = [assign('t1', 'agent-a', 'g'), update('t1', 'failed'),
      event({ kind: 'system', subtype: 'acknowledge-delivery', taskId: 't1', author: 'user' })]
    expect(foldStudioState(events).tasks[0]).toMatchObject({ attention: 'failure' })
  })

  it('promotes the earliest queued task to displayed when the active one closes', () => {
    const events = [
      assign('t1', 'agent-a', 'first'), update('t1', 'working'),
      assign('t2', 'agent-a', 'second'), assign('t3', 'agent-a', 'third'),
    ]
    expect(foldStudioState(events).agents['agent-a']).toMatchObject({ active: 't1', displayed: 't1', queued: ['t2', 't3'] })
    const closed = foldStudioState([...events, update('t1', 'cancelled')])
    expect(closed.agents['agent-a']?.active).toBeUndefined()
    expect(closed.agents['agent-a']).toMatchObject({ displayed: 't2', queued: ['t2', 't3'] })
  })

  it('names an agent finished once its latest task is done and nothing is active or queued', () => {
    const done = [assign('t1', 'agent-a', 'first'), update('t1', 'working'), update('t1', 'done')]
    expect(foldStudioState(done).agents['agent-a']).toMatchObject({ finished: 't1', queued: [] })
    expect(foldStudioState(done).agents['agent-a']?.displayed).toBeUndefined()
    // Acknowledging the completion changes nothing about whether the chat can be closed.
    const acknowledged = [...done, event({ kind: 'system', subtype: 'acknowledge-delivery', taskId: 't1', author: 'user' })]
    expect(foldStudioState(acknowledged).agents['agent-a']?.finished).toBe('t1')
    // New work ends it, queued or working; finishing that work names the newer task.
    const again = [...done, assign('t2', 'agent-a', 'second')]
    expect(foldStudioState(again).agents['agent-a']).toMatchObject({ displayed: 't2' })
    expect(foldStudioState(again).agents['agent-a']?.finished).toBeUndefined()
    expect(foldStudioState([...again, update('t2', 'working')]).agents['agent-a']?.finished).toBeUndefined()
    expect(foldStudioState([...again, update('t2', 'done')]).agents['agent-a']?.finished).toBe('t2')
  })

  it('reads past a cancelled task to the work before it, and never calls a failed agent finished', () => {
    const cancelled = [assign('t1', 'agent-a', 'first'), update('t1', 'done'), assign('t2', 'agent-a', 'second'), update('t2', 'cancelled')]
    expect(foldStudioState(cancelled).agents['agent-a']?.finished).toBe('t1')
    const failed = [assign('t1', 'agent-a', 'first'), update('t1', 'done'), assign('t2', 'agent-a', 'second'), update('t2', 'failed')]
    expect(foldStudioState(failed).agents['agent-a']?.finished).toBeUndefined()
    expect(foldStudioState([assign('t1', 'agent-a', 'only'), update('t1', 'cancelled')]).agents['agent-a']?.finished).toBeUndefined()
  })

  it('reassigns ownership without recreating the task', () => {
    const events = [assign('t1', 'agent-a', 'g'), event({ kind: 'assignment', subtype: 'reassign', taskId: 't1', target: 'agent-b', author: 'user' })]
    const state = foldStudioState(events)
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]?.owner).toBe('agent-b')
    expect(state.agents['agent-b']?.queued).toEqual(['t1'])
  })

  it('treats an unknown subtype and the unread kinds as timeline items', () => {
    const events = [
      assign('t1', 'agent-a', 'g'), update('t1', 'working'),
      update('t1', 'celebrated'),
      event({ kind: 'synthesis', subtype: 'current', author: 'lead', body: 'All on track' }),
      event({ kind: 'message', author: 'user', target: 'agent-a', body: 'hello' }),
    ]
    const state = foldStudioState(events)
    expect(state.tasks[0]).toMatchObject({ state: 'working', attention: 'none' })
    expect(state.tasks).toHaveLength(1)
  })

  it('walks a handoff: offer raises attention, acceptance transfers ownership', () => {
    const offer = event({ kind: 'handoff', subtype: 'offered', taskId: 't1', target: 'agent-b', author: 'agent-a', body: 'Your turf' })
    const base = [assign('t1', 'agent-a', 'g'), update('t1', 'working'), offer]
    const offered = foldStudioState(base)
    expect(offered.tasks[0]).toMatchObject({ owner: 'agent-a', attention: 'handoff-ready', attentionOwner: 'agent-b',
      handoff: { event: offer.id, from: 'agent-a', to: 'agent-b', state: 'offered' } })
    expect(offered.tasks[0]?.state).toBe('working')

    const clarified = foldStudioState([...base, event({ kind: 'handoff', subtype: 'needs-clarification', taskId: 't1', author: 'agent-b' })])
    expect(clarified.tasks[0]).toMatchObject({ attentionOwner: 'agent-a', handoff: { state: 'needs-clarification' } })

    const accepted = foldStudioState([...base, event({ kind: 'handoff', subtype: 'accepted', taskId: 't1', author: 'agent-b', source: { event: offer.id } })])
    expect(accepted.tasks[0]).toMatchObject({ owner: 'agent-b', attention: 'none' })
    expect(accepted.tasks[0]?.handoff).toBeUndefined()
    expect(accepted.agents['agent-b']?.active).toBe('t1')
  })

  it('only the named recipient moves an offer, and rejection keeps the sender', () => {
    const offer = event({ kind: 'handoff', subtype: 'offered', taskId: 't1', target: 'agent-b', author: 'agent-a' })
    const base = [assign('t1', 'agent-a', 'g'), offer]
    const hijack = foldStudioState([...base, event({ kind: 'handoff', subtype: 'accepted', taskId: 't1', author: 'agent-c' })])
    expect(hijack.tasks[0]).toMatchObject({ owner: 'agent-a', attention: 'handoff-ready' })
    const rejected = foldStudioState([...base, event({ kind: 'handoff', subtype: 'rejected', taskId: 't1', author: 'agent-b' })])
    expect(rejected.tasks[0]).toMatchObject({ owner: 'agent-a', attention: 'none' })
    expect(rejected.tasks[0]?.handoff).toBeUndefined()
  })

  it('keeps an open offer through a progress update and drops it on terminal states', () => {
    const offer = event({ kind: 'handoff', subtype: 'offered', taskId: 't1', target: 'agent-b', author: 'agent-a' })
    const base = [assign('t1', 'agent-a', 'g'), offer]
    const stillOffered = foldStudioState([...base, update('t1', 'progress')])
    expect(stillOffered.tasks[0]).toMatchObject({ attention: 'handoff-ready', handoff: { to: 'agent-b' } })
    const closed = foldStudioState([...base, update('t1', 'done')])
    expect(closed.tasks[0]?.handoff).toBeUndefined()
    expect(closed.tasks[0]).toMatchObject({ attention: 'completion' })
  })

  it('publishes a synthesis and marks it stale on the next state change, never on chatter', () => {
    const base = [assign('t1', 'agent-a', 'g'),
      event({ kind: 'synthesis', subtype: 'current', author: 'lead', body: 'All on track' })]
    const fresh = foldStudioState(base)
    expect(fresh.synthesis).toMatchObject({ author: 'lead', body: 'All on track', stale: false })
    const chatter = foldStudioState([...base, event({ kind: 'message', author: 'user', body: 'hi' }),
      event({ kind: 'system', subtype: 'acknowledge-delivery', taskId: 't1', author: 'user' })])
    expect(chatter.synthesis?.stale).toBe(false)
    const moved = foldStudioState([...base, update('t1', 'working')])
    expect(moved.synthesis?.stale).toBe(true)
    const republished = foldStudioState([...base, update('t1', 'working'),
      event({ kind: 'synthesis', subtype: 'current', author: 'lead', body: 'Revised' })])
    expect(republished.synthesis).toMatchObject({ body: 'Revised', stale: false })
  })

  it('ignores a paused or terminal task on late transitions', () => {
    const events = [assign('t1', 'agent-a', 'g'), update('t1', 'done'), update('t1', 'working')]
    expect(foldStudioState(events).tasks[0]?.state).toBe('done')
    const paused = [assign('t2', 'agent-a', 'g'), update('t2', 'working'), update('t2', 'paused')]
    expect(foldStudioState(paused).tasks[0]?.state).toBe('paused')
    expect(foldStudioState(paused).agents['agent-a']?.active).toBe('t2')
  })
})

import { describe, expect, it } from 'vitest'
import { ATTENTION_KIND, createChimeGate } from '../src/chime-gate.ts'

const finished = (seq: number) => ({ seq, kind: ATTENTION_KIND, sessionId: 's1' })

describe('chime gate', () => {
  it('restore does not chime: events retained before the seed stay silent', () => {
    // The host kept running; three agents finished before this page attached.
    const retained = [finished(1), finished(2), finished(3)]
    const gate = createChimeGate()
    gate.seed(Math.max(...retained.map(event => event.seq)))
    expect(retained.map(event => gate.consider(event))).toEqual([false, false, false])
    // The first transition after attaching chimes.
    expect(gate.consider(finished(4))).toBe(true)
  })

  it('stays silent before seeding and seeds only once', () => {
    const gate = createChimeGate()
    expect(gate.seeded).toBe(false)
    expect(gate.consider(finished(1))).toBe(false)
    gate.seed(0)
    gate.seed(10)
    expect(gate.seeded).toBe(true)
    expect(gate.consider(finished(1))).toBe(true)
  })

  it('chimes only for the attention transition and never twice for one sequence', () => {
    const gate = createChimeGate()
    gate.seed(0)
    expect(gate.consider({ seq: 1, kind: 'agent-error' })).toBe(false)
    expect(gate.consider({ seq: 2, kind: 'approval-pending' })).toBe(false)
    expect(gate.consider(finished(3))).toBe(true)
    // A reconnect replays the stream from the attach cursor.
    expect(gate.consider(finished(3))).toBe(false)
  })
})

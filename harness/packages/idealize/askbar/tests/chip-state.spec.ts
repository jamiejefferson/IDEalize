// The chip-state fold: each state's trigger and the precedence (wrong, then
// needs-input, then working while a turn runs, then finished once the Studio
// task is done, then ready while the agent is loaded, then idle) — attention outranks the rest because an owed answer is
// owed whether or not the agent is loaded.
import { describe, expect, it } from 'vitest'
import { chipStateOf } from '../src/chip-state.ts'

describe('chipStateOf', () => {
  it('reads a cold chat with nothing owed as idle', () => {
    expect(chipStateOf({ running: false, live: false, blockers: [] })).toBe('idle')
    // A task the timeline still calls working, on a chat nothing has loaded, is stale: idle.
    expect(chipStateOf({ running: false, live: false, blockers: [], execution: 'working' })).toBe('idle')
  })

  it('reads a live agent between turns as ready, and one whose Studio task is still working as working', () => {
    expect(chipStateOf({ running: false, live: true, blockers: [] })).toBe('ready')
    expect(chipStateOf({ running: false, live: true, blockers: [], execution: 'cancelled' })).toBe('ready')
    expect(chipStateOf({ running: false, live: true, blockers: [], execution: 'working' })).toBe('working')
  })

  it('reads a done task as finished, loaded or cold, acknowledged or not', () => {
    // JJ: "trigger a 'Done' status on the task agents so the user knows they're safe to close".
    expect(chipStateOf({ running: false, live: true, blockers: [], execution: 'done', attention: 'completion' })).toBe('finished')
    expect(chipStateOf({ running: false, live: true, blockers: ['none', 'waiting-on-coordinator'], execution: 'done', attention: 'none' })).toBe('finished')
    expect(chipStateOf({ running: false, live: false, blockers: [], execution: 'done', attention: 'completion' })).toBe('finished')
  })

  it('wrong, needs-input and a running turn all outrank finished', () => {
    expect(chipStateOf({ running: false, live: true, blockers: ['stuck'], execution: 'done', attention: 'completion' })).toBe('wrong')
    expect(chipStateOf({ running: false, live: true, blockers: ['waiting-on-user'], execution: 'done', attention: 'completion' })).toBe('needs-input')
    expect(chipStateOf({ running: true, live: true, blockers: [], execution: 'done', attention: 'completion' })).toBe('working')
  })

  it('reads failure attention, failed execution or a stuck rung as wrong, running or not', () => {
    expect(chipStateOf({ running: true, live: true, blockers: [], attention: 'failure' })).toBe('wrong')
    expect(chipStateOf({ running: true, live: true, blockers: [], execution: 'failed' })).toBe('wrong')
    expect(chipStateOf({ running: true, live: true, blockers: ['none', 'stuck'] })).toBe('wrong')
    expect(chipStateOf({ running: false, live: false, blockers: ['stuck'] })).toBe('wrong')
  })

  it('wrong outranks needs-input and working', () => {
    expect(chipStateOf({ running: true, live: true, blockers: ['stuck'], execution: 'working', attention: 'needs-input' })).toBe('wrong')
  })

  it('reads user-owed attention or a waiting-on-user rung as needs-input, running or not', () => {
    expect(chipStateOf({ running: true, live: true, blockers: [], attention: 'needs-input' })).toBe('needs-input')
    expect(chipStateOf({ running: true, live: true, blockers: [], attention: 'needs-action' })).toBe('needs-input')
    expect(chipStateOf({ running: true, live: true, blockers: [], attention: 'blocked' })).toBe('needs-input')
    expect(chipStateOf({ running: true, live: true, blockers: [], attention: 'handoff-ready' })).toBe('needs-input')
    expect(chipStateOf({ running: true, live: true, blockers: ['waiting-on-user'] })).toBe('needs-input')
    expect(chipStateOf({ running: false, live: false, blockers: [], attention: 'needs-input' })).toBe('needs-input')
  })

  it('needs-input outranks working', () => {
    expect(chipStateOf({ running: true, live: true, blockers: ['waiting-on-user'], execution: 'working' })).toBe('needs-input')
  })

  it('reads a running turn as working whatever the Studio task says, a plain chat included', () => {
    expect(chipStateOf({ running: true, live: true, blockers: [], execution: 'working' })).toBe('working')
    // JJ, 15 Sep 2026: a chat answering with no Studio task read "Ready" with a still dot.
    expect(chipStateOf({ running: true, live: true, blockers: [] })).toBe('working')
    expect(chipStateOf({ running: true, live: true, blockers: ['none', 'waiting-on-coordinator'], execution: 'done', attention: 'none' })).toBe('working')
    expect(chipStateOf({ running: true, live: true, blockers: [], execution: 'done', attention: 'completion' })).toBe('working')
    // A working terminal CLI counts as a running turn on a chat no harness agent holds.
    expect(chipStateOf({ running: true, live: false, blockers: [] })).toBe('working')
  })
})

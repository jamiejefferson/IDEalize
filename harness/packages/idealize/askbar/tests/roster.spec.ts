// The roster join: the requested rows in order (the bar's sidebar selection)
// or the project filter without one, the Studio displayed task driving state
// and the task line, and the comm-only degrade when no Studio is composed.
import type { StudioState } from '@idealize/studio'
import { describe, expect, it } from 'vitest'
import { assembleChips, type CommListRow } from '../src/roster.ts'

const SESSIONS: CommListRow[] = [
  { id: 's-juno', name: 'Juno', title: 'Launch email', projectPath: '/work/demo', unread: 2, role: 'chat', running: false, live: true, status: 'Outlined both tones' },
  { id: 's-nova', name: 'Nova', title: 'Captions', projectPath: '/work/demo', unread: 0, role: 'project-agent', running: true, live: true },
  { id: 's-else', name: 'Rye', title: 'Other project chat', projectPath: '/work/other', unread: 0, role: 'chat', running: true, live: true },
  { id: 's-untitled', title: 'Unnamed chat', projectPath: '/work/demo', unread: 0, role: 'chat', running: false, live: false },
]

const STUDIO: StudioState = {
  agents: {
    's-juno': { displayed: 't1', queued: [], unresolved: [] },
  },
  tasks: [
    {
      id: 't1',
      goal: 'Draft the launch email',
      owner: 's-juno',
      requester: 'user',
      state: 'working',
      attention: 'none',
      created: '2026-09-01T09:00:00Z',
      createdSeq: 1,
      updated: '2026-09-01T09:05:00Z',
    },
  ],
  deliveries: {},
}

describe('assembleChips', () => {
  it('lists only the project’s chats, in listing order, named by comm or title', () => {
    const chips = assembleChips('/work/demo', SESSIONS, [], undefined)
    expect(chips.map(chip => chip.name)).toEqual(['Juno', 'Nova', 'Unnamed chat'])
    expect(chips.map(chip => chip.id)).toEqual(['s-juno', 's-nova', 's-untitled'])
  })

  it('drives state and the task line from the Studio displayed task', () => {
    const chips = assembleChips('/work/demo', SESSIONS, [], STUDIO)
    const juno = chips.find(chip => chip.id === 's-juno')
    expect(juno).toMatchObject({ state: 'working', task: 'Draft the launch email', unread: 2, status: 'Outlined both tones' })
  })

  it('reads the fold’s finished task as finished with its goal on the task line, until new work is displayed', () => {
    const done = { ...STUDIO.tasks[0]!, state: 'done' as const, attention: 'completion' as const }
    const finished: StudioState = { ...STUDIO, tasks: [done], agents: { 's-juno': { finished: 't1', queued: [], unresolved: ['t1'] } } }
    expect(assembleChips('/work/demo', SESSIONS, [], finished).find(chip => chip.id === 's-juno'))
      .toMatchObject({ state: 'finished', task: 'Draft the launch email' })
    const next = { ...STUDIO.tasks[0]!, id: 't2', goal: 'Draft the follow-up', state: 'queued' as const, createdSeq: 2 }
    const reassigned: StudioState = { ...STUDIO, tasks: [done, next], agents: { 's-juno': { displayed: 't2', queued: ['t2'], unresolved: ['t1'] } } }
    expect(assembleChips('/work/demo', SESSIONS, [], reassigned).find(chip => chip.id === 's-juno'))
      .toMatchObject({ state: 'ready', task: 'Draft the follow-up' })
  })

  it('degrades honestly without Studio: comm signals alone decide state', () => {
    const chips = assembleChips('/work/demo', SESSIONS, [{ session: 's-nova', blocker: 'waiting-on-user' }], undefined)
    expect(chips.find(chip => chip.id === 's-nova')).toMatchObject({ state: 'needs-input', task: null })
    // Live between turns: ready. Cold: idle.
    expect(chips.find(chip => chip.id === 's-juno')).toMatchObject({ state: 'ready' })
    expect(chips.find(chip => chip.id === 's-untitled')).toMatchObject({ state: 'idle' })
  })

  it('reads a running turn as working with or without a Studio task', () => {
    const chips = assembleChips('/work/demo', SESSIONS, [], undefined)
    expect(chips.find(chip => chip.id === 's-nova')).toMatchObject({ state: 'working', task: null })
    const withTerminal = assembleChips('/work/demo', SESSIONS, [], undefined, undefined, new Set(['s-untitled']))
    expect(withTerminal.find(chip => chip.id === 's-untitled')).toMatchObject({ state: 'working' })
  })

  it('covers exactly the requested sessions in their order, skipping ids comm does not list', () => {
    const chips = assembleChips('/work/demo', SESSIONS, [], undefined, ['s-nova', 's-studio', 's-else', 's-juno'])
    expect(chips.map(chip => chip.id)).toEqual(['s-nova', 's-else', 's-juno'])
    expect(assembleChips('/work/demo', SESSIONS, [], undefined, [])).toEqual([])
  })
})

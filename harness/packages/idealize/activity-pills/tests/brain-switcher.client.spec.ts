/**
 * The brain switcher's controller: which brains a chat's space offers, which
 * of them restart the terminal, and what a switch writes on a blank chat
 * versus a started one.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SpaceRosterEntry } from '@idealize/spaces/client'
import { terminalRestarts } from '../src/availability.ts'
import {
  BrainSwitcherController, composeBrains, launchOf, resolveCurrentBrain,
  type BrainAgent, type BrainSessionSummary, type BrainSwitcherWrites, type TerminalLaunchTable,
} from '../src/client/brain-switcher.ts'

const LAUNCHES: TerminalLaunchTable = {
  default: 'pi --chat',
  byActivity: { coding: 'claude --dangerously-skip-permissions', design: '  pi --chat  ' },
}

const AGENTS: BrainAgent[] = [
  { id: 'pi', name: 'pi', model: { provider: 'openrouter', model: 'pi-1' }, instructions: 'Be exact.' },
  { id: 'coding', name: 'Claude Code', model: { provider: 'anthropic', model: 'sonnet' }, instructions: 'Write code.' },
  { id: 'design', name: 'Design', model: { provider: 'openrouter', model: 'pi-1' }, instructions: 'Draw.' },
  { id: 'writing', name: 'Writing', model: { provider: 'openrouter', model: 'pi-1' }, instructions: '' },
]

function entry(id: SpaceRosterEntry['id'], brains: string[], defaultBrain?: string): SpaceRosterEntry {
  return {
    id,
    brainCount: brains.length,
    brains: brains.map(brain => ({
      id: brain,
      name: AGENTS.find(agent => agent.id === brain)?.name ?? brain,
      ...brain === defaultBrain ? { default: true as const } : {},
    })),
    models: 'some',
  }
}

const TERMINAL = entry('terminal', ['pi', 'coding', 'design', 'writing'], 'pi')

describe('terminalRestarts', () => {
  it('fires on a different provider, on a different command, and on neither', () => {
    const current = { provider: 'openrouter', launch: 'pi --chat' }
    expect(terminalRestarts(current, { provider: 'anthropic', launch: 'pi --chat' })).toBe(true)
    expect(terminalRestarts(current, { provider: 'openrouter', launch: 'claude' })).toBe(true)
    expect(terminalRestarts(current, { provider: 'openrouter', launch: 'pi --chat' })).toBe(false)
  })
})

describe('launchOf', () => {
  it('takes the command a brain declares, else the default, and trims both', () => {
    expect(launchOf('coding', LAUNCHES)).toBe('claude --dangerously-skip-permissions')
    expect(launchOf('design', LAUNCHES)).toBe('pi --chat')
    expect(launchOf('nobody', LAUNCHES)).toBe('pi --chat')
  })
})

describe('composeBrains', () => {
  it('marks only the brains whose shell command or provider differs from the running one', () => {
    const rows = composeBrains(TERMINAL, AGENTS, 'pi', LAUNCHES)
    expect(rows.map(row => [row.id, row.restarts])).toEqual([
      ['pi', false],
      ['coding', true],
      ['design', false],
      ['writing', false],
    ])
  })

  it('never marks the brain the chat is already running', () => {
    const rows = composeBrains(TERMINAL, AGENTS, 'coding', LAUNCHES)
    expect(rows.find(row => row.id === 'coding')?.restarts).toBe(false)
    expect(rows.find(row => row.id === 'pi')?.restarts).toBe(true)
  })

  it('marks nothing outside the Terminal space, where there is no shell to lose', () => {
    const rows = composeBrains(entry('chat', ['pi', 'coding'], 'pi'), AGENTS, 'pi', undefined)
    expect(rows.every(row => !row.restarts)).toBe(true)
  })

  it('carries the default mark, the model, and the standing instructions', () => {
    const rows = composeBrains(TERMINAL, AGENTS, 'pi', LAUNCHES)
    expect(rows[0]).toMatchObject({ id: 'pi', isDefault: true, instructions: 'Be exact.' })
    expect(rows[0]?.model).toEqual({ provider: 'openrouter', model: 'pi-1' })
    expect(rows.find(row => row.id === 'writing')?.instructions).toBe('')
  })

  it('falls back to the roster row for a brain the agents route does not list', () => {
    const rows = composeBrains(entry('chat', ['ghost']), [], 'pi', undefined)
    expect(rows[0]).toMatchObject({ id: 'ghost', model: null, instructions: '' })
  })
})

describe('resolveCurrentBrain', () => {
  const gallery = entry('gallery', ['gallery-brain'], 'gallery-brain')

  it('takes the recorded brain, then the preset, when the space offers them', () => {
    expect(resolveCurrentBrain(TERMINAL, STARTED)).toBe('pi')
    expect(resolveCurrentBrain(TERMINAL, { id: 's1', blank: false, space: 'terminal', agentPreset: 'design' })).toBe('design')
  })

  it('takes the space default over a brain the space does not offer', () => {
    // The chat was relaunched into Chat and its log still names the Gallery
    // brain; the preset names what the chat is actually running.
    const chat = entry('chat', ['coding', 'design'], 'coding')
    expect(resolveCurrentBrain(chat, {
      id: 's1', blank: true, space: 'chat', agentPreset: 'coding', brain: 'gallery-brain',
    })).toBe('coding')
    // A chat launched into Gallery whose preset has not caught up.
    expect(resolveCurrentBrain(gallery, {
      id: 's1', blank: true, space: 'gallery', agentPreset: 'coding',
    })).toBe('gallery-brain')
  })

  it('falls to the first brain where the space marks no default, and to nothing where it has none', () => {
    expect(resolveCurrentBrain(entry('chat', ['coding', 'design']), { id: 's1', blank: true, space: 'chat' })).toBe('coding')
    expect(resolveCurrentBrain(entry('motion', []), { id: 's1', blank: true, space: 'motion' })).toBe('')
  })
})

function harness(options: { space?: SpaceRosterEntry['id']; launches?: TerminalLaunchTable } = {}) {
  const calls: string[] = []
  const refusable = async (step: string): Promise<string | null> => {
    calls.push(step)
    return null
  }
  const writes = {
    recompose: vi.fn(() => refusable('recompose')),
    selectModel: vi.fn(() => refusable('selectModel')),
    record: vi.fn(async () => { calls.push('record') }),
    restartTerminal: vi.fn(async () => { calls.push('restart') }),
  } satisfies BrainSwitcherWrites
  const space = options.space ?? 'terminal'
  const controller = new BrainSwitcherController(
    {
      roster: () => Promise.resolve([entry(space, ['pi', 'coding', 'design', 'writing'], 'pi')]),
      agents: () => Promise.resolve(AGENTS),
      launches: () => Promise.resolve(options.launches ?? LAUNCHES),
    },
    writes,
  )
  return { controller, writes, calls }
}

const STARTED: BrainSessionSummary = { id: 's1', blank: false, space: 'terminal', agentPreset: 'pi', brain: 'pi' }

describe('BrainSwitcherController', () => {
  it('reads the brains of the space this chat is in, and the one it runs', async () => {
    const { controller } = harness()
    await controller.load(STARTED)
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.space).toBe('terminal')
    expect(state.currentId).toBe('pi')
    expect(state.brains.map(brain => brain.id)).toEqual(['pi', 'coding', 'design', 'writing'])
  })

  it('falls back to the preset when no brain is recorded yet', async () => {
    const { controller } = harness()
    await controller.load({ id: 's1', blank: false, space: 'terminal', agentPreset: 'design' })
    expect(controller.store.getSnapshot().currentId).toBe('design')
  })

  it('offers nothing for a space the roster does not carry', async () => {
    const { controller } = harness({ space: 'chat' })
    await controller.load({ ...STARTED, space: 'gallery' })
    expect(controller.store.getSnapshot().brains).toEqual([])
  })

  it('reports a failed read rather than showing a stale list', async () => {
    const controller = new BrainSwitcherController(
      {
        roster: () => Promise.reject(new Error('roster 500')),
        agents: () => Promise.resolve(AGENTS),
        launches: () => Promise.resolve(LAUNCHES),
      },
      { recompose: async () => null, selectModel: async () => null, record: async () => {} },
    )
    await controller.load(STARTED)
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'roster 500' })
  })

  it('a started chat takes the model and the logged record, never the tools', async () => {
    const { controller, writes, calls } = harness()
    await controller.load(STARTED)
    await controller.select('design', STARTED)
    expect(writes.recompose).not.toHaveBeenCalled()
    expect(writes.selectModel).toHaveBeenCalledWith('s1', { provider: 'openrouter', model: 'pi-1' })
    expect(writes.record).toHaveBeenCalledWith({
      sessionId: 's1', space: 'terminal', brain: 'design', instructions: 'Draw.',
    })
    // No restart: Design types the same command pi does.
    expect(calls).toEqual(['selectModel', 'record'])
    expect(controller.store.getSnapshot().currentId).toBe('design')
  })

  it('restarts the shell only for a brain whose row said it would', async () => {
    const { controller, writes, calls } = harness()
    await controller.load(STARTED)
    await controller.select('coding', STARTED)
    expect(calls).toEqual(['selectModel', 'record', 'restart'])
    expect(writes.restartTerminal).toHaveBeenCalledWith('s1', 'coding')
  })

  it('a blank chat is recomposed on the brain instead', async () => {
    const { controller, writes, calls } = harness()
    const blank: BrainSessionSummary = { id: 's2', blank: true, space: 'terminal', agentPreset: 'pi' }
    await controller.load(blank)
    await controller.select('design', blank)
    expect(writes.recompose).toHaveBeenCalledWith('design', blank)
    expect(writes.selectModel).not.toHaveBeenCalled()
    expect(calls).toEqual(['recompose', 'record'])
  })

  it('omits instructions from the record when the brain carries none', async () => {
    const { controller, writes } = harness()
    await controller.load(STARTED)
    await controller.select('writing', STARTED)
    expect(writes.record).toHaveBeenCalledWith({ sessionId: 's1', space: 'terminal', brain: 'writing' })
  })

  it('stops at a refused write, leaving the shell and the record untouched', async () => {
    const { controller, writes, calls } = harness()
    writes.selectModel.mockImplementation(async () => 'model rejected')
    await controller.load(STARTED)
    await controller.select('coding', STARTED)
    expect(calls).toEqual([])
    expect(writes.record).not.toHaveBeenCalled()
    expect(writes.restartTerminal).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toMatchObject({ busy: null, error: 'model rejected' })
  })

  it('ignores a brain that is not on the list, and a second switch while one is in flight', async () => {
    const { controller, writes } = harness()
    await controller.load(STARTED)
    await controller.select('nobody', STARTED)
    expect(writes.record).not.toHaveBeenCalled()
    controller.store.set({ ...controller.store.getSnapshot(), busy: 'design' })
    await controller.select('coding', STARTED)
    expect(writes.record).not.toHaveBeenCalled()
  })

  it('reports a thrown write rather than leaving the menu busy', async () => {
    const { controller, writes } = harness()
    writes.record.mockImplementation(() => Promise.reject(new Error('record failed')))
    await controller.load(STARTED)
    await controller.select('design', STARTED)
    expect(controller.store.getSnapshot()).toMatchObject({ busy: null, error: 'record failed' })
  })

  // The launch changes the chat's space, preset and recorded brain over
  // separate frames, each firing another read. Coalescing them left the
  // earlier answer standing and the composer naming the brain the chat had
  // just left, which is the raw-id label of the 27 Aug landing walk.
  it('lets the newest read win when a launch fires several at once', async () => {
    const roster: SpaceRosterEntry[] = [
      entry('chat', ['coding', 'design'], 'coding'),
      entry('gallery', ['pi'], 'pi'),
    ]
    const gates: (() => void)[] = []
    const controller = new BrainSwitcherController(
      {
        roster: () => new Promise((resolve) => { gates.push(() => { resolve(roster) }) }),
        agents: () => Promise.resolve(AGENTS),
        launches: () => Promise.resolve(LAUNCHES),
      },
      { recompose: async () => null, selectModel: async () => null, record: async () => {} },
    )
    // The stale read: the chat still reads as the Gallery chat it was.
    const stale = controller.load({ id: 's1', blank: true, space: 'gallery', agentPreset: 'pi', brain: 'pi' })
    // The read the relaunch into Chat asks for.
    const fresh = controller.load({ id: 's1', blank: true, space: 'chat', agentPreset: 'coding', brain: 'coding' })
    // The stale one answers last and must not write.
    gates[1]?.()
    await fresh
    gates[0]?.()
    await stale
    const state = controller.store.getSnapshot()
    expect(state.space).toBe('chat')
    expect(state.currentId).toBe('coding')
    expect(state.brains.map(brain => brain.id)).toEqual(['coding', 'design'])
  })

  it('names a brain of the space when the recorded one belongs to another', async () => {
    const { controller } = harness({ space: 'chat' })
    await controller.load({ id: 's1', blank: true, space: 'chat', agentPreset: 'coding', brain: 'gallery-brain' })
    const state = controller.store.getSnapshot()
    expect(state.currentId).toBe('coding')
    expect(state.brains.some(brain => brain.id === state.currentId)).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ActivityPillsController, type PillsApi, type PillSessionSummary } from '../src/client/pills-store.ts'

function roster(defaultId = 'standard') {
  return ['standard', 'coding', 'design', 'writing', 'admin', 'free'].map(id => ({
    id, trust: 'user' as const, isDefault: id === defaultId, name: id,
  }))
}

function api(defaultId?: string): PillsApi & { selected: unknown[]; updated: unknown[]; models: unknown[] } {
  const selected: unknown[] = []
  const updated: unknown[] = []
  const models: unknown[] = []
  return {
    selected,
    updated,
    models,
    sessions: {
      selectModel: vi.fn(async (payload: unknown) => {
        models.push(payload)
        return { result: { ok: true as const, value: {} } }
      }),
    },
    agentPresets: {
      list: vi.fn(async () => ({
        result: { ok: true as const, value: { presets: roster(defaultId), authorable: true, hasDocument: false } },
      })),
      select: vi.fn(async (payload: { sessionId: string; agentPreset: string }) => {
        selected.push(payload)
        return { result: { ok: true as const, value: { agentPreset: payload.agentPreset } } }
      }),
    },
    settings: {
      update: vi.fn(async (payload: unknown) => {
        updated.push(payload)
        return { result: { ok: true as const, value: {} } }
      }),
    },
  } as unknown as PillsApi & { selected: unknown[]; updated: unknown[]; models: unknown[] }
}

describe('ActivityPillsController', () => {
  it('keeps only the five activity presets, in roster order, ready until the host says otherwise', async () => {
    const controller = new ActivityPillsController(api(), () => undefined)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.pills.map(pill => pill.id)).toEqual(['coding', 'design', 'writing', 'admin', 'free'])
    expect(state.pills.every(pill => pill.availability.state === 'ready')).toBe(true)
    expect(state.defaultId).toBe('standard')
  })

  it('carries the host availability per pill and survives a failed availability read', async () => {
    const withStates = new ActivityPillsController(api(), () => undefined, undefined, undefined, async () => ({
      admin: { model: null, state: 'unavailable' as const, reason: 'no-model' as const },
    }))
    await withStates.load()
    expect(withStates.store.getSnapshot().pills.find(pill => pill.id === 'admin')?.availability.reason).toBe('no-model')
    const failing = new ActivityPillsController(api(), () => undefined, undefined, undefined, async () => { throw new Error('down') })
    await failing.load()
    expect(failing.store.getSnapshot().status).toBe('ready')
  })

  it('recomposes a blank session and writes the default', async () => {
    const wire = api()
    const session: PillSessionSummary = { id: 's1', blank: true }
    const applied = vi.fn()
    const controller = new ActivityPillsController(wire, () => session, applied)
    await controller.load()
    await controller.select('design')
    expect(wire.selected).toEqual([{ sessionId: 's1', agentPreset: 'design' }])
    expect(wire.updated).toEqual([{ ns: 'agent-presets', patch: { default: 'design' } }])
    expect(applied).toHaveBeenCalledWith('s1', 'design')
    expect(controller.store.getSnapshot()).toMatchObject({ defaultId: 'design', busy: null, error: null })
  })

  it('gives a blank session the brain\'s model as well as its preset', async () => {
    const wire = api()
    const availability = vi.fn(async () => ({
      coding: { model: { provider: 'openrouter', model: 'fable' }, state: 'ready' as const },
      admin: { model: null, state: 'unavailable' as const, reason: 'no-model' as const },
    }))
    const controller = new ActivityPillsController(
      wire, () => ({ id: 's1', blank: true }), undefined, undefined, availability,
    )
    await controller.load()
    await controller.select('coding')
    expect(wire.selected).toEqual([{ sessionId: 's1', agentPreset: 'coding' }])
    expect(wire.models).toEqual([{ sessionId: 's1', provider: 'openrouter', model: 'fable' }])
    await controller.select('admin')
    expect(wire.selected).toHaveLength(2)
    expect(wire.models).toHaveLength(1)
  })

  it('changes only the model of a started session and still moves the default', async () => {
    const wire = api()
    const availability = vi.fn(async () => ({
      free: { model: { provider: 'freetokens', model: 'free-1' }, state: 'ready' as const },
      writing: { model: { provider: 'p', model: 'm' }, state: 'ready' as const },
    }))
    const controller = new ActivityPillsController(
      wire, () => ({ id: 's1', blank: false, agentPreset: 'coding' }), undefined, undefined, availability,
    )
    await controller.load()
    await controller.select('writing')
    expect(wire.selected).toEqual([])
    expect(wire.models).toEqual([{ sessionId: 's1', provider: 'p', model: 'm' }])
    expect(wire.updated).toHaveLength(1)
    await controller.select('free')
    expect(wire.models).toHaveLength(2)
    expect(wire.models[1]).toEqual({ sessionId: 's1', provider: 'freetokens', model: 'free-1' })
  })

  it('leaves a started session alone when no model resolves for the pill', async () => {
    const wire = api()
    const controller = new ActivityPillsController(
      wire, () => ({ id: 's1', blank: false }), undefined, undefined, async () => ({}),
    )
    await controller.load()
    await controller.select('admin')
    expect(wire.models).toEqual([])
    expect(controller.store.getSnapshot()).toMatchObject({ defaultId: 'admin', error: null })
  })

  it('routes Free to the free-tokens policy', async () => {
    const freeRoute = vi.fn(async () => {})
    const controller = new ActivityPillsController(api(), () => undefined, undefined, freeRoute)
    await controller.load()
    await controller.select('free')
    expect(freeRoute).toHaveBeenCalledTimes(1)
    await controller.select('coding')
    expect(freeRoute).toHaveBeenCalledTimes(1)
  })

  it('reports a refused select and clears busy', async () => {
    const wire = api()
    wire.agentPresets.select = vi.fn(async () => ({
      result: { ok: false as const, error: { code: 'agent-preset-not-found', message: 'no such preset' } },
    })) as never
    const controller = new ActivityPillsController(wire, () => ({ id: 's1', blank: true }))
    await controller.load()
    await controller.select('admin')
    expect(controller.store.getSnapshot()).toMatchObject({ busy: null, error: 'no such preset' })
    expect(wire.updated).toEqual([])
  })
})

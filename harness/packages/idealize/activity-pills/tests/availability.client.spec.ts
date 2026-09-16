/**
 * Pill availability on a terminal surface: the host's per-brain read knows no
 * chat, so it applies the provider half of the restart rule alone — and a
 * terminal whose running route is unknown restarts for every brain.
 */

import { describe, expect, it } from 'vitest'
import { assessPills } from '../src/availability.ts'
import type { AvailabilityFacts } from '../src/availability.ts'

const model = { provider: 'openai-codex', model: 'gpt-5.5' } as never

function facts(surface: AvailabilityFacts['surface']): AvailabilityFacts {
  return {
    reachable: () => true,
    subscription: () => false,
    surface,
    terminalAvailable: true,
    terminalOnlyProviders: [],
  }
}

describe('a terminal surface', () => {
  it('selects freely when the brain runs on the route the terminal already runs', () => {
    const assessed = assessPills({ build: model }, facts({ kind: 'terminal', provider: 'openai-codex' } as never))
    expect(assessed.build).toEqual({ model, state: 'ready' })
  })

  it('asks first when the brain would move the shell to another route', () => {
    const assessed = assessPills({ build: model }, facts({ kind: 'terminal', provider: 'anthropic' } as never))
    expect(assessed.build).toEqual({ model, state: 'confirm', reason: 'terminal-restart' })
  })

  it('asks first when the terminal names no route at all', () => {
    const assessed = assessPills({ build: model }, facts({ kind: 'terminal' } as never))
    expect(assessed.build).toEqual({ model, state: 'confirm', reason: 'terminal-restart' })
  })
})

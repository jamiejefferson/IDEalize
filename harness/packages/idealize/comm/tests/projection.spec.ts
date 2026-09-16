/**
 * The `agentName` projection: clients read the chat's name beside its title
 * without replaying the session log.
 */

import { describe, expect, it } from 'vitest'
import { agentNameProjectionDefinition, foldAgentName } from '../src/projection.ts'

const named = (name: string) => ({ type: 'idealize/agent-name', data: { name } } as never)

describe('the agentName projection', () => {
  it('starts empty and keeps the latest assignment', () => {
    const definition = agentNameProjectionDefinition
    const start = definition.init()
    expect(definition.view(start)).toEqual({})

    const first = definition.apply(start, named('Watto'))
    const second = definition.apply(first, named('Sebulba'))
    expect(definition.view(second)).toEqual({ name: 'Sebulba' })
  })

  it('ignores every other session event', () => {
    const definition = agentNameProjectionDefinition
    const state = definition.apply({ name: 'Watto' }, { type: 'session/started', data: {} } as never)
    expect(state).toEqual({ name: 'Watto' })
  })

  it('reads the same answer out of a whole log', () => {
    expect(foldAgentName([named('Watto'), named('Sebulba')])).toBe('Sebulba')
    expect(foldAgentName([])).toBeUndefined()
  })
})

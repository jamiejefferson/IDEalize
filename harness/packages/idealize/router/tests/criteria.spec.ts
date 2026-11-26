import { describe, expect, it } from 'vitest'

import { criteriaFor, DEFAULT_LEAN, engineWeights, leanOf, leanWeights, routingHeaderValue, SHIPPED_CRITERIA } from '../src/criteria.ts'
import type { Criteria } from '../src/criteria.ts'

const app: Criteria = { aggressiveness: 'balanced', weights: { cost: 34, speed: 33, intelligence: 33 } }

describe('the Cheaper to Smarter slider', () => {
  it('rests at 35 until a person moves it', () => {
    expect(DEFAULT_LEAN).toBe(35)
    expect(leanWeights(undefined, 33)).toEqual({ cost: 65, speed: 33, intelligence: 35 })
  })

  it('weighs cost alone at one end and intelligence alone at the other, and leaves speed where the app set it', () => {
    expect(leanWeights(0, 20)).toEqual({ cost: 100, speed: 20, intelligence: 0 })
    expect(leanWeights(100, 20)).toEqual({ cost: 0, speed: 20, intelligence: 100 })
    expect(leanWeights(70, 0)).toEqual({ cost: 30, speed: 0, intelligence: 70 })
  })

  it('reads a position as a whole number from 0 to 100, and anything else as unset', () => {
    expect(leanOf(41.6)).toBe(42)
    expect(leanOf(-5)).toBe(0)
    expect(leanOf(250)).toBe(100)
    expect(leanOf('50')).toBeUndefined()
    expect(leanOf(Number.NaN)).toBeUndefined()
    expect(leanWeights(Number.POSITIVE_INFINITY, 33)).toEqual(leanWeights(undefined, 33))
  })
})

describe('the criteria earlier versions stored per preset', () => {
  it('a chat without a brain, and a brain with nothing saved or shipped, read the app-wide values', () => {
    expect(criteriaFor({}, undefined, app)).toEqual(app)
    expect(criteriaFor(undefined, 'writing', app)).toEqual(app)
  })

  it('a shipped brain starts from its own row', () => {
    expect(criteriaFor({}, 'admin', app)).toEqual({ aggressiveness: 'balanced', weights: { cost: 90, speed: 70, intelligence: 20 } })
    expect(SHIPPED_CRITERIA.coding).toEqual({ cost: 10, speed: 80, intelligence: 80 })
  })

  it('what the sheet saved wins, field by field', () => {
    const saved = { coding: { aggressiveness: 'aggressive' as const, speed: 40 }, research: { intelligence: 100 } }
    expect(criteriaFor(saved, 'coding', app)).toEqual({ aggressiveness: 'aggressive', weights: { cost: 10, speed: 40, intelligence: 80 } })
    expect(criteriaFor(saved, 'research', app)).toEqual({ aggressiveness: 'balanced', weights: { cost: 34, speed: 33, intelligence: 100 } })
    // Two brains in one app decide under different criteria.
    expect(criteriaFor(saved, 'admin', app).weights).not.toEqual(criteriaFor(saved, 'coding', app).weights)
  })
})

describe('the free-token engine’s vector', () => {
  it('even priorities give the engine’s balanced preset', () => {
    expect(engineWeights({ cost: 34, speed: 33, intelligence: 33 })).toEqual({ reliability: 0.5, speed: 0.25, intelligence: 0.25 })
  })

  it('speed and intelligence split the half reliability leaves, and cost has no say', () => {
    expect(engineWeights({ cost: 0, speed: 80, intelligence: 20 })).toEqual({ reliability: 0.5, speed: 0.4, intelligence: 0.1 })
    expect(engineWeights({ cost: 100, speed: 80, intelligence: 20 })).toEqual(engineWeights({ cost: 0, speed: 80, intelligence: 20 }))
  })

  it('a brain that weighs only cost gets the balanced preset', () => {
    expect(engineWeights({ cost: 100, speed: 0, intelligence: 0 })).toEqual({ reliability: 0.5, speed: 0.25, intelligence: 0.25 })
  })

  it('travels as three figures in the engine’s axis order', () => {
    expect(routingHeaderValue(engineWeights({ cost: 90, speed: 70, intelligence: 20 }))).toBe('0.500,0.389,0.111')
  })
})

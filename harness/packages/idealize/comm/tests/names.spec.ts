import { describe, expect, it } from 'vitest'
import { NAME_POOLS } from '../src/name-pools.ts'
import { pickName, poolFor } from '../src/names.ts'

describe('NAME_POOLS', () => {
  it('holds 496 unique names across twelve pools', () => {
    const all = NAME_POOLS.flat()
    expect(NAME_POOLS).toHaveLength(12)
    expect(all).toHaveLength(496)
    expect(new Set(all).size).toBe(496)
  })
})

describe('poolFor', () => {
  it('keeps a recorded pool and otherwise picks the least-used one', () => {
    expect(poolFor('/a', { '/a': 7 })).toBe(7)
    expect(poolFor('/new', {})).toBe(0)
    expect(poolFor('/new', { '/a': 0 })).toBe(1)
    expect(poolFor('/new', { '/a': 0, '/b': 1, '/c': 0 })).toBe(2)
  })
})

describe('pickName', () => {
  it('draws from the project pool, never a taken name', () => {
    const taken = new Set(NAME_POOLS[3]?.slice(1) ?? [])
    expect(pickName(3, taken, () => 0.99)).toBe(NAME_POOLS[3]?.[0])
  })

  it('spills into the next pool when the home pool is exhausted', () => {
    const taken = new Set(NAME_POOLS[11] ?? [])
    expect(NAME_POOLS[0]).toContain(pickName(11, taken, () => 0))
  })

  it('numbers a name once all 496 are taken', () => {
    const taken = new Set(NAME_POOLS.flat())
    const first = pickName(2, taken, () => 0)
    expect(first).toBe(`${NAME_POOLS[2]?.[0]} 2`)
    taken.add(first)
    expect(pickName(2, taken, () => 0)).toBe(`${NAME_POOLS[2]?.[0]} 3`)
  })
})

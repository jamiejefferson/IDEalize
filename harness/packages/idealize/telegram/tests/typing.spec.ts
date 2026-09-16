/** "typing…" repeats while a reply is awaited, stops when told, and caps itself. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Typing } from '../src/typing.ts'

function bench(options: { fail?: boolean } = {}) {
  const shown: number[] = []
  const errors: unknown[] = []
  const typing = new Typing({
    messenger: { typing: async () => { shown.push(Date.now()); if (options.fail === true) throw new Error('no network') } },
    intervalMs: 4_000,
    maxMs: 20_000,
    onError: (error) => { errors.push(error) },
  })
  return { typing, shown, errors }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('Typing', () => {
  it('shows at once, repeats on the interval, and stops when told', async () => {
    const { typing, shown } = bench()
    typing.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(shown).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(8_500)
    expect(shown).toHaveLength(3)
    expect(typing.active).toBe(true)
    typing.stop()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(shown).toHaveLength(3)
    expect(typing.active).toBe(false)
  })

  it('stops itself at the cap, and a restart moves the cap', async () => {
    const { typing, shown } = bench()
    typing.start()
    await vi.advanceTimersByTimeAsync(12_000)
    typing.start()
    await vi.advanceTimersByTimeAsync(19_000)
    expect(typing.active).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(typing.active).toBe(false)
    const count = shown.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(shown).toHaveLength(count)
  })

  it('reports a failed action and keeps going', async () => {
    const { typing, errors } = bench({ fail: true })
    typing.start()
    await vi.advanceTimersByTimeAsync(4_100)
    expect(errors).toHaveLength(2)
    expect(typing.active).toBe(true)
    typing.stop()
  })
})

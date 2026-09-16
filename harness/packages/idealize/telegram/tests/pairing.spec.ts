/** Pairing codes: single use, expiry, and withdrawal after wrong guesses. */

import { describe, expect, it } from 'vitest'
import { Pairing } from '../src/pairing.ts'

function clock(start = 1_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('Pairing', () => {
  it('issues a six-digit code that expires after the lifetime', () => {
    const time = clock()
    const pairing = new Pairing(60_000, 5, time.now)
    const code = pairing.issue()
    expect(code.code).toMatch(/^\d{6}$/)
    expect(code.expiresAt).toBe(61_000)
    expect(pairing.pending()).toEqual(code)
    time.advance(60_001)
    expect(pairing.pending()).toBeUndefined()
  })

  it('pairs once with the live code', () => {
    const pairing = new Pairing(60_000, 5)
    const { code } = pairing.issue()
    expect(pairing.claim(` ${code} `)).toBe('paired')
    expect(pairing.claim(code)).toBe('no-code')
  })

  it('refuses an expired code and forgets it', () => {
    const time = clock()
    const pairing = new Pairing(10, 5, time.now)
    const { code } = pairing.issue()
    time.advance(11)
    expect(pairing.claim(code)).toBe('expired')
    expect(pairing.claim(code)).toBe('no-code')
  })

  it('withdraws the code after too many wrong guesses', () => {
    const pairing = new Pairing(60_000, 2)
    const { code } = pairing.issue()
    const wrong = code === '000000' ? '111111' : '000000'
    expect(pairing.claim(wrong)).toBe('wrong')
    expect(pairing.pending()).toBeDefined()
    expect(pairing.claim(wrong)).toBe('wrong')
    expect(pairing.claim(code)).toBe('no-code')
  })

  it('resets the guess count with a fresh code and can be cancelled', () => {
    const pairing = new Pairing(60_000, 2)
    const first = pairing.issue()
    pairing.claim(first.code === '000000' ? '111111' : '000000')
    const second = pairing.issue()
    pairing.claim(second.code === '000000' ? '111111' : '000000')
    expect(pairing.pending()).toEqual(second)
    pairing.cancel()
    expect(pairing.pending()).toBeUndefined()
  })
})

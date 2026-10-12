import { afterEach, describe, expect, it } from 'vitest'
import { installLaunchGate } from '../src/launch-gate.ts'

const KEY = Symbol.for('idealize.launch-token')

afterEach(() => { Reflect.deleteProperty(globalThis, KEY) })

describe('installLaunchGate', () => {
  it('hands the harness the token and sets it as an HTTP-only same-site session cookie on both loopback names', async () => {
    const set: unknown[] = []
    const token = await installLaunchGate({ cookies: { set: async (details: unknown) => { set.push(details) } } } as never, () => 'f'.repeat(64))
    expect(token).toBe('f'.repeat(64))
    expect((globalThis as Record<symbol, unknown>)[KEY]).toBe(token)
    expect(set).toEqual(['http://127.0.0.1/', 'http://localhost/'].map(url => ({
      url, name: 'idealize_launch', value: token, httpOnly: true, sameSite: 'strict',
    })))
    // No expiry: the cookie lives in memory and dies with the app.
    expect(set.every(details => !Object.hasOwn(details as object, 'expirationDate'))).toBe(true)
  })

  it('mints a fresh 64-hex-character token by default', async () => {
    const first = await installLaunchGate({ cookies: { set: async () => {} } } as never)
    const second = await installLaunchGate({ cookies: { set: async () => {} } } as never)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).not.toBe(first)
  })
})

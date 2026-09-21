/**
 * The auto policy's read of the engine's key headroom: one sign-in serves
 * every pass until the engine refuses the session, then one more does.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngineKeyReader } from '../src/engine-keys.ts'

const ORIGIN = 'http://127.0.0.1:8000'
const KEYS = [
  { enabled: true, status: 'healthy' },
  { enabled: true, status: 'unknown' },
  { enabled: true, status: 'exhausted' },
  { enabled: false, status: 'healthy' },
]

afterEach(() => { vi.unstubAllGlobals() })

/** A fake engine: counts sign-ins, and refuses the tokens a test revokes. */
function engine(options: { password?: string; keys?: unknown } = {}) {
  const calls: string[] = []
  const revoked = new Set<string>()
  let issued = 0
  let refuseAll = false
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const path = input.slice(ORIGIN.length)
    calls.push(path)
    if (path === '/api/auth/login') {
      const body = JSON.parse(init?.body as string) as { email: string; password: string }
      if (body.password !== (options.password ?? 'secret')) return Promise.resolve(Response.json({ error: 'bad credentials' }, { status: 401 }))
      issued += 1
      return Promise.resolve(Response.json({ token: `token-${issued}` }))
    }
    const token = (init?.headers as Record<string, string>).authorization?.replace('Bearer ', '') ?? ''
    if (refuseAll || revoked.has(token)) {
      return Promise.resolve(Response.json({ error: { message: 'Authentication required' } }, { status: 401 }))
    }
    return Promise.resolve(Response.json(options.keys ?? KEYS))
  })
  const logins = (): number => calls.filter(path => path === '/api/auth/login').length
  return { calls, logins, revoke: (token: string) => revoked.add(token), revokeAll: () => { refuseAll = true } }
}

describe('the engine key reader', () => {
  it('signs in once across several passes', async () => {
    const fake = engine()
    const reader = createEngineKeyReader()
    for (let pass = 0; pass < 4; pass += 1) expect(await reader.usableKeys(ORIGIN, 'secret')).toBe(2)
    expect(fake.logins()).toBe(1)
    expect(fake.calls).toEqual(['/api/auth/login', '/api/keys', '/api/keys', '/api/keys', '/api/keys'])
  })

  it('signs in again, once, when the engine refuses the session it carried', async () => {
    const fake = engine()
    const reader = createEngineKeyReader()
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBe(2)
    fake.revoke('token-1')
    // The refused pass still answers: 401, sign in, retry.
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBe(2)
    expect(fake.calls).toEqual(['/api/auth/login', '/api/keys', '/api/keys', '/api/auth/login', '/api/keys'])
    // And the new session is the one carried from here.
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBe(2)
    expect(fake.logins()).toBe(2)
  })

  it('does not loop on an engine that refuses every session', async () => {
    const fake = engine()
    const reader = createEngineKeyReader()
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBe(2)
    fake.revokeAll()
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBeUndefined()
    expect(fake.logins()).toBe(2)
    // A session refused the pass it was issued is not retried within the pass.
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBeUndefined()
    expect(fake.logins()).toBe(3)
  })

  it('signs in afresh for another password or another engine', async () => {
    const fake = engine()
    const reader = createEngineKeyReader()
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBe(2)
    expect(await reader.usableKeys(ORIGIN, 'rotated')).toBeUndefined()
    expect(fake.logins()).toBe(2)
    expect(await reader.usableKeys(ORIGIN, 'secret')).toBe(2)
    expect(fake.logins()).toBe(2)
  })

  it('reads unknown from a failed sign-in, an unexpected answer, and an unreachable engine', async () => {
    engine({ password: 'other' })
    expect(await createEngineKeyReader().usableKeys(ORIGIN, 'secret')).toBeUndefined()

    engine({ keys: { error: 'nope' } })
    expect(await createEngineKeyReader().usableKeys(ORIGIN, 'secret')).toBeUndefined()

    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')))
    expect(await createEngineKeyReader().usableKeys(ORIGIN, 'secret')).toBeUndefined()
  })
})

import { describe, expect, it, vi } from 'vitest'

import { canProbe, checkKey } from '../src/connection-check.ts'

const answering = (status: number, body: unknown = {}) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch

describe('checkKey', () => {
  it('reads a good key as working', async () => {
    expect(await checkKey('openrouter', 'k', answering(200, { data: { limit_remaining: 12 } }))).toBe('working')
    expect(await checkKey('openrouter', 'k', answering(200, { data: { limit_remaining: null } }))).toBe('working')
  })

  it('reads a refused key as refused', async () => {
    expect(await checkKey('openrouter', 'k', answering(401))).toBe('refused')
    expect(await checkKey('anthropic', 'k', answering(403))).toBe('refused')
  })

  it('reads a good key on an empty account as out of credit', async () => {
    expect(await checkKey('openrouter', 'k', answering(200, { data: { limit_remaining: 0 } }))).toBe('no-credit')
    expect(await checkKey('deepseek', 'k', answering(200, { is_available: false }))).toBe('no-credit')
    expect(await checkKey('openai', 'k', answering(402))).toBe('no-credit')
  })

  it('does not call a fal key bad for lacking a permission', async () => {
    expect(await checkKey('fal', 'k', answering(403))).toBe('untested')
    expect(await checkKey('fal', 'k', answering(401))).toBe('refused')
  })

  it('reads a network failure or a server fault as not answering, not as a bad key', async () => {
    expect(await checkKey('openai', 'k', vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBe('failed')
    expect(await checkKey('openai', 'k', answering(503))).toBe('failed')
  })

  it('learns nothing from being asked to slow down', async () => {
    expect(await checkKey('fal', 'k', answering(429))).toBe('untested')
  })

  it('leaves a service with no free test untested, and sends it nothing', async () => {
    const transport = answering(200)
    expect(canProbe('moonshotai')).toBe(false)
    expect(await checkKey('moonshotai', 'k', transport)).toBe('untested')
    expect(transport).not.toHaveBeenCalled()
  })
})

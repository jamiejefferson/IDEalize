import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { forgetGatewayRefusals, noteRefusal, readRefusals, refusalCause, REFUSED_FILE, sitsOut } from '../src/refused.ts'
import type { Refusals } from '../src/refused.ts'

const MINUTE = 60_000
const luna = { provider: 'gateway-openrouter', model: 'openai/gpt-5.6-luna' }
const haiku = { provider: 'gateway-openrouter', model: '~anthropic/claude-haiku-latest' }
const direct = { provider: 'openrouter', model: 'openai/gpt-5.6-luna' }

describe('how long a failed model sits out', () => {
  let home: string
  beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'router-refused-')) })
  afterEach(async () => { await rm(home, { recursive: true, force: true }) })

  it('reads a dropped connection as the route, and a timeout or server error as a busy model', () => {
    expect(refusalCause('TRANSPORT')).toBe('unreachable')
    for (const code of ['RATE_LIMIT', 'TIMEOUT', 'SERVER']) expect(refusalCause(code)).toBe('rate-limited')
    for (const code of ['PI_AI_ERROR', 'AUTH', 'INVALID_REQUEST']) expect(refusalCause(code)).toBe('refused')
  })

  it('keeps every model on an unreachable route out for ten minutes and blames none of them', async () => {
    // JJ, 11 Nov 2026: a gateway address the office network blocked cost six models a week each, one per turn.
    const refusals: Refusals = {}
    await noteRefusal(home, refusals, luna, 'unreachable', 0)
    expect(sitsOut(refusals, luna, 9 * MINUTE)).toBe(true)
    expect(sitsOut(refusals, haiku, 9 * MINUTE)).toBe(true)
    expect(sitsOut(refusals, direct, 9 * MINUTE)).toBe(false)
    expect(sitsOut(refusals, luna, 11 * MINUTE)).toBe(false)
    expect(await readRefusals(home, 11 * MINUTE)).toEqual({})
  })

  it('keeps a refused model out for a week and a busy one for an hour, other models untouched', async () => {
    const refusals: Refusals = {}
    await noteRefusal(home, refusals, luna, 'refused', 0)
    await noteRefusal(home, refusals, haiku, 'rate-limited', 0)
    expect(sitsOut(refusals, luna, 6 * 24 * 60 * MINUTE)).toBe(true)
    expect(sitsOut(refusals, haiku, 59 * MINUTE)).toBe(true)
    expect(sitsOut(refusals, haiku, 61 * MINUTE)).toBe(false)
    expect(sitsOut(refusals, direct, MINUTE)).toBe(false)
  })

  it('forgets a gateway\'s refusals when its address or key changes, and keeps the direct ones', async () => {
    const refusals = await readRefusals(home)
    await noteRefusal(home, refusals, { provider: 'gateway-anthropic', model: 'claude-sonnet-5-5' })
    await noteRefusal(home, refusals, { provider: 'openai-codex', model: 'gpt-5.5' })

    // The first sight of a gateway clears what an earlier one left behind.
    expect(await forgetGatewayRefusals(home, refusals, 'https://old.test|1234')).toBe(true)
    expect(refusals['gateway-anthropic/claude-sonnet-5-5']).toBe(0)
    expect(Object.keys(JSON.parse(await readFile(join(home, REFUSED_FILE), 'utf8')) as object)).toEqual(['openai-codex/gpt-5.5'])

    // The same gateway keeps what it has since refused, across a restart.
    await noteRefusal(home, refusals, { provider: 'gateway-anthropic', model: 'claude-3-haiku' })
    expect(await forgetGatewayRefusals(home, await readRefusals(home), 'https://old.test|1234')).toBe(false)
    expect(Object.keys(await readRefusals(home))).toContain('gateway-anthropic/claude-3-haiku')

    // A new address starts clean.
    const later = await readRefusals(home)
    expect(await forgetGatewayRefusals(home, later, 'https://new.test|1234')).toBe(true)
    expect(Object.keys(await readRefusals(home))).toEqual(['openai-codex/gpt-5.5'])
  })
})

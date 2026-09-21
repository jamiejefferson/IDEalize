import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { Decision } from '../src/decide.ts'
import { appendLog, entryFor, readLog, ROUTER_LOG_FILE } from '../src/log.ts'

const mini = { provider: 'openrouter', model: 'openai/gpt-5-mini', label: 'GPT mini', price: { input: 0.25, output: 2 } } as const
const sonnet = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet', price: { input: 3, output: 15 } } as const
const reading = { task: 'code', difficulty: 'hard', confidence: 0.9, source: 'jev' } as const

const decision: Decision = {
  use: sonnet, switched: true, currentModelConfidence: 0.8, switchConfidence: 0.9, improvement: 0.21349,
  gates: { throttle: true, confidence: true, improvement: true }, rationale: 'Claude Sonnet is stronger at writing or fixing code.', scored: [],
}

describe('the router log', () => {
  it('records the figures of a decision and nothing of the message', () => {
    const entry = entryFor('s1', decision, reading, { brain: 'coding', from: mini, jevMs: 320, now: new Date('2026-09-21T12:00:00Z') })
    expect(entry).toMatchObject({
      at: '2026-09-21T12:00:00.000Z', session: 's1', brain: 'coding', switched: true,
      from: 'openrouter/openai/gpt-5-mini', to: 'openrouter/anthropic/claude-sonnet-5', improvement: 0.213,
    })
    expect(Object.keys(entry)).not.toContain('message')
  })

  it('reads back newest first and skips a torn line', async () => {
    const home = await mkdtemp(join(tmpdir(), 'router-log-'))
    await appendLog(home, entryFor('first', decision, reading, { from: mini }))
    await appendLog(home, entryFor('second', decision, reading, { from: mini }))
    await writeFile(join(home, ROUTER_LOG_FILE), `${await readFile(join(home, ROUTER_LOG_FILE), 'utf8')}{"at":"torn`, 'utf8')
    const entries = await readLog(home)
    expect(entries.map(entry => entry.session)).toEqual(['second', 'first'])
  })

  it('reads an absent log as empty', async () => {
    expect(await readLog(join(tmpdir(), 'router-log-absent'))).toEqual([])
  })
})

describe('refused models', () => {
  it('remembers a refusal across a restart and forgets it after a week', async () => {
    const { noteRefusal, readRefusals } = await import('../src/refused.ts')
    const home = await mkdtemp(join(tmpdir(), 'router-refused-'))
    const now = Date.parse('2026-09-21T12:00:00Z')
    await noteRefusal(home, {}, { provider: 'openai-codex', model: 'gpt-5.4' }, now)
    expect(Object.keys(await readRefusals(home, now + 60_000))).toEqual(['openai-codex/gpt-5.4'])
    expect(await readRefusals(home, now + 8 * 24 * 60 * 60 * 1000)).toEqual({})
  })
})

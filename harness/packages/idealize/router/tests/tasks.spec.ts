import { describe, expect, it } from 'vitest'
import { PRESETS } from '../src/decide.ts'
import { readLocally } from '../src/tasks.ts'

describe('the local reading', () => {
  it('reads the task from keywords', () => {
    expect(readLocally('Fix the bug in this TypeScript function').task).toBe('code')
    expect(readLocally('Can you summarise these meeting notes?').task).toBe('summarise')
    expect(readLocally('Draft an email to the client about the delay').task).toBe('writing')
    expect(readLocally('Translate this into French').task).toBe('translate')
    expect(readLocally('What is the standard deviation of these figures?').task).toBe('math')
    expect(readLocally('Compare the trade-offs of the two approaches').task).toBe('reasoning')
  })

  it('reads a short unmatched message as a quick answer no gate lets through', () => {
    const reading = readLocally('thanks, and the capital of Peru?')
    expect(reading).toMatchObject({ task: 'quick', difficulty: 'simple', source: 'rules' })
    expect(reading.confidence).toBeLessThan(PRESETS.aggressive.confidence)
  })

  it('reads length and structure as difficulty', () => {
    expect(readLocally('rename this variable').difficulty).toBe('simple')
    expect(readLocally(`refactor ${'the module and its callers '.repeat(12)}`).difficulty).toBe('moderate')
    expect(readLocally('Build this:\n- a parser\n- a printer\n- a test suite\n- a CLI\n').difficulty).toBe('hard')
  })

  it('clears the balanced gate on a keyword match and not the conservative one', () => {
    const { confidence } = readLocally('debug this stack trace')
    expect(confidence).toBeGreaterThanOrEqual(PRESETS.balanced.confidence)
    expect(confidence).toBeLessThan(PRESETS.conservative.confidence)
  })

  it('takes the brain as the task when the message names none, and the message when it does', () => {
    expect(readLocally('make it shorter please', 'coding')).toMatchObject({ task: 'code', source: 'brain' })
    expect(readLocally('draft an email to the client', 'coding')).toMatchObject({ task: 'writing', source: 'rules' })
    expect(readLocally('make it shorter please', 'my-own-brain').source).toBe('rules')
  })
})

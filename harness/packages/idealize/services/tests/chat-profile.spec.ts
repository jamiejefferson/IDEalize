/**
 * Where a chat route's profile lives: read through the route's own adapter
 * section, which the services list and the model router both rely on.
 */

import { describe, expect, it } from 'vitest'
import { chatProfileOf, recordedKeyEnv } from '../src/chat-profile.ts'

const SECTIONS: Record<string, unknown> = {
  'llm-pi-ai': { providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' }, acme: {} } },
  // DeepSeek's adapter: the whole section is the profile, its default filled in.
  'llm-deepseek': { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com' },
}
const read = (ns: string): unknown => SECTIONS[ns]

describe('a chat route profile', () => {
  it('reads a pi-ai route under its providers entry', () => {
    const route = { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'] }
    expect(chatProfileOf(read, route)).toEqual({ apiKeyEnv: 'ANTHROPIC_API_KEY' })
    expect(recordedKeyEnv(read, route)).toBe('ANTHROPIC_API_KEY')
  })

  it('reads a route whose whole section is its profile', () => {
    const route = { settingsNs: 'llm-deepseek', settingsPath: [] }
    expect(recordedKeyEnv(read, route)).toBe('DEEPSEEK_API_KEY')
  })

  it('names no credential for a profile without one, an absent path or an unregistered section', () => {
    expect(recordedKeyEnv(read, { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme'] })).toBeUndefined()
    expect(recordedKeyEnv(read, { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'nobody'] })).toBeUndefined()
    expect(recordedKeyEnv(read, { settingsNs: 'llm-elsewhere', settingsPath: [] })).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { resolveTarget } from '../src/resolve.ts'
import type { SessionRecord } from '../src/resolve.ts'

const roster: SessionRecord[] = [
  { id: 't-coord-a', label: 'Coordinator', cwd: '/p/alpha', role: 'project-agent' },
  { id: 't-coord-b', label: 'Coordinator', cwd: '/p/beta', role: 'project-agent' },
  { id: 't-1', name: 'Watto', label: 'Hero', cwd: '/p/alpha', role: 'chat' },
  { id: 't-2', label: 'Nav', cwd: '/p/alpha', role: 'chat' },
  { id: 't-3', label: 'Nav', cwd: '/p/beta', role: 'chat' },
]

describe('resolveTarget', () => {
  it('matches an id exactly', () => {
    expect(resolveTarget('t-2', roster)).toEqual({ ok: true, session: roster[3] })
  })

  it('treats the retired lead alias as an ordinary name with no match', () => {
    expect(resolveTarget('lead', roster)).toEqual({ ok: false, error: "no session matching 'lead'" })
  })

  it("resolves coordinator to the caller's own project's agent", () => {
    expect(resolveTarget('coordinator', roster, 't-3')).toEqual({ ok: true, session: roster[1] })
  })

  it('resolves studio-agent by the role alone, since one Studio coordinator runs', () => {
    const studio: SessionRecord = { id: 't-studio', label: 'Studio Coordinator', role: 'studio-agent' }
    expect(resolveTarget('studio-agent', [...roster, studio])).toEqual({ ok: true, session: studio })
    expect(resolveTarget('studio-agent', roster)).toEqual({ ok: false, error: 'the Studio coordinator is not running' })
  })

  it('refuses an ambiguous coordinator without a caller project', () => {
    const result = resolveTarget('coordinator', roster)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('t-coord-a, t-coord-b')
  })

  it('matches an agent name, then a label, case-insensitively, and lists candidates when several match', () => {
    expect(resolveTarget('watto', roster)).toEqual({ ok: true, session: roster[2] })
    expect(resolveTarget('hero', roster)).toEqual({ ok: true, session: roster[2] })
    const result = resolveTarget('nav', roster)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("'nav' matches 2 sessions (t-2, t-3) — use a session id")
  })

  it('falls back to the project folder name, and errors on no match', () => {
    const result = resolveTarget('beta', roster)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('matches 2 sessions')
    const only = [roster[1]!, roster[2]!]
    expect(resolveTarget('alpha', only)).toEqual({ ok: true, session: roster[2] })
    expect(resolveTarget('gamma', only)).toEqual({ ok: false, error: "no session matching 'gamma'" })
  })

  it('resolves coordinator to the only project agent running', () => {
    const one = [roster[0]!, roster[2]!]
    expect(resolveTarget('project-agent', one)).toEqual({ ok: true, session: roster[0] })
  })

  it('says so when no project agent is running at all', () => {
    expect(resolveTarget('coordinator', [roster[2]!])).toEqual({ ok: false, error: 'no project agent is running' })
  })
})

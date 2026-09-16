// The wizard's ordering and skip semantics: deriveStep walks to the first
// unresolved step, advance records one outcome without mutating its input,
// and skipAll closes the flow without touching per-step outcomes.
import { describe, expect, it } from 'vitest'
import { advance, deriveStep, ONBOARDING_STEP_IDS, skipAll, stepBefore } from '../src/client/steps.ts'

describe('onboarding step machine', () => {
  it('orders the six steps agents through finish', () => {
    expect(ONBOARDING_STEP_IDS).toEqual(['agents', 'tools', 'projects-folder', 'documentation-folder', 'skills-folder', 'finish'])
  })

  it('opens on the first step for a fresh or missing seed', () => {
    expect(deriveStep(undefined)).toBe('agents')
    expect(deriveStep({})).toBe('agents')
    expect(deriveStep({ steps: {} })).toBe('agents')
  })

  it('shows nothing once the flow is done', () => {
    expect(deriveStep({ done: true })).toBeNull()
  })

  it('walks to the first unresolved step, done and skipped alike', () => {
    expect(deriveStep({ steps: { agents: 'done' } })).toBe('tools')
    expect(deriveStep({ steps: { agents: 'skipped', tools: 'done' } })).toBe('projects-folder')
  })

  it('treats a fully resolved seed as closed even without done', () => {
    const steps = {
      agents: 'done',
      tools: 'skipped',
      'projects-folder': 'done',
      'documentation-folder': 'skipped',
      'skills-folder': 'skipped',
      finish: 'done',
    } as const
    expect(deriveStep({ steps })).toBeNull()
  })

  it('advance records one outcome and preserves its siblings', () => {
    const seed = advance({ steps: { agents: 'done' } }, 'tools', 'skipped')
    expect(seed.steps).toEqual({ agents: 'done', tools: 'skipped' })
    expect(seed.done).toBeUndefined()
  })

  it('advance does not mutate the input seed', () => {
    const before = { steps: { agents: 'done' as const } }
    advance(before, 'tools', 'done')
    expect(before.steps).toEqual({ agents: 'done' })
  })

  it('skipAll marks the flow done and leaves step outcomes alone', () => {
    expect(skipAll({ steps: { agents: 'skipped' } })).toEqual({ done: true, steps: { agents: 'skipped' } })
    expect(skipAll(undefined)).toEqual({ done: true })
  })

  it('stepBefore hides Back on the first step', () => {
    expect(stepBefore('agents')).toBeNull()
    expect(stepBefore('finish')).toBe('skills-folder')
    expect(stepBefore('skills-folder')).toBe('documentation-folder')
  })
})

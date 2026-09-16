import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it } from 'vitest'
import { ACTIVITIES, ACTIVITY_IDS, deriveComposition, hasActivityPresets, personaOf } from '../src/seed.ts'
import { resolveActivityModels, slugOf } from '../src/index.ts'
import { assessPills } from '../src/availability.ts'

const STANDARD = `
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model.
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
`

describe('deriveComposition', () => {
  it('replaces the persona text and keeps every other row, !!js included', () => {
    const derived = deriveComposition(STANDARD, ACTIVITIES[1]!)
    expect(derived).toContain('design agent')
    expect(derived).not.toContain('coding agent powered')
    expect(derived).toContain("!!js process.platform === 'win32'")
    const rows = load(derived, { schema: entryListSchema }) as { name: string }[]
    expect(rows.map(row => row.name)).toEqual(['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-bash'])
  })

  it('prepends a persona row when the source has none', () => {
    const derived = deriveComposition("- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'\n", ACTIVITIES[0]!)
    const rows = load(derived, { schema: entryListSchema }) as { name: string; config?: { text: string } }[]
    expect(rows[0]!.name).toBe('@deepseek-ai/dsh-persona')
    expect(rows[0]!.config!.text).toContain('coding agent')
    expect(rows[1]!.name).toBe('@deepseek-ai/dsh-tool-fs')
  })

  it('refuses a source that is not a row list', () => {
    expect(() => deriveComposition('name: nope\n', ACTIVITIES[0]!)).toThrow(/top-level list/)
  })
})

describe('the activity roster', () => {
  it('lists the five pills in order', () => {
    expect(ACTIVITY_IDS).toEqual(['coding', 'design', 'writing', 'admin', 'free'])
  })

  it('detects a seeded roster by any one activity id', () => {
    expect(hasActivityPresets(['standard', 'code'])).toBe(false)
    expect(hasActivityPresets(['standard', 'writing'])).toBe(true)
  })
})

describe('resolveActivityModels', () => {
  it('sends Free to the free-tokens route and the rest to the default model', () => {
    const models = resolveActivityModels(
      {},
      { providers: { freetokens: { models: [{ id: 'free-a' }, { id: 'free-b' }] } } },
      { provider: 'openai-codex', model: 'gpt-5.5' },
    )
    expect(models.free).toEqual({ provider: 'freetokens', model: 'free-a' })
    expect(models.coding).toEqual({ provider: 'openai-codex', model: 'gpt-5.5' })
  })

  it('lets config override a pill and reports null when nothing resolves', () => {
    const models = resolveActivityModels({ design: { provider: 'p', model: 'm' } }, undefined, undefined)
    expect(models.design).toEqual({ provider: 'p', model: 'm' })
    expect(models.free).toBeNull()
    expect(models.coding).toBeNull()
  })
})

describe('assessPills', () => {
  const models = {
    coding: { provider: 'deepseek-official', model: 'v4' },
    free: { provider: 'freetokens', model: 'f' },
    design: { provider: 'anthropic', model: 'claude' },
    admin: null,
  }
  const chat = { kind: 'chat' as const }

  const noSubscription = () => false

  it('is ready on a reachable route and refuses a missing model', () => {
    const pills = assessPills(models, {
      reachable: () => true, subscription: noSubscription, surface: chat, terminalAvailable: false, terminalOnlyProviders: [],
    })
    expect(pills.coding).toEqual({ model: models.coding, state: 'ready' })
    expect(pills.admin).toEqual({ model: null, state: 'unavailable', reason: 'no-model' })
  })

  it('points a subscription-only route at the terminal when one exists, else reports no access', () => {
    const facts = {
      reachable: (p: string) => p !== 'anthropic', subscription: noSubscription, surface: chat, terminalOnlyProviders: ['anthropic'],
    }
    expect(assessPills(models, { ...facts, terminalAvailable: true }).design?.reason).toBe('terminal-only')
    expect(assessPills(models, { ...facts, terminalAvailable: false }).design?.reason).toBe('no-access')
  })

  it('names a sign-in, not a key, as what an unreachable subscription route waits on', () => {
    // JJ, 7 Sep 2026: a brain on the ChatGPT route read "No key for openai-codex"
    // with an Add key action, when the route takes a sign-in and no key at all.
    const pills = assessPills(models, {
      reachable: () => false, subscription: p => p === 'deepseek-official', surface: chat, terminalAvailable: false, terminalOnlyProviders: [],
    })
    expect(pills.coding).toEqual({ model: models.coding, state: 'unavailable', reason: 'no-sign-in' })
    expect(pills.design?.reason).toBe('no-access')
  })

  it('asks before moving a terminal agent to another provider', () => {
    const pills = assessPills(models, {
      reachable: () => true,
      subscription: noSubscription,
      surface: { kind: 'terminal', provider: 'anthropic' },
      terminalAvailable: true,
      terminalOnlyProviders: ['anthropic'],
    })
    expect(pills.design?.state).toBe('ready')
    expect(pills.coding).toEqual({ model: models.coding, state: 'confirm', reason: 'terminal-restart' })
    expect(pills.free?.reason).toBe('terminal-restart')
  })
})

describe('personaOf', () => {
  it('reads the persona row text and answers undefined without one', () => {
    expect(personaOf(STANDARD)).toBe('You are a coding agent powered by the {{model}} model.')
    expect(personaOf("- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'\n")).toBeUndefined()
    expect(personaOf('text: not a list\n')).toBeUndefined()
  })
})

describe('slugOf', () => {
  it('derives a hyphenated lowercase preset id from a name', () => {
    expect(slugOf('  Data Science! ')).toBe('data-science')
    expect(slugOf('Chat')).toBe('chat')
    expect(slugOf('***')).toBe('')
  })
})

describe('deriveComposition', () => {
  it("replaces the persona text whatever the row's config held", () => {
    const activity = { persona: 'You paint.' } as never
    const kept = deriveComposition("- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    tone: warm\n", activity)
    expect(kept).toContain('tone: warm')
    expect(kept).toContain('You paint.')
    // A row whose config is no object at all starts from nothing.
    const replaced = deriveComposition("- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config: not-an-object\n", activity)
    expect(replaced).toContain('You paint.')
    expect(replaced).not.toContain('not-an-object')
  })
})

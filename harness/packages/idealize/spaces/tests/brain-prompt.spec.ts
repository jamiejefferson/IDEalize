/**
 * What the logged brain contributes to a prompt: which of the two logged facts
 * decides, and what the prompt registry ends up sending.
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { PERSONA_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { brainPersona, installBrainPrompt } from '../src/brain-prompt.ts'

const CODING = 'You are a coding agent. Say less.'
const DESIGN = 'You are a design agent. Show, do not tell.'

function event(type: SessionEvent['type'], data: unknown, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

function header(agentPreset?: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('brain-prompt-spec'),
    createdAt: 1,
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

describe('brainPersona', () => {
  it('states nothing for a chat that records no brain', () => {
    expect(brainPersona({ header: header('coding'), events: [] })).toBeUndefined()
  })

  it('states nothing while the logged brain is the composition in force', () => {
    // The welcome card's launch and a blank-chat switch both recompose the
    // preset, so the mounted persona row is already this brain's voice.
    expect(brainPersona({
      header: header(),
      events: [
        event('agent-preset/selected', { agentPreset: 'design' }, 0),
        event('idealize/brain', { brain: 'design', instructions: DESIGN }, 1),
      ],
    })).toBeUndefined()
    // The same agreement, read off the creation header rather than a selection.
    expect(brainPersona({
      header: header('coding'),
      events: [event('idealize/brain', { brain: 'coding', instructions: CODING }, 0)],
    })).toBeUndefined()
  })

  it('states the logged instructions once the brain outruns its composition', () => {
    expect(brainPersona({
      header: header('coding'),
      events: [event('idealize/brain', { brain: 'design', instructions: DESIGN }, 0)],
    })).toEqual({ brain: 'design', instructions: DESIGN })
  })

  it('reads the latest record, so a second switch supersedes the first', () => {
    expect(brainPersona({
      header: header('coding'),
      events: [
        event('idealize/brain', { brain: 'design', instructions: DESIGN }, 0),
        event('idealize/brain', { brain: 'writing', instructions: 'Write plainly.' }, 1),
      ],
    })).toEqual({ brain: 'writing', instructions: 'Write plainly.' })
  })

  it('states an empty persona for a differing brain that carries no instructions', () => {
    // The switcher omits the field when the brain's persona is `''`. A brain
    // with no voice must silence the old one, not inherit it.
    expect(brainPersona({
      header: header('coding'),
      events: [event('idealize/brain', { brain: 'bare' }, 0)],
    })).toEqual({ brain: 'bare', instructions: '' })
  })

  it('states the logged instructions when no composition resolves at all', () => {
    expect(brainPersona({
      header: header(),
      events: [event('idealize/brain', { brain: 'design', instructions: DESIGN }, 0)],
    })).toEqual({ brain: 'design', instructions: DESIGN })
  })
})

describe('installBrainPrompt', () => {
  /** One prompt registry carrying `persona` as its deployment persona. */
  async function registry(persona: string): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona, includeHarnessIdentity: false, includeRuntimeContext: false })
    installBrainPrompt(ctx)
    return ctx
  }

  /** Assemble as the agent whose log carries `events` under preset `preset`. */
  async function assemble(ctx: Context, preset: string | undefined, events: SessionEvent[]): Promise<string> {
    const agent = { session: { header: header(preset), events } }
    return renderPrompt(await ctx.systemPrompt.assemble({ agent: agent as never }))
  }

  it('replaces the composition persona with the logged brain instructions', async () => {
    const ctx = await registry(CODING)
    try {
      const prompt = await assemble(ctx, 'coding', [
        event('idealize/brain', { brain: 'design', instructions: DESIGN }, 0),
      ])
      expect(prompt).toBe(DESIGN)
      expect(prompt).not.toContain('coding agent')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('leaves the composition persona alone while the brain agrees with it', async () => {
    const ctx = await registry(CODING)
    try {
      expect(await assemble(ctx, 'coding', [
        event('idealize/brain', { brain: 'coding', instructions: CODING }, 0),
      ])).toBe(CODING)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('contributes nothing at all for a brain carrying no instructions', async () => {
    const ctx = await registry(CODING)
    try {
      // Not an empty section: the persona slot renders to nothing and drops out.
      expect(await assemble(ctx, 'coding', [event('idealize/brain', { brain: 'bare' }, 0)])).toBe('')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('leaves an assembly with no agent untouched', async () => {
    const ctx = await registry(CODING)
    try {
      expect(renderPrompt(await ctx.systemPrompt.assemble({}))).toBe(CODING)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps every other section, replacing only the persona slot', async () => {
    const ctx = await registry(CODING)
    try {
      ctx.systemPrompt.section({ name: 'tool:demo', order: 100, text: 'Use the demo tool.' })
      const assembly = await ctx.systemPrompt.assemble({
        agent: { session: { header: header('coding'), events: [
          event('idealize/brain', { brain: 'design', instructions: DESIGN }, 0),
        ] } } as never,
      })
      expect(assembly.sections.map(section => section.name)).toEqual([PERSONA_SECTION, 'tool:demo'])
      expect(renderPrompt(assembly)).toBe(`${DESIGN}\n\nUse the demo tool.`)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

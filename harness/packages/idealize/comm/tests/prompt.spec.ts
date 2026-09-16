/**
 * The standing `idealize` command guidance: the plugin puts one section in
 * every agent's prompt through the prompt registry, so it survives compaction
 * and reaches chats that never saw the session-start notice.
 */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, vi } from 'vitest'
import { apply, COMMANDS_SECTION } from '../src/index.ts'

describe('the idealize commands section', () => {
  it('reaches the assembled prompt in the tool-guidance band and says how to ask a tagged agent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '', includeHarnessIdentity: false, includeRuntimeContext: false })
    try {
      apply(ctx)
      // The section is registered by an injected child plugin, one tick after apply.
      await vi.waitFor(async () => {
        expect((await ctx.systemPrompt.assemble({})).sections.map(section => section.name)).toContain(COMMANDS_SECTION.name)
      })
      const assembly = await ctx.systemPrompt.assemble({})
      const names = assembly.sections.map(section => section.name)
      // Order 120 places it after the persona (order 0), in the tool-guidance band.
      expect(names.indexOf(COMMANDS_SECTION.name)).toBeGreaterThan(names.indexOf('deployment:persona'))
      expect(COMMANDS_SECTION.order).toBe(120)
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('`idealize send <agent> <text>`')
      expect(prompt).toContain('When the person writes @Name')
      expect(prompt).toContain('say so instead of searching for its work')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

/**
 * The brain's standing instructions as a system-prompt contribution.
 *
 * The space owns the tools; the brain owns the model and the standing
 * instructions. A blank chat gets both by recomposing its agent preset, so its
 * persona arrives the ordinary way — through the preset's own
 * `@deepseek-ai/dsh-persona` row. A STARTED chat cannot be recomposed: its
 * transcript was produced under one tool set, so `agentPresets.select` refuses
 * it. The switch therefore writes the new brain to the log instead, and this
 * contributor is what makes that record reach the model.
 *
 * It replaces the assembled `deployment:persona` section rather than adding a
 * section of its own, because the preset in force still contributes the OLD
 * brain's persona. Two personas in one prompt is not "the brain owns the
 * instructions" — it is both brains at once.
 * @module @idealize/spaces/brain-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: resolves the `agent` field `dsh-agent` merges into the assembly
// context, which is what tells an agent's prompt from a diagnostic read.
import type {} from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset, type PresetBearingSession } from '@deepseek-ai/dsh-agent-presets'
import { foldBrainRecord } from './projection.ts'

/** The persona a chat's logged brain states, once it differs from the composition in force. */
export interface BrainPersona {
  /** The agent preset id of the brain the log records. */
  brain: string
  /** The brain's standing instructions; `''` when it carries none. */
  instructions: string
}

/**
 * The persona text a chat's log states for its current brain, or undefined
 * when the log states nothing this contributor should act on.
 *
 * Two facts decide it, and both live in the log. `idealize/brain` names the
 * brain the chat is running; `agent-preset/selected` (or the creation header)
 * names the composition that is mounted. They agree in every case where the
 * brain was chosen while the chat could still be recomposed — the welcome
 * card's launch, and a switch on a blank chat — and there the composition's own
 * persona row is already this brain's voice, so nothing is contributed and the
 * mounted preset is left to speak for itself.
 *
 * They disagree only after a switch on a STARTED chat, which is exactly the
 * case the preset lock leaves unserved. There the log is the sole statement of
 * the brain's voice, so it wins: `''` empties the persona (the section renders
 * to nothing), and any other text replaces it.
 * @param session - the chat's header and event log.
 * @returns the persona the log states, or undefined to contribute nothing.
 */
export function brainPersona(session: PresetBearingSession): BrainPersona | undefined {
  const record = foldBrainRecord(session.events)
  if (record === undefined || record.brain === resolveSessionPreset(session)) return undefined
  return { brain: record.brain, instructions: record.instructions ?? '' }
}

/**
 * Contribute the logged brain's standing instructions to every agent prompt.
 *
 * Registered as an unscoped `system-prompt/assemble` listener, so it sees every
 * agent's assembly rather than one preset's scope, and post-`next()` so it
 * replaces the persona the scope chain resolved rather than one an earlier
 * listener has yet to touch. The `deployment:persona` slot is always present:
 * the prompt registry registers it unconditionally in its own constructor, and
 * a preset's persona row shadows that name rather than adding another.
 *
 * A preset whose persona is declared `complete` keeps the whole prompt — the
 * registry restores a complete section after this waterfall — so an in-session
 * switch does not change the voice of a chat whose brain claimed the entire
 * prompt. That is the complete-prompt contract, not a gap here.
 * @param ctx - a context carrying the prompt registry.
 */
export function installBrainPrompt(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const persona = brainPersona(agent.session)
    if (persona === undefined) return assembled
    return {
      ...assembled,
      sections: assembled.sections.map(section => section.name === PERSONA_SECTION
        ? { ...section, text: persona.instructions }
        : section),
    }
  })
}

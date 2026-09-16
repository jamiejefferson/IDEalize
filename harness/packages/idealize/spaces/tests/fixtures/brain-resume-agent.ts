/**
 * Loader fixture that resumes one persisted chat by id, so the replay run
 * builds its prompt from the log on disk and nothing else.
 * @module brain-resume-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Fixture plugin name. */
export const name = 'brain-resume-agent'
/** Services that must exist before the fixture resumes its agent. */
export const inject = ['agents', 'agentLoop', 'sessionPersistence']

/**
 * Resume the chat named by `DSH_BRAIN_RESUME_ID` and bind its handle to this
 * fixture's lifetime.
 * @param ctx - settled agent and persistence services from the Loader tree.
 * @returns after the resumed agent is published.
 */
export async function apply(ctx: Context): Promise<void> {
  const id = process.env.DSH_BRAIN_RESUME_ID
  if (id === undefined || id === '') throw new Error('brain-resume-agent: DSH_BRAIN_RESUME_ID is required')
  const handle = await ctx.agents.resume({
    resumeSessionId: id as SessionId,
    agentOptions: { provider: 'brain-replay', model: 'replay-model' },
  })
  ctx.effect(() => () => handle.dispose(), 'brain-resume-agent.handle')
}

/**
 * The space and brain session events and their projections. A chat's space is
 * host-owned and durable — the view ring's `view` field is browser-local and
 * cannot answer "which space is this chat" for the sidebar or a second device.
 * @module @idealize/spaces/projection
 */

import { z, type ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { PresetBearingSession } from '@deepseek-ai/dsh-agent-presets'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { deriveSpace, isSpaceId, SPACE_IDS, type SpaceId } from './space-table.ts'
import type { BrainEventData, BrainProjection, SpaceProjection } from './projection-types.ts'

export type { BrainEventData, BrainProjection, SpaceEventData, SpaceProjection } from './projection-types.ts'

/** What the space unit folds: the recorded space, plus the preset the ladder falls back to. */
interface SpaceState {
  space?: SpaceId
  agentPreset?: string
}

const spaceSchema: ZodType<SpaceProjection> = z.object({ space: z.enum(SPACE_IDS) })
const brainSchema: ZodType<BrainProjection> = z.object({ brain: z.string().optional() })

/**
 * The chat's space, resolved through the legacy ladder so a chat made before
 * spaces existed still projects one. `agent-preset/selected` is folded because
 * it is the ladder's second branch: the media launch records the Gallery or
 * Sound Stage preset that way, which is what a legacy media chat is recognised
 * by. A chat whose creation header alone names a media preset is not covered —
 * the product's only media launch path selects the preset after creation — so
 * host callers that hold a full session read {@link resolveSessionSpace}.
 */
export const spaceProjectionDefinition: ProjectionDefinition<'space', SpaceState> = {
  key: 'space',
  schema: spaceSchema,
  init: () => ({}),
  apply: (state, event: SessionEvent) => {
    if (event.type === 'idealize/space') {
      return state.space === event.data.space ? state : { ...state, space: event.data.space }
    }
    if (event.type === 'agent-preset/selected') {
      return state.agentPreset === event.data.agentPreset ? state : { ...state, agentPreset: event.data.agentPreset }
    }
    return state
  },
  view: state => ({ space: deriveSpace(state) }),
  stateVersion: 1,
}

/** The brain the chat runs, absent until a brain is recorded. */
export const brainProjectionDefinition: ProjectionDefinition<'brain', BrainProjection> = {
  key: 'brain',
  schema: brainSchema,
  init: () => ({}),
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'idealize/brain' || state.brain === event.data.brain) return state
    return { brain: event.data.brain }
  },
  view: state => state,
  stateVersion: 1,
}

/**
 * The space recorded in a session log, before the ladder runs.
 * @param events - the session's event log, oldest first.
 * @returns the latest recorded space, or undefined when the chat has none.
 */
export function foldSpace(events: readonly SessionEvent[]): SpaceId | undefined {
  const event = events.findLast(item => item.type === 'idealize/space')
  return event?.type === 'idealize/space' && isSpaceId(event.data.space) ? event.data.space : undefined
}

/**
 * The brain recorded in a session log.
 * @param events - the session's event log, oldest first.
 * @returns the latest recorded brain's preset id, or undefined when the chat has none.
 */
export function foldBrain(events: readonly SessionEvent[]): string | undefined {
  const event = events.findLast(item => item.type === 'idealize/brain')
  return event?.type === 'idealize/brain' ? event.data.brain : undefined
}

/**
 * The space of one session, reading its recorded space first and its resolved
 * agent preset (creation header or latest selection) second.
 * @param session - the session's header and event log.
 * @returns the space id; Chat when nothing else resolves.
 */
export function resolveSessionSpace(session: PresetBearingSession): SpaceId {
  return deriveSpace({ space: foldSpace(session.events), agentPreset: resolveSessionPreset(session) })
}

/**
 * The whole latest `idealize/brain` record, not just its brain id.
 *
 * The prompt contributor needs the `instructions` field beside the id, which
 * {@link foldBrain} drops: a brain that carries no standing instructions is
 * recorded with `instructions: ''`, and that empty string is a statement
 * ("this brain has no voice") rather than a missing value.
 * @param events - the session's event log, oldest first.
 * @returns the latest recorded brain and its instructions, or undefined when
 * the chat records no brain.
 */
export function foldBrainRecord(events: readonly SessionEvent[]): BrainEventData | undefined {
  const event = events.findLast(item => item.type === 'idealize/brain')
  return event?.type === 'idealize/brain' ? event.data : undefined
}

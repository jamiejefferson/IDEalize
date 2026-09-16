/**
 * The agent-name session event and its projection. The name reaches the
 * model (the chat is told who it is), so it is logged; the projection lets
 * clients show it beside the title without reading the log.
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { AgentNameProjection } from './projection-types.ts'

export type { AgentNameEventData, AgentNameProjection } from './projection-types.ts'

const schema = z.object({ name: z.string().optional() })

/** The `agentName` session projection: the latest `idealize/agent-name` event's name. */
export const agentNameProjectionDefinition: ProjectionDefinition<'agentName', AgentNameProjection> = {
  key: 'agentName',
  schema,
  init: () => ({}),
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'idealize/agent-name') return state
    return { name: event.data.name }
  },
  view: state => state,
  stateVersion: 1,
}

/**
 * The latest name in a session log.
 * @param events - the session's events, oldest first.
 * @returns the last assigned name, or undefined before any assignment.
 */
export function foldAgentName(events: readonly SessionEvent[]): string | undefined {
  const event = events.findLast(item => item.type === 'idealize/agent-name')
  return event?.type === 'idealize/agent-name' ? event.data.name : undefined
}

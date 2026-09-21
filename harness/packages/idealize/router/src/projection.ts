/**
 * The router's session events folded: the projection the composer reads, and
 * the two facts the host needs per turn (is the chat locked, and which switch
 * still holds).
 * @module @idealize/router/projection
 */

import { z, type ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

import type { RouterEventData, RouterProjection } from './projection-types.ts'

export type { RoutedModel, RouterEventData, RouterLockEventData, RouterProjection } from './projection-types.ts'

const modelSchema = z.object({ provider: z.string(), model: z.string(), label: z.string() })
const eventSchema = z.object({
  outcome: z.enum(['switched', 'offer', 'reset']),
  at: z.string(),
  from: modelSchema,
  to: modelSchema,
  reason: z.enum(['needs-payment', 'loses-context']).optional(),
  task: z.enum(['code', 'reasoning', 'math', 'writing', 'summarise', 'translate', 'quick']).optional(),
  rationale: z.string().optional(),
  improvement: z.number().optional(),
})
const routerSchema: ZodType<RouterProjection> = z.object({ locked: z.boolean(), last: eventSchema.optional() })

export const routerProjectionDefinition: ProjectionDefinition<'router', RouterProjection> = {
  key: 'router',
  schema: routerSchema,
  init: () => ({ locked: false }),
  apply: (state, event: SessionEvent) => {
    if (event.type === 'idealize/router-lock') {
      return state.locked === event.data.locked ? state : { ...state, locked: event.data.locked }
    }
    if (event.type !== 'idealize/router') return state
    return { locked: state.locked, ...event.data.outcome === 'reset' ? {} : { last: event.data } }
  },
  view: state => state,
  stateVersion: 1,
}

/**
 * Whether the chat is locked against routing.
 * @param events - the session's event log, oldest first.
 * @returns the latest lock; unlocked when none is recorded.
 */
export function foldLocked(events: readonly SessionEvent[]): boolean {
  const event = events.findLast(item => item.type === 'idealize/router-lock')
  return event?.type === 'idealize/router-lock' ? event.data.locked : false
}

/**
 * The switch that still holds, and when the chat last switched.
 * @param events - the session's event log, oldest first.
 * @returns the latest switch unless a reset follows it, and the time of the latest switch or reset.
 */
export function foldRouted(events: readonly SessionEvent[]): { routed?: RouterEventData; lastSwitchAt?: string } {
  let routed: RouterEventData | undefined
  let lastSwitchAt: string | undefined
  for (const event of events) {
    if (event.type !== 'idealize/router' || event.data.outcome === 'offer') continue
    routed = event.data.outcome === 'switched' ? event.data : undefined
    lastSwitchAt = event.data.at
  }
  return { ...routed === undefined ? {} : { routed }, ...lastSwitchAt === undefined ? {} : { lastSwitchAt } }
}

const same = (a: { provider: string; model: string }, b: { provider: string; model: string }): boolean =>
  a.provider === b.provider && a.model === b.model

/**
 * The model the chat is on before this turn is routed. The host resolves the
 * model the user or the brain chose; a switch the router made earlier holds
 * over it until the user chooses another, which shows as a resolved model that
 * is neither end of that switch.
 * @param resolved - what the request would run on without the router.
 * @param routed - the switch that still holds, from {@link foldRouted}.
 * @returns the chat's current model, and whether the earlier switch was dropped.
 */
export function currentModel<T extends { provider: string; model: string }>(
  resolved: T, routed: RouterEventData | undefined,
): { current: { provider: string; model: string }; dropped: boolean } {
  if (routed === undefined) return { current: resolved, dropped: false }
  if (same(resolved, routed.from) || same(resolved, routed.to)) return { current: routed.to, dropped: false }
  return { current: resolved, dropped: true }
}

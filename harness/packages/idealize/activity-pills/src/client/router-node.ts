/**
 * The model router's line in the transcript: one keyed chat node per
 * `idealize/router` event, so a switch, an offer, or the chat going back to
 * its own model shows where it happened in the conversation (JJ, 30 Sep
 * 2026). The composer chip still carries the actions; this line only says
 * what the router did.
 * @module @idealize/activity-pills/client/router-node
 */

import type {
  ChatConversationViewNode, ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the SessionEventMap merge declaring `idealize/router`.
import type { RouterEventData } from '@idealize/router/client'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** One router decision the chat should see: a switch, an offer, or a return to the chat's own model. */
    'router-note': RouterEventData
  }
}

function locationOf(context: ConversationNodeContext<RouterEventData>): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/** Each router event is its own whole-value Context, keyed by its place in the log. */
export const routerNoteDefinition: ConversationNodeDefinition<RouterEventData> = {
  kind: 'router-note',
  target: 'chat',
  match: event => event.type === 'idealize/router' ? { id: String(event.seq), role: 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'idealize/router') throw new Error('router-note requires an idealize/router event')
    return match.event.data
  },
  update: context => context.state,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'router-note',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}

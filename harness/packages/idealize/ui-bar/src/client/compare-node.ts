/**
 * The comparison after a dislike, as one chat node: every
 * `idealize/router-compare` step of one comparison folds into one card that
 * sits under the reply the person disliked (Paper "Ratings and dislike"
 * board 03). The first reply stays where it is in the chat.
 * @module @idealize/ui-bar/client/compare-node
 */

import type {
  ChatConversationViewNode, ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the SessionEventMap merge declaring `idealize/router-compare`.
import type { RouterCompareEventData } from '@idealize/router/client'

/** One comparison as the card reads it. */
export interface CompareNodeData {
  started: RouterCompareEventData
  answers: Array<RouterCompareEventData | undefined>
  /** The alternative kept, -1 for the first answer, undefined while the person decides. */
  picked?: number | undefined
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Two other models' answers to the ask the person disliked a reply to. */
    'router-compare': CompareNodeData
  }
}

export const COMPARE_KIND = 'router-compare'

function locationOf(context: ConversationNodeContext<CompareNodeData>): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/**
 * Fold one step into the card.
 * @param state - the card so far.
 * @param step - the step.
 * @returns the card after it.
 */
export function foldStep(state: CompareNodeData, step: RouterCompareEventData): CompareNodeData {
  if (step.phase === 'answer' && step.index !== undefined) {
    const answers = [...state.answers]
    answers[step.index] = step
    return { ...state, answers }
  }
  if (step.phase === 'picked') return { ...state, picked: step.index }
  return state
}

/** One Context per comparison, keyed by its id. */
export const compareDefinition: ConversationNodeDefinition<CompareNodeData> = {
  kind: COMPARE_KIND,
  target: 'chat',
  match: event => event.type === 'idealize/router-compare'
    ? { id: event.data.id, role: event.data.phase === 'started' ? 'start' : 'update' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'idealize/router-compare') throw new Error('router-compare requires an idealize/router-compare event')
    return { started: match.event.data, answers: (match.event.data.alternatives ?? []).map(() => undefined) }
  },
  update: (context, match) => match.event.type === 'idealize/router-compare' ? foldStep(context.state, match.event.data) : context.state,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: COMPARE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}

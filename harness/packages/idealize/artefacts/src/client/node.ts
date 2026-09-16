/**
 * The artefact conversation-node Definition and its Chat payload: one keyed
 * transcript node per `artefact/created` / `artefact/failed` event
 * (cookbook: docs/cookbook/adding-a-conversation-node.md). Each event is a
 * whole-value single-event Context — the artefact id is the stable business
 * id, and a failed generation keys separately so a later success never
 * collides with it.
 */

import type {
  ChatConversationViewNode, ConversationLocation, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
// The SessionEventMap merge declaring the two artefact events.
import type {} from '../types.ts'

/** Chat payload of one artefact node. */
export interface ArtefactChatData {
  readonly status: 'created' | 'failed'
  readonly id: string
  readonly mediaType: string
  /** Byte size of the stored artefact; absent on failure. */
  readonly bytes?: number
  /** Project-relative storage path; absent on failure. */
  readonly relPath?: string
  /** The provider-reported cause; present only on failure. */
  readonly error?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** One generated artefact (or its failure) rendered inline in the transcript. */
    artefact: ArtefactChatData
  }
}

function locationOf(context: ConversationNodeContext<ArtefactChatData>): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/** The artefact Definition: single-event Contexts, no updates, one Chat node each. */
export const artefactDefinition: ConversationNodeDefinition<ArtefactChatData> = {
  kind: 'artefact',
  target: 'chat',
  match: (event) => {
    if (event.type === 'artefact/created') {
      return { id: String(event.data.record.id), role: 'start' }
    }
    if (event.type === 'artefact/failed') {
      // A failed generation never produced the record its id reserved; the
      // prefix keeps it from ever colliding with a created Context.
      return { id: `failed:${String(event.data.artefactId)}`, role: 'start' }
    }
    return null
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type === 'artefact/created') {
      const record = event.data.record
      return {
        status: 'created',
        id: String(record.id),
        mediaType: record.mediaType,
        bytes: record.storage.bytes,
        relPath: record.storage.relPath,
      }
    }
    if (event.type === 'artefact/failed') {
      return {
        status: 'failed',
        id: String(event.data.artefactId),
        mediaType: event.data.mediaType,
        error: event.data.error,
      }
    }
    throw new Error('artefact node requires an artefact/created or artefact/failed event')
  },
  update: context => context.state,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'artefact',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}

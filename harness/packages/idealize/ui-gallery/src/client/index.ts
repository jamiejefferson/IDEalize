/**
 * The media grid, browser half. Registers four things and owns no state:
 *
 * - three Definitions and one `gallery` view target: one row per generation
 *   task folded from the generation tools' `tool/call`, the artefact store's
 *   `artefact/created` / `artefact/failed`, and a failing `tool/result`; one
 *   row per turn of the chat (thinking, generating, or ended with nothing
 *   made) folded from `turn/start`, `assistant/message` and `turn/end`; and
 *   one prompt per user message, joined to its turn in the target's builder;
 * - the `gallery` (Images) entry in the conversation view ring at order 6,
 *   rendering that chat's `image` rows as a grid of artefact tiles, with
 *   Keep / Archive posting to `@idealize/artefacts`' disposition route;
 * - the `motion` (Video) entry at order 8, the same grid over the same rows
 *   filtered to `video`;
 * - the generation settings strip on the composer card's tool row
 *   (`conversation.input.left`, beside the plus and the mode chips — JJ, 2 Sep
 *   2026: "aspect and no. of images should be in the ask bar"; 7 Sep 2026: a
 *   video model's duration "should be a setting that's visible in the ask
 *   bar along with anything else needed for the model to run"), shown while
 *   this chat's ring sits on Images, Video or the Sound Stage, with one select
 *   per field the space's model publishes on `GET /idealize/generate/inputs`.
 *
 * Everything it displays already exists in the session log (the store logs
 * every verdict), so the mode adds no session event and needs no host half.
 * @module @idealize/ui-gallery/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ui-conversation SlotMap merge (the view ring + input seats).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { registerGalleryConversation } from './definition.ts'
import { GenerationSettings } from './GenerationSettings.tsx'
import { GalleryView, retryMessage } from './GalleryView.tsx'
import type { GalleryViewInjected } from './GalleryView.tsx'
import { en, NS, zh } from './locales.ts'

export type * from './contract.ts'
// The kind filter is a value: every space's view reads its own kind out of
// the one per-chat snapshot this package's Definition publishes.
export { pendingTurns, rowsOfKind } from './contract.ts'
export {
  EMPTY_GALLERY_SNAPSHOT, galleryDefinition, galleryPromptDefinition, galleryTurnDefinition, galleryViewDefinition,
  GENERATION_TOOLS, joinPrompts, readToolArguments, registerGalleryConversation,
} from './definition.ts'
export { GalleryView, formatBytes, rawUrl, retryMessage } from './GalleryView.tsx'
export type { GalleryViewInjected, GalleryViewProps } from './GalleryView.tsx'
export {
  FALLBACK_FIELDS, fieldLabel, GALLERY_VIEW, GENERATION_VIEWS, GenerationSettings, INPUTS_ROUTE, isGenerationView,
  loadInputs,
} from './GenerationSettings.tsx'
export type { GenerationSettingsProps, GenerationView } from './GenerationSettings.tsx'
export {
  applySettingsTag, DEFAULT_SELECTION, formatSettingsTag, GALLERY_COUNTS, partName, readSettingsTag, valueOf,
} from './settings-tag.ts'
export type { GalleryKey } from './locales.ts'

/** Required services: the slot registry, the conversation registries, copy, and session rows. */
export const inject = ['slots', 'conversationEvents', 'conversationViews', 'locale', 'sessions']

/** The view ring's chat entry id; the settings strip shares its store to read the active view. */
const CHAT_VIEW = 'chat'

/** `@idealize/artefacts`' Keep / Archive route (restated: the client bundle purity gate forbids the value import). */
const DISPOSITION_ROUTE = '/idealize/artefacts/disposition'

/** Type-erased slot registry face used where the typed overloads cannot see a foreign store. */
export interface ErasedSlots {
  entries(key: string): readonly { options: { id?: string }; store?: unknown }[]
  subscribe(key: string, fn: () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, fn: () => () => void): void
}

/** The chat view entry (its `store` is ui-conversation's shared per-session chat store handle), once registered. */
function chatEntry(slots: ErasedSlots): { options: { id?: string }; store?: unknown } | undefined {
  return slots.entries('conversation.view').find(entry => entry.options.id === CHAT_VIEW)
}

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-gallery: dictionaries')
  const t = ctx.locale.bind(NS)
  const slots = ctx.slots as unknown as ErasedSlots
  const sessions = ctx.sessions

  registerGalleryConversation(ctx)

  /** Retry and the keep/archive verdict; the same pair for every kind's grid. */
  const galleryVerbs = (sessionId: SessionId): GalleryViewInjected => ({
    retry: async (row) => {
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) return `session ${String(sessionId)} is unavailable`
      const result = await session.prompt([{ type: 'text', text: retryMessage(row) }], 'queue')
      return result.ok ? null : result.error.message
    },
    setDisposition: async (artefactId, disposition) => {
      try {
        const response = await fetch(DISPOSITION_ROUTE, {
          method: 'POST',
          headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
          body: JSON.stringify({ id: artefactId, disposition }),
        })
        if (response.ok) return null
        const body = await response.json().catch(() => ({})) as { error?: string }
        return body.error ?? `disposition ${String(response.status)}`
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
  })

  // Literal `name`/`id` on both register calls: the generated client slot
  // catalog reads occupancy off these call sites, so a seat filled through a
  // helper or a const id would be missing from the surface the model reads.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'gallery',
    order: 6,
    locale: NS,
    label: () => t('view.gallery'),
    inject: (sessionId: SessionId): GalleryViewInjected & { kind: 'image' } => ({
      ...galleryVerbs(sessionId),
      kind: 'image',
    }),
  }, GalleryView))

  // Video is the same grid over the same per-chat source, showing what this
  // chat generated as video (JJ, 4 Sep 2026: the galleries for sound, image
  // and video are all chat-specific). Until now the `motion` space had no view
  // package at all, so a chat there could generate and never see the result.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'motion',
    order: 8,
    locale: NS,
    label: () => t('view.motion'),
    inject: (sessionId: SessionId): GalleryViewInjected & { kind: 'video' } => ({
      ...galleryVerbs(sessionId),
      kind: 'video',
    }),
  }, GalleryView))

  // The strip sits on the composer card's tool row and reads the ring's
  // active view out of the chat entry's store, so it shows only on the media
  // spaces. The chat entry registers when ui-conversation declares the ring;
  // wait for it when this plugin applies first.
  slots.inject('conversation.input.left', () => {
    let dispose: (() => void) | undefined
    let unsubscribe: (() => void) | undefined
    const tryRegister = (): void => {
      const store = chatEntry(slots)?.store
      if (store === undefined || dispose !== undefined) return
      unsubscribe?.()
      unsubscribe = undefined
      dispose = slots.register({
        name: 'conversation.input.left',
        id: 'idealize-gallery-settings',
        order: 30,
        locale: NS,
        store,
      }, GenerationSettings)
    }
    tryRegister()
    if (dispose === undefined) unsubscribe = slots.subscribe('conversation.view', tryRegister)
    return () => {
      unsubscribe?.()
      dispose?.()
      dispose = undefined
    }
  })
}

/**
 * Sound Stage, browser half. Adds a `soundstage` entry to the conversation
 * view ring: this chat's generated sounds as a list with a player per row,
 * over the generations still running and the ones that failed.
 *
 * The rows are `@idealize/ui-gallery`'s per-chat generation rows filtered to
 * `audio`, so the three media spaces read one source and each shows its own
 * kind. The composer's length control is `@idealize/ui-gallery`'s generation
 * settings strip, which renders on the `soundstage` view id; this package
 * registers no composer seat of its own.
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ui-conversation SlotMap merge (the view ring + input seats).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SoundstageEntry } from './SoundstageEntry.tsx'
import { en, NS, type SoundstageKey, zh } from './locales.ts'

export { SoundstageView, formatBytes, formatWhen, rawUrl } from './SoundstageView.tsx'
export type { SoundstageViewProps } from './SoundstageView.tsx'
export { SoundstageEntry } from './SoundstageEntry.tsx'
export type { SoundstageEntryProps } from './SoundstageEntry.tsx'
export type { Shown } from './SoundstageView.tsx'
export type { SoundstageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Sound Stage's copy. */
    'idealize-soundstage': SoundstageKey
  }
}

/** The view id of the ring entry; `@idealize/ui-gallery`'s settings strip renders its length control on this id. */
export const SOUNDSTAGE_VIEW = 'soundstage'

/** Ring position: after the Gallery's 6, so the two media views sit together after Terminal. */
const VIEW_ORDER = 7

/** Required services: the slot registry and copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-soundstage: dictionaries')
  const t = ctx.locale.bind(NS)

  // The id is spelled out rather than referenced so the generated client slot
  // catalog can read it statically; SOUNDSTAGE_VIEW is the same value, and the
  // view-id spec pins the two together.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'soundstage',
    order: VIEW_ORDER,
    locale: NS,
    label: () => t('view.soundstage'),
    inject: (_sessionId: SessionId) => ({
      setDisposition: async (artefactId: string, disposition: 'kept' | 'archived'): Promise<string | null> => {
        try {
          const response = await fetch('/idealize/artefacts/disposition', {
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
    }),
  }, SoundstageEntry))
}

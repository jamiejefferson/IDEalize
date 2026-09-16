/**
 * @idealize/artefacts, browser half: registers the artefact conversation-node
 * Definition and the keyed Chat renderer, so `artefact/created` and
 * `artefact/failed` events render inline in the transcript (image thumbnail,
 * audio element, or a generic card by media type), and the General Settings
 * row for where generated media saves (the `idealize-artefacts` section).
 * `reveal.ts` is the document event a gallery raises to have the Files pane
 * show an artefact's file; galleries and the rail inline that one module.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ui-conversation SlotMap and ChatNodeDataMap merges.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the ctx.settingsScope Context merge and the settings slots.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ARTEFACT_FOLDER_DEFAULTS, ARTEFACT_SETTINGS_NAMESPACE, type ArtefactFolderSettings } from '../settings.ts'
import { artefactDefinition } from './node.ts'
import { ArtefactNodeView } from './ArtefactNode.tsx'
import { FoldersRow, type FoldersRowInjected } from './FoldersRow.tsx'
import { en, zh, type ArtefactsKey } from './locales.ts'

export { artefactDefinition } from './node.ts'
export type { ArtefactChatData } from './node.ts'
export { ArtefactNodeView } from './ArtefactNode.tsx'
export { FOLDER_FIELDS, FoldersRow } from './FoldersRow.tsx'
export type { FolderField, FoldersRowInjected, FoldersRowProps } from './FoldersRow.tsx'
export type { ArtefactsKey } from './locales.ts'
export { ARTEFACT_LANDED_EVENT, announceArtefact, onArtefactLanded, onRevealRequest, requestReveal, REVEAL_ARTEFACT_EVENT } from './reveal.ts'
export type { RevealArtefactDetail } from './reveal.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The media-folders row's copy. */
    'idealize-artefacts': ArtefactsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'idealize-artefacts'

/** Required client services: the node assembler, the slot registry, copy, and the settings transport. */
export const inject = ['conversationEvents', 'slots', 'locale', 'settingsScope']

/**
 * Client plugin body: one Definition, one keyed renderer, one settings row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-artefacts: dictionaries')
  ctx.conversationEvents.register(artefactDefinition)
  // The chat-node seat's props carry the conversation locale binding; this
  // renderer reads none of it, but the registration names the namespace so
  // the composed props satisfy the seat's contract.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'artefact',
    locale: 'conversation',
  }, ArtefactNodeView))

  // ── Where generated media saves ────────────────────────────────────────
  const scope = ctx.settingsScope.bind<ArtefactFolderSettings>({ namespace: ARTEFACT_SETTINGS_NAMESPACE })
  const folders = createSnapshotStore<ArtefactFolderSettings>(ARTEFACT_FOLDER_DEFAULTS)
  const adopt = (): void => {
    const next = { ...ARTEFACT_FOLDER_DEFAULTS, ...scope.getSnapshot().value }
    const now = folders.getSnapshot()
    if ((Object.keys(next) as (keyof ArtefactFolderSettings)[]).some(key => next[key] !== now[key])) folders.set(next)
  }
  scope.subscribe(adopt)
  adopt()
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'idealize-artefact-folders',
    order: 50,
    locale: NS,
    inject: (): FoldersRowInjected => ({
      hooks: { folders },
      setFolder: (field, value) => {
        folders.set({ ...folders.getSnapshot(), [field]: value })
        void scope.set(field, value)
      },
    }),
  }, FoldersRow))
}

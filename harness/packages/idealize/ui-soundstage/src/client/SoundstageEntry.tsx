/**
 * The Sound Stage view-ring entry: reads this chat's generation rows out of
 * the conversation snapshot and renders the audio ones.
 *
 * The rows come from the same per-chat source the Images and Video grids read
 * (`@idealize/ui-gallery`'s Definition publishes every generation the chat
 * ran, whatever it made), so a sound appears the moment its artefact event
 * lands and no listing has to be re-read. Before 4 Sep 2026 this view listed
 * the whole project's sounds over a host route, which showed a chat work it
 * had not done; JJ settled it as chat-specific along with the other two.
 */

import { useMemo } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ui-conversation SlotMap merge (the view ring seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Types only. A value import would make this bundle resolve through
// ui-gallery's built lib, coupling the two builds for a one-line filter.
import type { GalleryRow, GallerySnapshot, GalleryTurn } from '@idealize/ui-gallery/client'
import { SoundstageView } from './SoundstageView.tsx'
import type { Translate } from './locales.ts'

/** What the ring entry needs: the snapshot hook, the composer, the verdict, and copy. */
export interface SoundstageEntryProps {
  sessionId: string
  useSession: <S>(selector: (snapshot: ConversationSnapshot) => S, eq?: (a: S, b: S) => boolean) => S
  /** The composer's public action face; Retry writes and sends through it. */
  inputActions: { setDraft: (text: string) => void; submit: () => void }
  /** Keep or archive one sound through the artefact store's route. */
  setDisposition: (artefactId: string, disposition: 'kept' | 'archived') => Promise<string | null>
  t: Translate
}

/**
 * Render one session's Sound Stage.
 * @param props - the snapshot hook, the composer actions, the verdict, and copy.
 * @returns the stage list.
 */
export function SoundstageEntry({ useSession, inputActions, setDisposition, t }: SoundstageEntryProps) {
  // Selected as JSON so the hook's default identity comparison settles: every
  // selector run rebuilds the array, and only its content decides a re-render.
  const rowsJson = useSession((snapshot) => {
    const gallery: GallerySnapshot | undefined = snapshot.views.get('gallery')
    return JSON.stringify((gallery?.rows ?? []).filter(row => row.artefactKind === 'audio'))
  })
  const rows = useMemo(() => JSON.parse(rowsJson) as readonly GalleryRow[], [rowsJson])
  // The chat's turns, so a posted message shows as work in progress rather
  // than as nothing (JJ, 8 Sep 2026); the view picks the phases it tells.
  const turnsJson = useSession((snapshot) => {
    const gallery: GallerySnapshot | undefined = snapshot.views.get('gallery')
    return JSON.stringify(gallery?.turns ?? [])
  })
  const turns = useMemo(() => JSON.parse(turnsJson) as readonly GalleryTurn[], [turnsJson])

  const onRetry = (prompt: string): void => {
    inputActions.setDraft(prompt)
    inputActions.submit()
  }

  return <SoundstageView rows={rows} turns={turns} t={t} onRetry={onRetry} setDisposition={setDisposition} />
}

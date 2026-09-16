/**
 * Browser entry of the Sound Stage proof page (bundled by
 * `soundstage-proof.mts`, never shipped). It mounts the REAL
 * {@link SoundstageEntry} over the REAL session log of the booted
 * composition: the page fetches one session's events from the proof host and
 * folds them through `@idealize/ui-gallery`'s shipped Definition — the same
 * per-chat row source the app gives this view — so every row, prompt, cause
 * and byte comes from a generation that actually ran.
 *
 * Only the assembler's bookkeeping is restated here; the client runtime's
 * ConversationAssembler needs a live connection this keyless page has no
 * reason to boot. The Definition, the view builder and the component are the
 * shipped ones.
 *
 * Query: `?session=<id>&theme=light|dark`.
 */

import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { galleryDefinition, galleryViewDefinition } from '@idealize/ui-gallery/src/client/definition.ts'
import type { GalleryRow, GallerySnapshot } from '@idealize/ui-gallery/src/client/contract.ts'
import { SoundstageEntry } from '../src/client/SoundstageEntry.tsx'
import { en } from '../src/client/locales.ts'
import type { SoundstageKey } from '../src/client/locales.ts'

const params = new URLSearchParams(window.location.search)
const sessionId = params.get('session') ?? ''
if (params.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')

const t = (key: SoundstageKey, values?: Record<string, unknown>): string =>
  en[key].replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const value = values?.[name]
    return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  })

/** Per-generation bookkeeping, exactly what the assembler keeps per Context. */
interface Fold {
  key: string
  id: string
  matches: unknown[]
  state: GalleryRow | undefined
}

/**
 * Replay one session's events through the shipped Definition and view builder.
 * @param events - the session log as the host serves it.
 * @returns the snapshot the three media views read.
 */
function foldSnapshot(events: readonly SessionEvent[]): GallerySnapshot {
  const folds = new Map<string, Fold>()
  for (const event of events) {
    const matched = galleryDefinition.match(event)
    if (matched === null) continue
    const key = `${galleryDefinition.kind}:${matched.id}`
    let fold = folds.get(key)
    if (fold === undefined) {
      fold = { key, id: matched.id, matches: [], state: undefined }
      folds.set(key, fold)
    }
    const match = { event, role: matched.role, location: { kind: 'unresolved' } }
    fold.matches.push(match)
    const base = {
      key, id: fold.id, kind: galleryDefinition.kind,
      matches: fold.matches, start: fold.matches[0], state: fold.state, current: new Map(),
    }
    if (matched.role === 'start') {
      fold.state = galleryDefinition.start(base as never, match as never, { previous: () => undefined } as never)
    } else if (fold.state !== undefined) {
      fold.state = galleryDefinition.update({ ...base, state: fold.state } as never, match as never)
    }
  }
  const nodes = [...folds.values()].flatMap((fold) => {
    const node = galleryDefinition.buildViewNode({
      key: fold.key, id: fold.id, kind: galleryDefinition.kind, state: fold.state,
    } as never)
    return node === null ? [] : [node]
  })
  return galleryViewDefinition.create().replace({ nodes: nodes as never })
}

/** Fetch one session's log from the proof host. */
async function loadEvents(): Promise<SessionEvent[]> {
  const response = await fetch(`/proof/events?session=${encodeURIComponent(sessionId)}`)
  if (!response.ok) throw new Error(`the proof host refused the session log: ${String(response.status)}`)
  return await response.json() as SessionEvent[]
}

function Page({ initial }: { initial: GallerySnapshot }) {
  const [snapshot, setSnapshot] = useState(initial)
  const useSession = useCallback(
    <T,>(selector: (state: ConversationSnapshot) => T): T =>
      selector({ views: new Map([['gallery', snapshot]]) } as unknown as ConversationSnapshot),
    [snapshot],
  )
  // Keep / Archive posts to the REAL disposition route; the page then re-folds
  // the log, which now carries the `artefact/disposition` event the store appended.
  const setDisposition = useCallback(async (artefactId: string, disposition: 'kept' | 'archived'): Promise<string | null> => {
    const response = await fetch('/idealize/artefacts/disposition', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ id: artefactId, disposition }),
    })
    if (!response.ok) return `disposition ${String(response.status)}`
    setSnapshot(foldSnapshot(await loadEvents()))
    return null
  }, [])
  return (
    <SoundstageEntry
      sessionId="proof-session"
      useSession={useSession}
      inputActions={{ setDraft: () => {}, submit: () => {} }}
      setDisposition={setDisposition}
      t={t}
    />
  )
}

const host = document.getElementById('stage')
if (host === null) throw new Error('the proof page has no mount point')
createRoot(host).render(<Page initial={foldSnapshot(await loadEvents())} />)

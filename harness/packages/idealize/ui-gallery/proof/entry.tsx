/**
 * Browser entry of the Gallery proof page (bundled by `gallery-proof.mts`,
 * never shipped). It mounts the REAL {@link GalleryView} and the REAL
 * {@link GenerationSettings} over the REAL session log of the booted composition:
 * the page fetches one session's events from the proof host and folds them
 * through the shipped `galleryDefinition` and `galleryViewDefinition`, so every
 * row, caption, cause, and byte comes from a generation that actually ran.
 *
 * Only the assembler's bookkeeping is restated here — the client runtime's
 * ConversationAssembler needs a live connection this keyless page has no
 * reason to boot. The Definition, the view builder, and both components are
 * the shipped ones.
 *
 * Query: `?session=<id>&theme=light|dark&kind=image|video`. The `kind` picks
 * which ring entry is under proof: `image` is the Images grid, `video` is the
 * Video grid, and both are the same shipped component over the same per-chat
 * rows.
 */

import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { galleryDefinition, galleryViewDefinition } from '../src/client/definition.ts'
import { GalleryView } from '../src/client/GalleryView.tsx'
import { GenerationSettings } from '../src/client/GenerationSettings.tsx'
import { en } from '../src/client/locales.ts'
import type { GalleryKey } from '../src/client/locales.ts'
import type { GalleryArtefactKind, GalleryRow, GallerySnapshot } from '../src/client/contract.ts'

const params = new URLSearchParams(window.location.search)
const sessionId = params.get('session') ?? ''
const kind: GalleryArtefactKind = params.get('kind') === 'video' ? 'video' : 'image'
if (params.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')

const t = (key: GalleryKey, values?: Record<string, unknown>): string =>
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
 * @returns the snapshot the Gallery grid reads.
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
      // The assembler skips an update whose Context never started, so a
      // failing tool/result for a non-generation call publishes nothing.
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
  const [draft, setDraft] = useState('')
  const useSession = useCallback(
    <T,>(selector: (state: { views: Map<string, GallerySnapshot> }) => T): T =>
      selector({ views: new Map([['gallery', snapshot]]) }),
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
    <div className="page">
      <div className="body">
        <GalleryView
          {...{ useSession } as never}
          kind={kind}
          retry={() => Promise.resolve(null)}
          setDisposition={setDisposition}
          t={t}
        />
      </div>
      {/* The composer's own row, where the app docks this entry. The view id
          is the one this kind's ring entry carries, so the Video capture shows
          what a Video chat's composer actually offers. */}
      <div className="dock" data-proof-dock="">
        <GenerationSettings
          useStore={selector => selector({ view: kind === 'video' ? 'motion' : 'gallery' })}
          useInput={selector => selector({ draft })}
          inputActions={{ setDraft }}
          t={t}
        />
        <div className="draft" data-proof-draft="">{draft === '' ? ' ' : draft}</div>
      </div>
    </div>
  )
}

const host = document.getElementById('stage')
if (host === null) throw new Error('the proof page has no mount point')
createRoot(host).render(<Page initial={foldSnapshot(await loadEvents())} />)

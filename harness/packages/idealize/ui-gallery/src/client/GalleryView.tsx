/**
 * The Gallery view: one image-only tile per artefact, newest first, at 320px
 * or wider (JJ, 2 Sep 2026: the image is the point; the copy waits for the
 * enlarged view; 8 Sep 2026: "use bigger images and hide ui elements on assets
 * until hover"). A resting tile shows nothing but its media; Reveal, Keep and
 * Archive appear in its corner on hover or focus. Clicking a tile opens it
 * full size with its prompt, type, size and project path beside the same
 * three verbs. A video tile is a muted, silent preview behind a play glyph;
 * the enlarged view carries the native player. Archived tiles leave the grid
 * for an "Archived (n)" fold under it.
 *
 * Between the person's message and the tile, the grid reads like a chat: a
 * turn still thinking shows the prompt and "Thinking…", a dispatched
 * generation shows it and "Generating…", and a turn that ended without a
 * generation shows the model's reply in place of a tile (JJ, 8 Sep 2026:
 * posting a message "looks like it's not working"). A failed task shows the
 * provider's own cause and a Retry that resubmits the same prompt and settings
 * as a new message (MOD-05). An empty grid explains what fills it.
 * @module @idealize/ui-gallery/client/GalleryView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// The Reveal signal, one stateless module inlined into this bundle: the
// `/client` entry is the loader bundle and cannot be imported for a value.
import { requestReveal } from '@idealize/artefacts/src/client/reveal.ts'
import { EMPTY_GALLERY_SNAPSHOT } from './definition.ts'
// Type-only: the LocaleNamespaceMap merge this view's locale seat resolves through.
import type {} from './locales.ts'
import { pendingTurns, rowsOfKind } from './contract.ts'
import type { GalleryArtefact, GalleryArtefactKind, GalleryRow, GalleryTurn } from './contract.ts'
import css from './GalleryView.module.css'

/** Registration-side face: the verbs that leave the view. */
export interface GalleryViewInjected {
  /**
   * Resubmit one generation task as a new user message on this chat.
   * @param row - the task to run again, with its original prompt and settings.
   * @returns null once the host accepted the message; a failure line otherwise.
   */
  retry: (row: GalleryRow) => Promise<string | null>
  /**
   * Keep or archive one artefact through the artefact store's route; the
   * store moves the file and logs the verdict, which is what moves the tile.
   * @param artefactId - the artefact.
   * @param disposition - the verdict.
   * @returns null once the store recorded it; a failure line otherwise.
   */
  setDisposition: (artefactId: string, disposition: 'kept' | 'archived') => Promise<string | null>
}

/**
 * Which artefact kind this grid shows. The Images space and the Video space
 * are the same grid over the same per-chat source, differing only in what they
 * show and what their empty state says.
 */
export interface GalleryViewKind {
  kind?: GalleryArtefactKind
}

/** Full Gallery view props: the view-slot runtime share, the verbs, and the locale seat. */
export type GalleryViewProps = ConvViewProps & InjectFace<GalleryViewInjected & GalleryViewKind> & PropsLocale<'idealize-gallery'>

/** The raw-route URL for one artefact id (same origin as the serving host). */
export function rawUrl(id: string): string {
  return `/idealize/artefacts/raw?id=${encodeURIComponent(id)}`
}

/** `123456` bytes as a short human figure. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The plain-language message the retry sends: the same request, stated the way
 * a person would. No provider or model id appears — the media preset's routing
 * chooses the model, and naming one here would pin the UI to a catalogue it
 * does not own.
 * @param row - the task being run again.
 * @returns the message text.
 */
export function retryMessage(row: GalleryRow): string {
  const parts = [`Generate ${row.artefactKind === 'audio' ? 'audio' : `a ${row.artefactKind}`}: ${row.prompt}`]
  if (row.settings.aspect !== undefined) parts.push(`aspect ${row.settings.aspect}`)
  if (row.settings.durationSeconds !== undefined) parts.push(`${String(row.settings.durationSeconds)} seconds long`)
  return parts.join(', ')
}

/** One artefact with the row it came from: what a tile and the enlarged view share. */
interface Shown {
  row: GalleryRow
  artefact: GalleryArtefact
}

/** The play glyph over a video tile's preview. */
function PlayGlyph() {
  return (
    <span className={css.playGlyph} aria-hidden="true" data-gallery-play="">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <path d="M7 4.5v13l10-6.5z" fill="currentColor" />
      </svg>
    </span>
  )
}

/**
 * One artefact's media. On the tile a video is a silent preview with no
 * controls: the tile is one button that opens the enlarged view, and a native
 * player inside it would take the click for itself (JJ, 8 Sep 2026: "the
 * expanded view on video is not working"). The enlarged view carries the
 * player, with autoplay.
 */
function ArtefactMedia({ artefact, alt, large = false }: { artefact: GalleryArtefact; alt: string; large?: boolean }) {
  const source = rawUrl(artefact.id)
  if (artefact.mediaType.startsWith('image/')) {
    return <img className={large ? css.largeImage : css.image} src={source} alt={alt} data-gallery-image={artefact.id} />
  }
  if (artefact.mediaType.startsWith('video/')) {
    if (large) {
      return <video className={css.largeVideo} src={source} controls autoPlay playsInline aria-label={alt} data-gallery-video={artefact.id} data-gallery-player="" />
    }
    return (
      <>
        <video className={css.video} src={source} muted playsInline preload="metadata" aria-hidden="true" data-gallery-video={artefact.id} />
        <PlayGlyph />
      </>
    )
  }
  if (artefact.mediaType.startsWith('audio/')) {
    return <audio className={css.audio} src={source} controls data-gallery-audio={artefact.id} />
  }
  return <span data-gallery-file={artefact.id}>{artefact.mediaType}</span>
}

/** The verdict control: Archive on a kept artefact, Keep on an archived one; busy while the store answers. */
function VerdictButton({ artefact, setDisposition, t, className }: {
  artefact: GalleryArtefact
  setDisposition: GalleryViewInjected['setDisposition']
  t: GalleryViewProps['t']
  className: string | undefined
}) {
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const next = artefact.archived ? 'kept' : 'archived'
  const onClick = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    setBusy(true)
    void setDisposition(artefact.id, next).then(() => { if (alive.current) setBusy(false) }, () => { if (alive.current) setBusy(false) })
  }, [artefact.id, next, setDisposition])
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={busy}
      data-gallery-verdict={next}
      aria-label={next === 'archived' ? t('gallery.archive') : t('gallery.keep')}
    >
      {next === 'archived' ? t('gallery.archive') : t('gallery.keep')}
    </button>
  )
}

/** Reveal: ask the Files pane to show this artefact's file, by the project-relative path its record carries. */
function RevealButton({ artefact, t, className }: {
  artefact: GalleryArtefact
  t: GalleryViewProps['t']
  className: string | undefined
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={(event) => { event.stopPropagation(); requestReveal(artefact.relPath) }}
      data-gallery-reveal={artefact.id}
      aria-label={t('gallery.reveal')}
    >
      {t('gallery.reveal')}
    </button>
  )
}

/** One finished artefact's tile: the media alone at rest; Reveal and the verdict on hover or focus; the prompt as the accessible name. */
function DoneTile({ shown, open, setDisposition, t }: {
  shown: Shown
  open: (shown: Shown) => void
  setDisposition: GalleryViewInjected['setDisposition']
  t: GalleryViewProps['t']
}) {
  const { row, artefact } = shown
  return (
    <figure className={css.tile} data-gallery-tile="done" data-gallery-archived={artefact.archived ? '' : undefined}>
      <button
        type="button"
        className={css.well}
        onClick={() => { open(shown) }}
        aria-label={t('gallery.enlarge', { prompt: row.prompt })}
        data-gallery-open={artefact.id}
      >
        <ArtefactMedia artefact={artefact} alt={row.prompt} />
      </button>
      <div className={css.tileActions} data-gallery-actions="">
        <RevealButton artefact={artefact} t={t} className={css.tileAction} />
        <VerdictButton artefact={artefact} setDisposition={setDisposition} t={t} className={css.tileAction} />
      </div>
    </figure>
  )
}

/** A chat-like row across the grid: the prompt on the left, the state of the work on the right. */
function ChatRow({ prompt, children, seq, attributes }: {
  prompt: string
  children: ReactNode
  seq: number
  attributes: Record<string, string>
}) {
  return (
    <div className={css.chatRow} data-gallery-seq={seq} {...attributes}>
      <p className={css.chatPrompt} title={prompt} data-gallery-prompt="">{prompt}</p>
      <div className={css.chatState}>{children}</div>
    </div>
  )
}

/** The working indicator: a spinner and the word for what is happening. */
function Working({ label, phase }: { label: string; phase: 'thinking' | 'generating' }) {
  return (
    <span className={css.pending} role="status" data-gallery-working={phase}>
      <span className={css.spinner} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

/** A dispatched generation still in flight: the prompt and "Generating…". */
function RunningRow({ row, t }: { row: GalleryRow; t: GalleryViewProps['t'] }) {
  return (
    <ChatRow prompt={row.prompt} seq={row.startSeq} attributes={{ 'data-gallery-tile': 'running' }}>
      <Working label={t('gallery.status.running')} phase="generating" />
    </ChatRow>
  )
}

/** A turn the model is still thinking about: the prompt and "Thinking…". */
function ThinkingRow({ turn, t }: { turn: GalleryTurn; t: GalleryViewProps['t'] }) {
  return (
    <ChatRow prompt={turn.prompt} seq={turn.startSeq} attributes={{ 'data-gallery-turn': 'thinking' }}>
      <Working label={t('gallery.status.thinking')} phase="thinking" />
    </ChatRow>
  )
}

/**
 * A turn that ended without a generation: the prompt and what the model said
 * instead. A turn the provider refused leaves no reply at all, so its failure
 * stands in place of the reply rather than the blander "nothing was
 * generated", which named the wrong culprit.
 */
function ReplyRow({ turn, t }: { turn: GalleryTurn; t: GalleryViewProps['t'] }) {
  const failed = turn.endReason === 'error' && turn.error !== undefined
  const reply = turn.reply === ''
    ? (turn.endReason === 'aborted' ? t('gallery.turn.stopped') : t('gallery.turn.nothing'))
    : turn.reply
  return (
    <ChatRow prompt={turn.prompt} seq={turn.startSeq} attributes={{ 'data-gallery-turn': 'no-generation' }}>
      {failed
        ? (
          <p className={css.replyFailed} data-gallery-reply="" data-gallery-turn-failed="">
            {t('gallery.turn.failed', { reason: turn.error ?? '' })}
          </p>
        )
        : <p className={css.reply} data-gallery-reply="">{reply}</p>}
    </ChatRow>
  )
}

/** A failed task: the provider's cause, and the Retry that resubmits it. */
function FailedTile({ row, t, retry }: { row: GalleryRow; t: GalleryViewProps['t']; retry: GalleryViewInjected['retry'] }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const resubmit = useCallback(() => {
    setBusy(true)
    setFailure(null)
    void retry(row).then((reason) => {
      if (!alive.current) return
      setBusy(false)
      setFailure(reason)
    }, (reason: unknown) => {
      if (!alive.current) return
      setBusy(false)
      setFailure(reason instanceof Error ? reason.message : String(reason))
    })
  }, [retry, row])

  return (
    <div className={`${css.tile} ${css.failed}`} data-gallery-tile="failed">
      <div className={`${css.well} ${css.errorWell}`} role="alert">
        <span className={css.errorTitle}>{t('gallery.status.failed')}</span>
        <span className={css.errorCause} data-gallery-cause="">{row.error}</span>
      </div>
      <div className={css.body}>
        <span className={css.prompt} title={row.prompt}>{row.prompt}</span>
        <button type="button" className={css.retry} onClick={resubmit} disabled={busy} data-gallery-retry="">
          {busy ? t('gallery.retrying') : t('gallery.retry')}
        </button>
        {failure !== null && <span className={css.retryError} role="status">{t('gallery.retry.failed')}</span>}
      </div>
    </div>
  )
}

/** The enlarged view: the artefact at full size, its copy, Reveal and the verdict. Escape or the backdrop closes it. */
function Enlarged({ shown, close, setDisposition, t }: {
  shown: Shown
  close: () => void
  setDisposition: GalleryViewInjected['setDisposition']
  t: GalleryViewProps['t']
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [close])
  const { row, artefact } = shown
  return (
    <div className={css.enlarged} role="dialog" aria-modal="true" aria-label={row.prompt} data-gallery-enlarged={artefact.id} onClick={close}>
      <div className={css.enlargedBody} onClick={(event) => { event.stopPropagation() }}>
        <div className={css.largeWell}>
          <ArtefactMedia artefact={artefact} alt={row.prompt} large />
        </div>
        <aside className={css.details} data-gallery-details="">
          <p className={css.detailPrompt} data-gallery-detail="prompt">{row.prompt}</p>
          <dl className={css.detailList}>
            <dt>{t('gallery.detail.type')}</dt>
            <dd data-gallery-detail="type">{artefact.mediaType}</dd>
            <dt>{t('gallery.detail.size')}</dt>
            <dd data-gallery-detail="size">{formatBytes(artefact.bytes)}</dd>
            {row.settings.aspect !== undefined && (
              <>
                <dt>{t('gallery.detail.aspect')}</dt>
                <dd data-gallery-detail="aspect">{row.settings.aspect}</dd>
              </>
            )}
            <dt>{t('gallery.detail.path')}</dt>
            <dd className={css.detailPath} data-gallery-detail="path">{artefact.relPath}</dd>
          </dl>
          <div className={css.detailActions} data-gallery-detail-actions="">
            <RevealButton artefact={artefact} t={t} className={css.detailVerdict} />
            <VerdictButton artefact={artefact} setDisposition={setDisposition} t={t} className={css.detailVerdict} />
            <button type="button" className={css.close} onClick={close} data-gallery-close="">{t('gallery.close')}</button>
          </div>
        </aside>
      </div>
    </div>
  )
}

/** One thing the grid lays out, in log order: a generation row or a turn without one. */
type Entry = { seq: number; kind: 'row'; row: GalleryRow } | { seq: number; kind: 'turn'; turn: GalleryTurn }

/**
 * Render the Gallery grid for one chat.
 * @param props - composed slot props.
 * @returns the grid, or the empty state while the chat has generated nothing.
 */
export function GalleryView({ useSession, retry, setDisposition, kind = 'image', t }: GalleryViewProps) {
  const snapshot = useSession(state => state.views.get('gallery')) ?? EMPTY_GALLERY_SNAPSHOT
  // One chat's log carries every generation it ran; this space shows its own.
  const rows = rowsOfKind(snapshot, kind)
  const turns = pendingTurns(snapshot)
  const [enlargedId, setEnlargedId] = useState<string | null>(null)
  const open = useCallback((shown: Shown) => { setEnlargedId(shown.artefact.id) }, [])
  const close = useCallback(() => { setEnlargedId(null) }, [])

  const kept: Shown[] = []
  const archived: Shown[] = []
  for (const row of rows) {
    for (const artefact of row.artefacts) (artefact.archived ? archived : kept).push({ row, artefact })
  }
  // The enlarged view reads the live row, so a verdict taken inside it shows at once.
  const enlarged = enlargedId === null ? undefined : [...kept, ...archived].find(shown => shown.artefact.id === enlargedId)

  // Newest first, generations and the turns that made none interleaved by log position.
  const entries: Entry[] = [
    ...rows.map((row): Entry => ({ seq: row.startSeq, kind: 'row', row })),
    ...turns.map((turn): Entry => ({ seq: turn.startSeq, kind: 'turn', turn })),
  ].sort((left, right) => right.seq - left.seq)

  return (
    <div className={css.root} data-gallery-root="" data-gallery-kind={kind}>
      {/* No page heading (JJ, 2 Sep 2026): the chat's own title bar names the space; the grid speaks for itself. */}
      {entries.length === 0
        ? (
          <div className={css.empty} data-gallery-empty="">
            <span className={css.emptyTitle}>{t(`gallery.empty.${kind}.title`)}</span>
            <span className={css.emptyBody}>{t(`gallery.empty.${kind}.body`)}</span>
          </div>
        )
        : (
          <div className={css.grid}>
            {entries.map((entry) => {
              if (entry.kind === 'turn') {
                return entry.turn.phase === 'thinking'
                  ? <ThinkingRow key={`turn-${String(entry.turn.turn)}`} turn={entry.turn} t={t} />
                  : <ReplyRow key={`turn-${String(entry.turn.turn)}`} turn={entry.turn} t={t} />
              }
              const { row } = entry
              if (row.status === 'failed') return <FailedTile key={row.callId} row={row} t={t} retry={retry} />
              if (row.artefacts.length === 0) return <RunningRow key={row.callId} row={row} t={t} />
              return row.artefacts.filter(artefact => !artefact.archived).map(artefact => (
                <DoneTile key={artefact.id} shown={{ row, artefact }} open={open} setDisposition={setDisposition} t={t} />
              ))
            })}
          </div>
        )}
      {archived.length > 0 && (
        <details className={css.archived} data-gallery-archived-fold={archived.length}>
          <summary className={css.archivedSummary}>{t('gallery.archived.fold', { count: archived.length })}</summary>
          <div className={`${css.grid} ${css.archivedGrid}`}>
            {archived.map(shown => (
              <DoneTile key={shown.artefact.id} shown={shown} open={open} setDisposition={setDisposition} t={t} />
            ))}
          </div>
        </details>
      )}
      {enlarged !== undefined && <Enlarged shown={enlarged} close={close} setDisposition={setDisposition} t={t} />}
    </div>
  )
}

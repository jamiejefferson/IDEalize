/**
 * The Sound Stage list, as a pure function of one chat's generation rows and
 * turns: a scrolling column of sounds, each with its own player streaming the
 * bytes from the artefact raw route, interleaved by log position with the
 * turns the model is still thinking about, the generations still running, the
 * turns that ended with nothing made (the model's reply stands in for the
 * sound) and the ones that failed. A failure prints the adapter's provider
 * cause and offers Retry, which re-sends the prompt that produced it.
 *
 * Sounds are this chat's, not the project's (JJ, 4 Sep 2026: the galleries for
 * sound, image and video are all chat-specific). Each carries the same Keep /
 * Archive verdict the Images grid does, beside a Reveal that opens the Files
 * pane on the file, and archived sounds fold below the list rather than
 * leaving it.
 */

// The Reveal signal, one stateless module inlined into this bundle: the
// `/client` entry is the loader bundle and cannot be imported for a value.
import { requestReveal } from '@idealize/artefacts/src/client/reveal.ts'
import type { GalleryArtefact, GalleryRow, GalleryTurn } from '@idealize/ui-gallery/client'
import type { Translate } from './locales.ts'
import css from './SoundstageView.module.css'

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

/** An epoch instant as the row's short local date and time. */
export function formatWhen(at: number): string {
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return ''
  return when.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** One sound on screen: the generation that made it, and the artefact itself. */
export interface Shown {
  readonly row: GalleryRow
  readonly artefact: GalleryArtefact
}

/** What the Sound Stage list renders and the gestures it reports. */
export interface SoundstageViewProps {
  /** This chat's `generate_audio` rows, newest first. */
  rows: readonly GalleryRow[]
  /** This chat's turns, newest first; the list shows those still thinking or ended without a generation. */
  turns?: readonly GalleryTurn[]
  t: Translate
  /** Re-send one failed generation's prompt through the composer. */
  onRetry: (prompt: string) => void
  /** Keep or archive one sound; the store moves the file and logs the verdict. */
  setDisposition: (artefactId: string, disposition: 'kept' | 'archived') => Promise<string | null>
}

function WaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M2 9h1.6M5.2 5.6v6.8M8.4 3v12M11.6 6.4v5.2M14.8 8h1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M9 3.4 16 15H2L9 3.4zM9 7.6v3.2M9 12.8v.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The verdict control: Archive on a kept sound, Keep on an archived one. */
function Verdict({ shown, setDisposition, t }: {
  shown: Shown
  setDisposition: SoundstageViewProps['setDisposition']
  t: Translate
}) {
  const next = shown.artefact.archived ? 'kept' : 'archived'
  return (
    <button
      type="button"
      className={css.verdict}
      data-soundstage-verdict={next}
      aria-label={next === 'archived' ? t('row.archive') : t('row.keep')}
      onClick={() => { void setDisposition(shown.artefact.id, next) }}
    >
      {next === 'archived' ? t('row.archive') : t('row.keep')}
    </button>
  )
}

/** Reveal: ask the Files pane to show this sound's file, by the project-relative path its record carries. */
function Reveal({ shown, t }: { shown: Shown; t: Translate }) {
  return (
    <button
      type="button"
      className={css.verdict}
      data-soundstage-reveal={shown.artefact.id}
      aria-label={t('row.reveal')}
      onClick={() => { requestReveal(shown.artefact.relPath) }}
    >
      {t('row.reveal')}
    </button>
  )
}

/** One stored sound: its player, its provenance line, Reveal and its verdict. */
function SoundRow({ shown, setDisposition, t }: {
  shown: Shown
  setDisposition: SoundstageViewProps['setDisposition']
  t: Translate
}) {
  const { row, artefact } = shown
  const title = row.prompt === '' ? t('row.untitled') : row.prompt
  const length = row.settings.durationSeconds === undefined ? '' : ` · ${String(row.settings.durationSeconds)}s`
  return (
    <li className={css.row} data-soundstage-sound={artefact.id} data-soundstage-archived={artefact.archived ? '' : undefined}>
      <span className={css.badge}><WaveIcon /></span>
      <div className={css.body}>
        <span className={css.rowTitle}>{title}</span>
        <audio
          className={css.player}
          controls
          preload="metadata"
          src={rawUrl(artefact.id)}
          aria-label={`${t('row.play')}: ${title}`}
          data-soundstage-player={artefact.id}
        />
        <span className={css.meta}>
          {artefact.relPath} · {formatBytes(artefact.bytes)}{length} · {formatWhen(row.startedAt)}
        </span>
      </div>
      <span className={css.actions}>
        <Reveal shown={shown} t={t} />
        <Verdict shown={shown} setDisposition={setDisposition} t={t} />
      </span>
    </li>
  )
}

/** One turn of the chat before it has a sound: the prompt, and Thinking… or the model's reply. */
function TurnRowView({ turn, t }: { turn: GalleryTurn; t: Translate }) {
  const title = turn.prompt === '' ? t('row.untitled') : turn.prompt
  if (turn.phase === 'thinking') {
    return (
      <li className={css.row} data-soundstage-turn="thinking">
        <span className={css.badge}><WaveIcon /></span>
        <div className={css.body}>
          <span className={css.rowTitle}>{title}</span>
          <span className={css.meta} role="status">{t('row.thinking')}</span>
          <div className={css.progress} role="progressbar" aria-label={t('row.thinking')} />
        </div>
      </li>
    )
  }
  // A turn the provider refused leaves no reply, so its failure stands where
  // the reply would: "nothing was generated" named the generator for a fault
  // that was the account's (see GalleryTurn.error).
  const failed = turn.endReason === 'error' && turn.error !== undefined
  const reply = turn.reply === ''
    ? (turn.endReason === 'aborted' ? t('row.stopped') : t('row.nothing'))
    : turn.reply
  return (
    <li className={css.row} data-soundstage-turn="no-generation">
      <span className={css.badge}><WaveIcon /></span>
      <div className={css.body}>
        <span className={css.rowTitle}>{title}</span>
        {failed
          ? (
            <p className={css.replyFailed} data-soundstage-reply="" data-soundstage-turn-failed="">
              {t('row.turnFailed', { reason: turn.error ?? '' })}
            </p>
          )
          : <p className={css.reply} data-soundstage-reply="">{reply}</p>}
      </div>
    </li>
  )
}

/** One row, dispatched on the generation's status. */
function StageRowView({ row, t, onRetry, setDisposition }: {
  row: GalleryRow
  t: Translate
  onRetry: (prompt: string) => void
  setDisposition: SoundstageViewProps['setDisposition']
}) {
  if (row.status === 'failed') {
    return (
      <li className={css.row} data-soundstage-error={row.callId}>
        <span className={css.badgeFailed}><AlertIcon /></span>
        <div className={css.body}>
          <span className={css.rowTitle}>{row.prompt === '' ? t('row.failed') : row.prompt}</span>
          <span className={css.cause} role="alert">{row.error ?? t('row.failed')}</span>
          {row.prompt !== '' && (
            <button type="button" className={css.retry} onClick={() => { onRetry(row.prompt) }}>
              {t('row.retry')}
            </button>
          )}
        </div>
      </li>
    )
  }
  if (row.artefacts.length === 0) {
    return (
      <li className={css.row} data-soundstage-generating={row.callId}>
        <span className={css.badge}><WaveIcon /></span>
        <div className={css.body}>
          <span className={css.rowTitle}>{row.prompt === '' ? t('row.untitled') : row.prompt}</span>
          <span className={css.meta} role="status">{t('row.generating')}</span>
          <div className={css.progress} role="progressbar" aria-label={t('row.generating')} />
        </div>
      </li>
    )
  }
  return (
    <>
      {row.artefacts.filter(artefact => !artefact.archived).map(artefact => (
        <SoundRow key={artefact.id} shown={{ row, artefact }} setDisposition={setDisposition} t={t} />
      ))}
    </>
  )
}

/** One thing the list lays out, in log order: a generation row or a turn without one. */
type Entry = { seq: number; kind: 'row'; row: GalleryRow } | { seq: number; kind: 'turn'; turn: GalleryTurn }

/**
 * Render the Sound Stage for one chat.
 * @param props - the chat's rows and turns, copy, and the two gestures.
 * @returns the stage: the list or the empty state, with archived sounds folded beneath.
 */
export function SoundstageView({ rows, turns = [], t, onRetry, setDisposition }: SoundstageViewProps) {
  const archived: Shown[] = []
  for (const row of rows) {
    for (const artefact of row.artefacts) if (artefact.archived) archived.push({ row, artefact })
  }
  // Newest first, generations and the turns that made none interleaved by log position.
  const entries: Entry[] = [
    ...rows.map((row): Entry => ({ seq: row.startSeq, kind: 'row', row })),
    ...turns
      .filter(turn => turn.phase === 'thinking' || turn.phase === 'no-generation')
      .map((turn): Entry => ({ seq: turn.startSeq, kind: 'turn', turn })),
  ].sort((left, right) => right.seq - left.seq)

  return (
    <section className={css.stage} aria-label={t('view.soundstage')} data-soundstage="">
      {/* No page heading and no Refresh: the chat's own title bar names the
          space, and the rows come from the conversation snapshot, which is
          already live — there is nothing a refresh could fetch. */}
      {entries.length === 0
        ? (
          <div className={css.empty} data-soundstage-empty="">
            <span className={css.emptyTitle}>{t('stage.empty.title')}</span>
            <span className={css.emptyBody}>{t('stage.empty.body')}</span>
          </div>
        )
        : (
          <ul className={css.list}>
            {entries.map(entry => (entry.kind === 'turn'
              ? <TurnRowView key={`turn-${String(entry.turn.turn)}`} turn={entry.turn} t={t} />
              : <StageRowView key={entry.row.callId} row={entry.row} t={t} onRetry={onRetry} setDisposition={setDisposition} />))}
          </ul>
        )}
      {archived.length > 0 && (
        <details className={css.archivedFold} data-soundstage-archived-fold={archived.length}>
          <summary className={css.archivedSummary}>{t('stage.archived.fold', { count: archived.length })}</summary>
          <ul className={css.list}>
            {archived.map(shown => (
              <SoundRow key={shown.artefact.id} shown={shown} setDisposition={setDisposition} t={t} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

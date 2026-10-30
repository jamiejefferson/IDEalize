/**
 * The comparison after a dislike (Paper "Ratings and dislike" boards 03 and
 * 04): two other models' answers side by side, about 380px a column, each with
 * "Use this one", and "Keep my first answer" beside them. Pictures, clips and
 * sounds show as tiles, in the card above the composer only. Once the person picks, the card folds to one line that
 * says which answer the chat carries on from, with the others a tap away.
 * @module @idealize/ui-bar/client/CompareCard
 */
import { useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RouterCompareEventData } from '@idealize/router/client'
import type { BarKey } from './locales.ts'
import { HeartIcon } from './HeartButton.tsx'
import type { CompareNodeData } from './compare-node.ts'
import { pickAnswer } from './rating-line.ts'
import css from './CompareCard.module.css'

type Translate = (key: BarKey, params?: Record<string, string | number>) => string

/** Answers longer than this many characters open cut to eight lines, with Show all. */
const LONG_ANSWER = 600

const raw = (id: string): string => `/idealize/artefacts/raw?id=${encodeURIComponent(id)}`

function Media({ artefact }: { artefact: { id: string; mediaType: string } }) {
  if (artefact.mediaType.startsWith('image/')) return <img className={css.tile} src={raw(artefact.id)} alt="" />
  if (artefact.mediaType.startsWith('video/')) return <video className={css.tile} src={raw(artefact.id)} controls muted loop playsInline />
  return <audio className={css.audio} src={raw(artefact.id)} controls />
}

function Answer({ model, answer, media, t }: {
  model: string
  answer: RouterCompareEventData | undefined
  media: boolean
  t: Translate
}) {
  const [all, setAll] = useState(false)
  if (answer === undefined) {
    return <p className={css.working}>{t(media ? 'compare.working.media' : 'compare.working')}</p>
  }
  if (answer.failed !== undefined) return <p className={css.failed}>{t('compare.failed', { model, reason: answer.failed })}</p>
  if (media) {
    return <div className={css.tiles}>{(answer.artefacts ?? []).map(one => <Media key={one.id} artefact={one} />)}</div>
  }
  const text = answer.text ?? ''
  const long = text.length > LONG_ANSWER
  return (
    <>
      <div className={long && !all ? css.cut : css.body}><MarkdownText text={text} /></div>
      {long && (
        <button type="button" className={css.link} onClick={() => { setAll(!all) }}>
          {t(all ? 'compare.showLess' : 'compare.showAll')}
        </button>
      )}
    </>
  )
}

/**
 * The card for one comparison.
 * @param props.sessionId - the chat.
 * @param props.data - the comparison so far.
 * @param props.t - the rail's copy.
 */
export function CompareCard({ sessionId, data, t, onClose }: {
  sessionId: string
  data: CompareNodeData
  t: Translate
  /** Shown on a decided card outside the transcript, so the line can be put away. */
  onClose?: (() => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const { started, answers, picked } = data
  const alternatives = started.alternatives ?? []
  const kind = started.kind ?? 'chat'
  const media = kind !== 'chat'
  const pick = async (index: number): Promise<void> => {
    setBusy(true)
    const failed = await pickAnswer(sessionId, started.id, index)
    setBusy(false)
    setError(failed === undefined ? undefined : t('compare.pickFailed', { reason: failed }))
  }
  const columns = (decided: boolean) => (
    <div className={css.columns}>
      {alternatives.map((model, index) => {
        const answer = answers[index]
        const ready = answer !== undefined && answer.failed === undefined
        return (
          <section key={`${model.provider}/${model.model}`} className={index === picked ? css.kept : css.column} data-compare-column={index}>
            <span className={css.model}>{model.label}</span>
            <Answer model={model.label} answer={answer} media={media} t={t} />
            {!decided && (
              <button
                type="button"
                className={css.use}
                disabled={!ready || busy}
                data-compare-use={index}
                onClick={() => { void pick(index) }}
              >
                {t('compare.use')}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )

  if (picked !== undefined) {
    const kept = alternatives[picked]
    const said = picked === -1 || kept === undefined
      ? t('compare.keptFirst')
      : t(kind === 'chat' ? 'compare.kept' : `compare.kept.${kind}`, { model: kept.label })
    return (
      <div className={css.card} data-compare="" data-compare-picked={picked}>
        <div className={css.decided}>
          <span className={css.mark}><HeartIcon broken /></span>
          <span className={css.said}>{said}</span>
          <button type="button" className={css.link} aria-expanded={open} onClick={() => { setOpen(!open) }}>
            {t(open ? 'compare.hideOthers' : 'compare.showOthers')}
          </button>
          {onClose !== undefined && (
            <button type="button" className={css.close} aria-label={t('line.close')} onClick={onClose}>
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        {open && columns(true)}
      </div>
    )
  }

  return (
    <div className={css.card} data-compare="">
      <div className={css.head}>
        <span className={css.mark}><HeartIcon broken /></span>
        <span className={css.title}>
          {t(media ? 'compare.title.media' : alternatives.length === 1 ? 'compare.title.one' : 'compare.title.two')}
        </span>
        <button type="button" className={css.link} disabled={busy} data-compare-keep-first="" onClick={() => { void pick(-1) }}>
          {t(kind === 'chat' ? 'compare.keepFirst' : `compare.keepFirst.${kind}`)}
        </button>
      </div>
      {columns(false)}
      {error !== undefined && <p className={css.failed} role="alert">{error}</p>}
    </div>
  )
}

/**
 * The keyed `conversation.chat.node` renderer for `kind: 'router-compare'`, bound to the rail's copy.
 * @param t - the rail's copy.
 * @returns the renderer.
 */
export function compareNodeView(t: Translate) {
  return function RouterCompareView({ node, sessionId }: ChatNodeViewProps<'router-compare'>) {
    // Pictures, clips and sounds compare above the composer, where the generating spaces keep them in view.
    if ((node.data.started.kind ?? 'chat') !== 'chat') return null
    return <CompareCard sessionId={sessionId} data={node.data} t={t} />
  }
}

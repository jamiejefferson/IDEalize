/**
 * The router's line under the composer (Paper "Ratings and dislike" boards 01
 * and 02): the heart's "Rate X for [tag] ☆☆☆☆☆" with its saved state and
 * Undo, or the dislike's one-row offer to try two other models with the price
 * of both runs on the button.
 * @module @idealize/ui-bar/client/RatingLine
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CompareCard } from './CompareCard.tsx'
import { COMPARE_KIND } from './compare-node.ts'
import type { CompareNodeData } from './compare-node.ts'
import { HeartIcon } from './HeartButton.tsx'
import { tagKey } from './model-browser.ts'
import { acceptOffer, priceKey, rateOnLine, setLine, useLine } from './rating-line.ts'
import type { LineState, Offer } from './rating-line.ts'
import css from './RatingLine.module.css'

export type RatingLineProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'idealize-bar'>

type Translate = RatingLineProps['t']

/** A saved rating's line closes by itself after this long. */
const SAVED_MS = 5000

function Close({ sessionId, t }: { sessionId: string; t: Translate }) {
  return (
    <button type="button" className={css.close} aria-label={t('line.close')} onClick={() => { setLine(sessionId, undefined) }}>
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
        className={filled ? css.starFilled : css.starOpen}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Rate({ sessionId, line, t }: { sessionId: string; line: Extract<LineState, { kind: 'rate' }>; t: Translate }) {
  const { target, tag, saved } = line
  const value = target.stars[tag] ?? 0
  useEffect(() => {
    if (saved === undefined) return
    const timer = setTimeout(() => {
      // Only the saved line it was set for closes; a later tap keeps the line open.
      setLine(sessionId, undefined)
    }, SAVED_MS)
    return () => { clearTimeout(timer) }
  }, [saved, sessionId])
  if (saved !== undefined) {
    const label = t(tagKey(tag))
    return (
      <div className={css.line} role="status" data-rating-line="saved">
        <span className={css.heart}><HeartIcon /></span>
        <span className={css.text}>
          {saved.stars === null ? t('line.rate.cleared', { tag: label }) : t('line.rate.saved', { count: saved.stars, tag: label })}
        </span>
        <button type="button" className={css.link} onClick={() => { void rateOnLine(sessionId, saved.before) }}>{t('line.undo')}</button>
        <Close sessionId={sessionId} t={t} />
      </div>
    )
  }
  return (
    <div className={css.line} data-rating-line="rate">
      <span className={css.heart}><HeartIcon /></span>
      <span className={css.text}>{t('line.rate', { model: target.label })}</span>
      <select
        className={css.tag}
        aria-label={t('line.rate.tag')}
        value={tag}
        onChange={(event) => { setLine(sessionId, { kind: 'rate', target, tag: event.target.value }) }}
      >
        {target.tags.map(one => <option key={one} value={one}>{t(tagKey(one))}</option>)}
      </select>
      <span className={css.stars} role="group" aria-label={t(tagKey(tag))}>
        {[1, 2, 3, 4, 5].map(count => (
          <button
            key={count}
            type="button"
            className={css.star}
            aria-pressed={value >= count}
            aria-label={t('line.rate.star', { count })}
            data-rating-star={count}
            onClick={() => { void rateOnLine(sessionId, value === count ? null : count) }}
          >
            <Star filled={value >= count} />
          </button>
        ))}
      </span>
      <Close sessionId={sessionId} t={t} />
    </div>
  )
}

/** What one click sends and to whom, said before the click: a chat sends all of its history, a picture its prompt. */
function sendsKey(kind: Offer['kind'], two: boolean) {
  if (kind === 'chat') return two ? 'line.offer.sends.two' : 'line.offer.sends.one'
  return two ? 'line.offer.sends.media.two' : 'line.offer.sends.media.one'
}

function OfferRow({ sessionId, line, t }: { sessionId: string; line: Extract<LineState, { kind: 'offer' }>; t: Translate }) {
  const [a, b] = line.offer.alternatives
  const price = priceKey(line.offer.price)
  const priced = t(price.key, price.amount === undefined ? {} : { amount: price.amount })
  return (
    <div className={css.line} data-rating-line="offer">
      <span className={css.dislike}><HeartIcon broken /></span>
      <span className={css.offer}>
        <span className={css.text}>
          {b === undefined ? t('line.offer.one', { a: a?.label ?? '' }) : t('line.offer.two', { a: a?.label ?? '', b: b.label })}
        </span>
        <span className={css.sends} data-rating-sends="">{t(sendsKey(line.offer.kind, b !== undefined), { a: a?.label ?? '', b: b?.label ?? '' })}</span>
      </span>
      <button type="button" className={css.secondary} onClick={() => { setLine(sessionId, undefined) }}>{t('line.offer.no')}</button>
      <button
        type="button"
        className={css.primary}
        disabled={line.starting === true}
        data-rating-try=""
        onClick={() => { void acceptOffer(sessionId, reason => t('line.offer.failed', { reason })) }}
      >
        {`${t(b === undefined ? 'line.offer.try.one' : 'line.offer.try.two')} · ${priced}`}
      </button>
    </div>
  )
}

/**
 * The latest comparison of pictures, clips or sounds. The generating spaces
 * show the gallery, where the transcript's card would be out of sight, so the
 * card sits here until the person picks and closes it.
 */
function MediaCompare({ session, sessionId, t }: Pick<RatingLineProps, 'session' | 'sessionId' | 't'>) {
  const [closed, setClosed] = useState<string | undefined>(undefined)
  let latest: { anchorSeq: number; data: CompareNodeData } | undefined
  for (const node of session.chat.nodes.values()) {
    if (node.kind !== COMPARE_KIND || (latest !== undefined && node.anchorSeq < latest.anchorSeq)) continue
    latest = { anchorSeq: node.anchorSeq, data: node.data as CompareNodeData }
  }
  const data = latest?.data
  if (data === undefined || (data.started.kind ?? 'chat') === 'chat' || closed === data.started.id) return null
  return (
    <div className={css.compare}>
      <CompareCard
        sessionId={sessionId}
        data={data}
        t={t}
        onClose={data.picked === undefined ? undefined : () => { setClosed(data.started.id) }}
      />
    </div>
  )
}

export function RatingLine(props: RatingLineProps) {
  return (
    <>
      <MediaCompare session={props.session} sessionId={props.sessionId} t={props.t} />
      <Line {...props} />
    </>
  )
}

function Line({ sessionId, t }: RatingLineProps) {
  const line = useLine(sessionId)
  if (line === undefined) return null
  switch (line.kind) {
    case 'loading':
      return (
        <div className={css.line} role="status" data-rating-line="loading">
          <span className={line.from === 'heart' ? css.heart : css.dislike}><HeartIcon broken={line.from === 'dislike'} /></span>
          <span className={css.muted}>{t('line.loading')}</span>
        </div>
      )
    case 'note':
      return (
        <div className={css.line} role="status" data-rating-line="note">
          <span className={line.from === 'heart' ? css.heart : css.dislike}><HeartIcon broken={line.from === 'dislike'} /></span>
          <span className={css.muted}>{line.message}</span>
          <Close sessionId={sessionId} t={t} />
        </div>
      )
    case 'rate':
      return <Rate sessionId={sessionId} line={line} t={t} />
    case 'offer':
      return <OfferRow sessionId={sessionId} line={line} t={t} />
  }
}

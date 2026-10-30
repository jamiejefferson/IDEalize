/**
 * The composer heart and, beside it, the dislike (Paper "Ratings and dislike"
 * board 01). The heart sends nothing to the model: it opens the router's line
 * under the composer, "Rate X for [tag] ☆☆☆☆☆", for the model behind the
 * chat's last answer (JJ, 28 Oct 2026). The dislike, a broken heart (JJ,
 * 30 Oct 2026), asks the router to try two other models on the same ask. Terminal
 * chats run a command-line agent the router cannot reach, so they get neither.
 */
import { useId } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { openOffer, openRating, useLine } from './rating-line.ts'
import css from './HeartButton.module.css'

export type HeartButtonProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<'idealize-bar'>

/** The spaces whose answers come from a model the router can name. */
const RATED_SPACES: ReadonlySet<string> = new Set(['chat', 'gallery', 'motion', 'soundstage'])

const HEART = 'M12 20.5C10.5 19.2 3 13.6 3 8.4 3 5.4 5.4 3 8.3 3c1.5 0 2.9.7 3.7 1.8C12.8 3.7 14.2 3 15.7 3 18.6 3 21 5.4 21 8.4c0 5.2-7.5 10.8-9 12.1z'

/** The crack down a broken heart, from the notch at the top to the point. */
const CRACK = '12,4.8 10.3,9 13.5,12.4 11,16.2 12,22'
const LEFT = `0,0 12,0 ${CRACK} 0,22`
const RIGHT = `24,0 12,0 ${CRACK} 24,22`

/**
 * The heart drawn at the composer's icon size, or the dislike's broken heart:
 * the same heart cut along a zigzag, each half leaning out from the point.
 */
export function HeartIcon({ broken = false }: { broken?: boolean }) {
  const id = useId()
  if (!broken) {
    return (
      <svg width="15" height="14" viewBox="0 0 24 22" fill="none" aria-hidden="true">
        <path d={HEART} fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width="15" height="14" viewBox="0 0 24 22" fill="none" aria-hidden="true" overflow="visible">
      <clipPath id={`${id}l`}><polygon points={LEFT} /></clipPath>
      <clipPath id={`${id}r`}><polygon points={RIGHT} /></clipPath>
      <path d={HEART} fill="currentColor" clipPath={`url(#${id}l)`} transform="translate(-0.8 0.2) rotate(-6 12 20.5)" />
      <path d={HEART} fill="currentColor" clipPath={`url(#${id}r)`} transform="translate(0.8 0.2) rotate(6 12 20.5)" />
    </svg>
  )
}

/** Whether the chat runs in a space the router rates. */
function useRated({ sessionId, useSessions }: Pick<HeartButtonProps, 'sessionId' | 'useSessions'>): boolean {
  const space = useSessions(list => list.byId[sessionId]?.projectionValues?.space?.space ?? 'chat')
  return RATED_SPACES.has(space)
}

export function HeartButton({ input, sessionId, useSessions, t }: HeartButtonProps) {
  const line = useLine(sessionId)
  const rated = useRated({ sessionId, useSessions })
  if (!rated) return null
  const open = line?.kind === 'rate' || (line?.kind === 'loading' && line.from === 'heart')
  return (
    <Tooltip label={t('heart.label')} delayMs={400}>
      <button
        type="button"
        className={css.heart}
        aria-label={t('heart.label')}
        aria-expanded={open}
        data-idealize-heart=""
        disabled={input.phase !== 'plain'}
        onClick={() => { void openRating(sessionId, t('line.nothing')) }}
      >
        <HeartIcon />
      </button>
    </Tooltip>
  )
}

export function DislikeButton({ input, sessionId, useSessions, t }: HeartButtonProps) {
  const line = useLine(sessionId)
  const rated = useRated({ sessionId, useSessions })
  if (!rated) return null
  const open = line?.kind === 'offer' || (line?.kind === 'loading' && line.from === 'dislike')
  return (
    <Tooltip label={t('dislike.label')} delayMs={400}>
      <button
        type="button"
        className={css.dislike}
        aria-label={t('dislike.label')}
        aria-expanded={open}
        data-idealize-dislike=""
        disabled={input.phase !== 'plain'}
        onClick={() => { void openOffer(sessionId, reason => t('line.offer.cannot', { reason })) }}
      >
        <HeartIcon broken />
      </button>
    </Tooltip>
  )
}

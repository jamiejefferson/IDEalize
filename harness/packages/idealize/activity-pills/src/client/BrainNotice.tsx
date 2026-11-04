/**
 * The line above the composer that belongs to the brain chip: what auto-switch
 * just did or offers, and what the brain is missing, each with the one action
 * that answers it (Paper "Brains rethink", board 09). It rides the input dock
 * because the chip's seat on the tool row has no room for a sentence.
 *
 * A switch or an offer can be dismissed, because the router's record outlives
 * the moment and the line would otherwise sit there until the next decision.
 * A block cannot: the chat cannot answer until it clears.
 * @module @idealize/activity-pills/client/BrainNotice
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { brainLabel, useBrainChipView, type BrainChipInjected } from './BrainChip.tsx'
import css from './BrainChip.module.css'

/** Full slot component props. */
export type BrainNoticeProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'idealize-activity'>
  & InjectFace<BrainChipInjected>

function Close() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The composer's brain notice.
 * @param props - composed slot props.
 * @returns the line, or null while there is nothing to say.
 */
export function BrainNotice(props: BrainNoticeProps) {
  const { sessionId, addKey, signIn, openBrains, select, router: actions, t } = props
  const view = useBrainChipView(props)
  const { session, space, brains, current, blocked, routed } = view
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (session === undefined || current === undefined) return null

  if (blocked) {
    const name = brainLabel(current, space, brains.length === 1, t)
    const reason = current.access?.reason
    const free = current.id === 'free' ? undefined : brains.find(brain => brain.id === 'free' && brain.access?.state !== 'unavailable')
    const noModel = reason === 'no-model' && current.id === 'free'
    const fix = (): void => {
      if (noModel) window.open('/idealize/freetokens', '_blank', 'noopener')
      else if (reason === 'no-model') openBrains?.()
      else if (reason === 'no-sign-in') signIn?.()
      else addKey?.(current.model?.provider)
    }
    return (
      <div className={css.noticeBlocked} data-brain-notice="blocked">
        <span className={css.noticeLine}>{t(noModel ? 'chip.blocked.setup' : 'chip.blocked.account', { brain: name })}</span>
        <button type="button" className={css.solidButton} data-brain-connect="" onClick={fix}>
          {t(noModel ? 'chip.blocked.setUp' : 'chip.blocked.connect')}
        </button>
        {free !== undefined && (
          <button type="button" className={css.linkButton} data-brain-use-free="" onClick={() => { void select(free.id, session) }}>
            {t('chip.blocked.useFree')}
          </button>
        )}
      </div>
    )
  }

  const last = routed?.last
  if (last === undefined || actions === undefined || space !== 'chat') return null
  const key = `${sessionId}:${last.outcome}:${last.from.provider}/${last.from.model}:${last.to.provider}/${last.to.model}`
  if (dismissed === key) return null
  const dismiss = (
    <button type="button" className={css.dismiss} aria-label={t('chip.dismiss')} data-brain-notice-dismiss="" onClick={() => { setDismissed(key) }}>
      <Close />
    </button>
  )

  if (last.outcome === 'switched') {
    return (
      <div className={css.notice} data-brain-notice="switched" title={last.rationale}>
        <span className={css.noticeLine}>{t('router.note.switched', { from: last.from.label, to: last.to.label })}</span>
        <button type="button" className={css.linkButton} data-router-back="" onClick={() => { void actions.back(sessionId, last.from) }}>{t('chip.switchBack')}</button>
        {dismiss}
      </div>
    )
  }

  if (last.outcome === 'offer') {
    return (
      <div className={css.notice} data-brain-notice="offer" title={last.rationale}>
        <span className={css.noticeLine}>{t(`router.offer.${last.reason ?? 'needs-payment'}`, { to: last.to.label })}</span>
        <button type="button" className={css.tintButton} data-router-accept="" onClick={() => { void actions.accept(sessionId, last.to) }}>{t('chip.try', { model: last.to.label })}</button>
        {dismiss}
      </div>
    )
  }

  return null
}

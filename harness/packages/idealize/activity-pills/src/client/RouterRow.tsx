/**
 * The model router's place in the composer: a chip beside the three-dot
 * control while the router has moved this chat or has a model to offer, and
 * the row inside the panel that says why, takes the switch back, accepts an
 * offer, and locks the chat. Reads the `router` projection off the session
 * summary, so it follows the chat with no request of its own.
 * @module @idealize/activity-pills/client/RouterRow
 */

import type { RoutedModel, RouterProjection } from '@idealize/router/client'
import type { ActivityKey } from './locales.ts'
import css from './ComposerOverflow.module.css'

/** What the row asks of the plugin: the router's routes and the chat's model write. */
export interface RouterActions {
  /** Lock or unlock the chat against routing. */
  lock(sessionId: string, locked: boolean): Promise<void>
  /** Put the chat back on the model it had, and lock it there. */
  back(sessionId: string, to: RoutedModel): Promise<void>
  /** Move the chat to a model the router offered. */
  accept(sessionId: string, to: RoutedModel): Promise<void>
}

type Translate = (key: ActivityKey, params?: Record<string, string | number>) => string

/**
 * The chip on the tool row.
 * @param props.router - the chat's router projection.
 * @param props.onOpen - open the panel the row lives in.
 * @returns the chip, or null while the router has nothing to show.
 */
export function RouterBadge({ router, onOpen, t }: { router: RouterProjection | undefined; onOpen: () => void; t: Translate }) {
  const last = router?.last
  if (last === undefined) return null
  return (
    <button type="button" className={css.badge} data-router-badge={last.outcome} title={last.rationale} onClick={onOpen}>
      {t(last.outcome === 'offer' ? 'router.badge.offer' : 'router.badge.switched', { model: last.to.label })}
    </button>
  )
}

/**
 * The panel's router row.
 * @param props.router - the chat's router projection.
 * @param props.actions - the plugin's router face.
 * @returns the row; with nothing routed yet it is the lock alone.
 */
export function RouterRow({ sessionId, router, actions, t }: {
  sessionId: string
  router: RouterProjection | undefined
  actions: RouterActions
  t: Translate
}) {
  const last = router?.last
  return (
    <span className={css.item} data-router-row="">
      <span className={css.label}>{t('router.row')}</span>
      {last !== undefined && (
        <span className={css.routerNote} data-router-note={last.outcome}>
          {last.outcome === 'offer'
            ? t(last.reason === 'loses-context' ? 'router.offer.loses-context' : 'router.offer.needs-payment', { to: last.to.label })
            : t('router.switched', { to: last.to.label, from: last.from.label })}
          {last.rationale !== undefined && ` ${last.rationale}`}
        </span>
      )}
      {last?.outcome === 'switched' && (
        <button type="button" className={css.action} data-router-back="" onClick={() => { void actions.back(sessionId, last.from) }}>
          {t('router.back', { from: last.from.label })}
        </button>
      )}
      {last?.outcome === 'offer' && (
        <button type="button" className={css.action} data-router-accept="" onClick={() => { void actions.accept(sessionId, last.to) }}>
          {t('router.accept', { to: last.to.label })}
        </button>
      )}
      <label className={css.routerLock}>
        <input
          type="checkbox"
          data-router-lock=""
          checked={router?.locked ?? false}
          onChange={(event) => { void actions.lock(sessionId, event.target.checked) }}
        />
        {t('router.lock')}
      </label>
    </span>
  )
}

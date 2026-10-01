/**
 * Renders the router's transcript line: which model this reply moved to and
 * why, a model offered for the user to take, or the chat back on its own model.
 * @module @idealize/activity-pills/client/RouterNote
 */

import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RouterEventData } from '@idealize/router/client'
import type { ActivityKey } from './locales.ts'
import css from './RouterNote.module.css'

type Translate = (key: ActivityKey, params?: Record<string, string | number>) => string

/**
 * The line's words for one router event.
 * @param data - the event.
 * @param t - activity copy.
 * @returns the headline and, when the router gave one, its reason.
 */
export function routerNoteText(data: RouterEventData, t: Translate): { headline: string; reason?: string } {
  const params = { from: data.from.label, to: data.to.label }
  if (data.outcome === 'switched') {
    return { headline: t('router.note.switched', params), ...data.rationale === undefined ? {} : { reason: data.rationale } }
  }
  if (data.outcome === 'offer') {
    return { headline: t(data.reason === 'loses-context' ? 'router.offer.loses-context' : 'router.offer.needs-payment', params) }
  }
  return { headline: t('router.note.back', params) }
}

/**
 * The keyed `conversation.chat.node` renderer for `kind: 'router-note'`, bound to the plugin's copy.
 * @param t - activity copy.
 * @returns the renderer.
 */
export function routerNoteView(t: Translate) {
  return function RouterNoteView({ node }: ChatNodeViewProps<'router-note'>) {
    const { headline, reason } = routerNoteText(node.data, t)
    return (
      <div className={css.note} role="note" data-router-note={node.data.outcome}>
        <span className={css.mark} aria-hidden="true">⇄</span>
        <span className={css.text}>
          <span className={css.headline}>{headline}</span>
          {reason !== undefined && <span className={css.reason}>{reason}</span>}
        </span>
      </div>
    )
  }
}

/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useEffect, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
}

const DEFAULT_VIEW_ID = 'chat'

/** Resolve by id and keep stale persisted selections on the stable Chat fallback. */
function resolveActiveView(tabs: readonly ViewTab[], selectedId: string | null): ViewTab | undefined {
  const requestedId = selectedId ?? DEFAULT_VIEW_ID
  return tabs.find(view => view.id === requestedId)
    ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({ id: summary.id, displayTitle: summary.displayTitle })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * The view ring has no tab row: a chat's active view is fixed by the space it
 * was launched into and is written into the shared chat store by the plugin
 * that owns that fact, so the header carries only the title row and its two
 * action seats.
 * @param props - Strict Session store, navigation, render, and locale shares.
 * @returns the hidden blank-session header or the visible title row.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, renderSlot, open, t,
}: ConversationSessionHeaderProps) {
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const hideChrome = blank && composerPhase === 'blank'

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <div className={css.titleRow}>
          <div className={css.titleCluster}>
            <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
              {ancestry.map((summary, index) => {
                const last = index === ancestry.length - 1
                return (
                  <span key={summary.id} className={css.crumbSeg}>
                    {index > 0 && <span className={css.crumbSep}>/</span>}
                    <button
                      type="button"
                      className={clsx(css.crumb, last && css.crumbCurrent)}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  </span>
                )
              })}
              {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
            </nav>
            <div className={css.headerActions}>
              {renderSlot('conversation.session.header.actions', {})}
            </div>
          </div>
          <div className={css.headerUtilities}>
            {renderSlot('conversation.session.header.utilities', {})}
          </div>
        </div>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the blank Session shows the
 * hero (a blank Session on a non-chat view — a welcome-card launch into
 * Terminal, Gallery or Sound Stage — renders that view full-height instead,
 * under a header hidden like the hero's). `data-blank-view` carries the active
 * view's id in that case, so the hero chrome retires and a view that owns its
 * whole column can suppress the composer from its own package.
 */
export function ConversationSession({
  sessionId, useSession, useInput, inputActions, useStore, actions,
  renderSlot, views, bindDraftMirror, releaseSessionImages,
}: ConversationSessionProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const tabs = views.list()
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  // `?? null`: persisted snapshots from before the inspect field rehydrate without it.
  const inspect = useStore(s => s.inspect ?? null)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  useEffect(() => () => {
    releaseSessionImages(sessionId)
  }, [releaseSessionImages, sessionId])

  const heroBlank = blank && composerPhase === 'blank'
  if (heroBlank && (active === undefined || active.id === DEFAULT_VIEW_ID)) return null
  return (
    <div className={css.viewArea} data-blank-view={heroBlank ? active?.id ?? '' : undefined}>
      {active !== undefined && renderSlot('conversation.view', {
        inspect,
        onInspectDone: () => { actions.setInspect(null) },
      }, { only: active.id })}
    </div>
  )
}

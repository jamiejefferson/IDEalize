/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
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
 * The Session title strip (JJ, 7 Oct 2026: "Kitchen quotes in Casa
 * Madrigal", so a glance says which chat and which project a prompt goes
 * to). The chat's name leads at title size; a deployment adds where the
 * chat lives through `conversation.session.header.context`. Clicking the
 * name renames the chat in place.
 *
 * The strip floats over the top of the scrollport, so a chat's transcript
 * scrolls up under it, blurred and faded; it writes its own height to the
 * root as `--dsh-session-header-height`, the scrollport's top padding, so
 * nothing starts hidden. A terminal view's grid fits below that padding, and
 * the strip turns opaque in the terminal's own colours
 * (`--dsh-terminal-bg` / `--dsh-terminal-fg`), since nothing scrolls under
 * it there. A blank chat still hides it behind the hero; a blank non-chat
 * view (a terminal chat) keeps it, so a terminal chat says where it is too.
 * @param props - Strict Session store, navigation, render, and locale shares.
 * @returns the hidden blank-session header or the visible title row.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useStore, views, renderSlot, open, rename, t,
}: ConversationSessionHeaderProps) {
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  useSyncExternalStore(views.subscribe, views.version)
  const selectedId = useStore(s => s.view)
  const viewId = resolveActiveView(views.list(), selectedId)?.id ?? DEFAULT_VIEW_ID
  const hideChrome = blank && composerPhase === 'blank' && viewId === DEFAULT_VIEW_ID
  const headerRef = useRef<HTMLElement>(null)
  const [editing, setEditing] = useState(false)

  // The scrollport's top padding follows the strip's height, so the first
  // message (or the terminal's first row) starts below the title.
  useLayoutEffect(() => {
    const header = headerRef.current
    const root = header?.parentElement
    if (header === null || root === null || root === undefined) return
    const write = (): void => {
      root.style.setProperty('--dsh-session-header-height', `${String(Math.round(header.getBoundingClientRect().height))}px`)
    }
    write()
    // jsdom and older embedders ship no ResizeObserver; the first measure stands there.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(write)
    observer.observe(header)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--dsh-session-header-height')
    }
  }, [])

  useEffect(() => { setEditing(false) }, [sessionId])

  // A chat with no title of its own says what it is ("Terminal", "New chat")
  // instead of its folder's name, which the project context already gives.
  const ownTitle = useSessions(s => s.byId[sessionId]?.title)
  const title = ownTitle ?? (viewId === 'terminal' ? t('session.untitledTerminal') : t('session.untitled'))
  const parents = ancestry.slice(0, -1)

  const commit = (next: string): void => {
    setEditing(false)
    const trimmed = next.trim()
    if (trimmed === '' || trimmed === title) return
    void rename(sessionId, trimmed)
  }

  return (
    <header
      ref={headerRef}
      className={clsx(css.header, hideChrome && css.headerHidden)}
      data-view={viewId}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <div className={css.titleRow}>
          <div className={css.titleCluster}>
            {parents.length > 0 && (
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {parents.map(summary => (
                  <span key={summary.id} className={css.crumbSeg}>
                    <button type="button" className={css.crumb} onClick={() => { open(summary.id) }}>
                      {summary.displayTitle}
                    </button>
                    <span className={css.crumbSep}>/</span>
                  </span>
                ))}
              </nav>
            )}
            <h1 className={css.title} data-session-title="">
              {editing
                ? (
                  <input
                    className={css.titleInput}
                    data-session-title-part="name"
                    aria-label={t('session.rename')}
                    defaultValue={title}
                    autoFocus
                    onFocus={(event) => { event.currentTarget.select() }}
                    onBlur={(event) => { commit(event.currentTarget.value) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit(event.currentTarget.value)
                      else if (event.key === 'Escape') setEditing(false)
                    }}
                  />
                )
                : (
                  <button
                    type="button"
                    className={css.titleName}
                    data-session-title-part="name"
                    title={t('session.rename')}
                    onClick={() => { setEditing(true) }}
                  >
                    {title}
                  </button>
                )}
              {/* A real space between the runs, so the title reads as one phrase to a screen reader; the flex gap draws it. */}
              {' '}
              <span className={css.titleContext}>{renderSlot('conversation.session.header.context', {})}</span>
            </h1>
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

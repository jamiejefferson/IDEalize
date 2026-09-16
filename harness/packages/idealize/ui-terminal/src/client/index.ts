/**
 * Chat⇄Terminal toggle, browser half. When the host reports an embedded
 * terminal (the desktop shell), this plugin adds a `terminal` entry to the
 * conversation view ring (the ring's tabs are the visible switch) and an
 * invisible occupant of the session header's action group that binds ⌘J to
 * the chat store's active view. Browsers without the desktop shell register
 * nothing. Wherever the appearance service is composed, the grid follows its
 * Terminal section (`ctx.appearance.terminalPaint()`, re-read on store
 * changes); without it the grid sits on the page's alias tokens. A
 * `terminalMode` service exposes the same probe answer plus `open(sessionId)`
 * and `restart(sessionId, brainId)`, so other plugins (the welcome card's
 * Terminal launch, the composer's brain menu) flip a chat onto the terminal, or
 * replace its shell with one running another brain, without owning the ring.
 * The service also carries `Pane`, the same grid over one plain shell (no
 * launch command, no chat) for the tool rail's Terminal pane; the rail plugin
 * cannot import the component (bundle purity), so the service is the channel.
 *
 * This view owns its whole column and carries its own input, so on a still
 * blank chat it retires the conversation composer from its own stylesheet,
 * matching the active view id ui-conversation publishes on `data-blank-view`.
 * Views whose prompts go through the composer (Gallery, Sound Stage) keep it.
 */
import type React from 'react'
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ui-conversation SlotMap merge (the view ring + header seats).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the ctx.appearance Context merge (the client bundle purity gate
// forbids cross-plugin value imports; the service is the channel).
import type {} from '@idealize/appearance/client'
import { CHAT_VIEW, ModeShortcut, TERMINAL_VIEW } from './ModeShortcut.tsx'
import { applyTerminalPaint, closeTerminal, disposeTerminals, restartTerminal, TerminalView } from './TerminalView.tsx'
import { en, NS, type TerminalKey, zh } from './locales.ts'
import { createTerminalPane, type TerminalPaneProps } from './TerminalPane.tsx'

export { ModeShortcut, isToggleShortcut, toggledView } from './ModeShortcut.tsx'
export {
  applyTerminalPaint, currentTerminalPaint, httpTransport, reservedGutter, restartTerminal, TerminalView, withAlpha, xtermTheme,
} from './TerminalView.tsx'
export type { TerminalTransport, StreamEvent } from './TerminalView.tsx'
export type { TerminalKey } from './locales.ts'
export { createTerminalPane, PANE_KEY } from './TerminalPane.tsx'
export type { TerminalPaneProps } from './TerminalPane.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The toggle's copy. */
    'idealize-terminal': TerminalKey
  }
}

/**
 * Required services: the slot registry, copy, session rows (for the chat's
 * directory), and the workspaces list (archiving a Terminal chat ends its shell).
 */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/** The capability probe's answer shape. */
export interface TerminalCapabilities {
  embedded: boolean
}

/**
 * Ask the host whether an embedded terminal exists here.
 * @param fetchImpl - the fetch to use; injected for tests.
 * @returns the capabilities; a failed or non-OK request reads as `embedded: false`.
 */
export async function probeCapabilities(fetchImpl: typeof fetch = fetch): Promise<TerminalCapabilities> {
  try {
    const response = await fetchImpl('/idealize/terminal/capabilities')
    if (!response.ok) return { embedded: false }
    const body = await response.json() as Partial<TerminalCapabilities>
    return { embedded: body.embedded === true }
  } catch {
    return { embedded: false }
  }
}

/** Chat-store write used by the view switch (restated from ui-conversation's action set). */
interface ChatViewActions {
  setView(view: string): void
}

/** The renderer host face's store resolver (the framework's per-session instance cache). */
interface ErasedStoreHost {
  storeOf(
    entry: { options: { id?: string }; store?: unknown },
    scopeKey?: string,
  ): { actions: ChatViewActions } | undefined
}

/** Type-erased slot registry face used where the typed overloads cannot see a foreign store. */
export interface ErasedSlots {
  entries(key: string): readonly { options: { id?: string }; store?: unknown }[]
  subscribe(key: string, fn: () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, fn: () => () => void): void
  /** SlotRegistry's renderer host face (TS-private; no public seam resolves a per-session store instance). */
  hostFace(): ErasedStoreHost
}

/** The chat view entry (its `store` is ui-conversation's shared per-session chat store handle), once registered. */
function chatEntry(slots: ErasedSlots): { options: { id?: string }; store?: unknown } | undefined {
  return slots.entries('conversation.view').find(entry => entry.options.id === CHAT_VIEW)
}

/**
 * Switch one chat's conversation ring to the Terminal view by writing the
 * chat store's `view` through the framework's per-session instance cache
 * (`hostFace().storeOf` — the instance the rendered ring reads; a fresh
 * `handle.create()` would make a parallel instance the ring never sees).
 * @param slots - the erased slot registry.
 * @param sessionId - the chat whose ring flips.
 * @returns whether the chat entry existed and the switch was written.
 */
export function openTerminalView(slots: ErasedSlots, sessionId: string): boolean {
  const entry = chatEntry(slots)
  if (entry?.store === undefined) return false
  const instance = slots.hostFace().storeOf(entry, sessionId)
  if (instance === undefined) return false
  instance.actions.setView(TERMINAL_VIEW)
  return true
}

/** The Chat⇄Terminal service other plugins launch the terminal through. */
export interface TerminalModeHost {
  /**
   * Whether this host serves an embedded terminal (the memoized capability
   * probe — the same answer that gated the ring entry).
   * @returns the probe's answer.
   */
  embedded(): Promise<boolean>
  /**
   * Switch the session's conversation ring to the Terminal view.
   * @param sessionId - the chat whose ring flips.
   * @returns whether the switch was written (false until the ring exists).
   */
  open(sessionId: string): boolean
  /**
   * Restart the chat's shell on another brain: close the running shell and
   * reopen it on that brain's launch command.
   *
   * The scrollback and whatever the running agent held in context are lost, so
   * the caller must have confirmed with the user before calling this. Callers
   * that only want to know whether a switch would cost anything compare the
   * commands from `GET /idealize/terminal/launches` themselves.
   * @param sessionId - the chat whose shell restarts.
   * @param brainId - the agent preset id whose launch command the fresh shell gets.
   * @returns once the old shell is gone and the reopen has been asked for.
   */
  restart(sessionId: string, brainId: string): Promise<void>
  /**
   * The grid over one plain shell, for a pane outside the conversation
   * column (the tool rail's Terminal pane). One shell for the whole app,
   * keyed `idealize-terminal-pane`; it survives the pane's unmounts, so closing and
   * reopening the pane reattaches to the same scrollback. Render it only
   * where `embedded()` answered true.
   * @param props - the directory the shell starts in.
   * @returns the grid.
   */
  Pane: (props: TerminalPaneProps) => React.JSX.Element
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    terminalMode: TerminalModeHost
  }
}

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-terminal: dictionaries')
  ctx.effect(() => () => { disposeTerminals() }, 'idealize-terminal: grids')
  // Archiving a Terminal chat is how it closes: the row leaves the sidebar,
  // so the shell it owned ends with it rather than running on unseen.
  ctx.effect(() => {
    let seen = new Set<string>(ctx.workspaces.list.getSnapshot().archivedSessionIds)
    return ctx.workspaces.list.subscribe(() => {
      const next = ctx.workspaces.list.getSnapshot().archivedSessionIds
      for (const id of next) {
        if (!seen.has(id)) void closeTerminal(id).catch(() => undefined)
      }
      seen = new Set(next)
    })
  }, 'idealize-terminal: archived chats close their shells')
  const t = ctx.locale.bind(NS)
  const slots = ctx.slots as unknown as ErasedSlots
  // The host session service merges the same name into Context in this
  // two-faced program; the client face is the one this plugin injects.
  const sessions = ctx.sessions as unknown as ISessions

  // The appearance panel's Terminal section drives every grid while the
  // service is composed; leaving (or missing) it returns the page-token look.
  ctx.inject(['appearance'], (scoped) => {
    const push = (): void => { applyTerminalPaint(scoped.appearance.terminalPaint()) }
    scoped.effect(() => {
      push()
      const stop = scoped.appearance.store.subscribe(push)
      return () => {
        stop()
        applyTerminalPaint(undefined)
      }
    }, 'idealize-terminal: appearance paint')
  })

  let live = true
  ctx.effect(() => () => { live = false }, 'idealize-terminal: probe lifetime')

  // One probe feeds both the ring registration and the service, so the
  // welcome card's Terminal segment and the view it opens always agree.
  const probed = probeCapabilities()
  ctx.provide('terminalMode', {
    embedded: () => probed.then(capabilities => capabilities.embedded),
    open: (sessionId: string) => openTerminalView(slots, sessionId),
    restart: (sessionId: string, brainId: string) => restartTerminal(sessionId, brainId),
    Pane: createTerminalPane(t),
  })

  void probed.then((capabilities) => {
    if (!live || !capabilities.embedded) return

    // The terminal face of a chat: the view ring's second entry.
    slots.inject('conversation.view', () => slots.register({
      name: 'conversation.view',
      id: 'terminal',
      order: 5,
      locale: NS,
      label: () => t('view.terminal'),
      inject: (sessionId: SessionId) => ({
        cwd: sessions.list.getSnapshot().byId[sessionId]?.cwd,
        // The chat's activity preset (the pill it launched on) selects the
        // fresh shell's launch command on the host.
        activity: sessions.list.getSnapshot().byId[sessionId]?.agentPreset,
      }),
    }, TerminalView))

    // The shortcut shares the chat entry's store so it can move the ring's
    // active view. The chat entry registers when the ring is declared; wait
    // for it when this runs first.
    slots.inject('conversation.session.header.actions', () => {
      let dispose: (() => void) | undefined
      let unsubscribe: (() => void) | undefined
      const tryRegister = (): void => {
        const store = chatEntry(slots)?.store
        if (store === undefined || dispose !== undefined) return
        unsubscribe?.()
        unsubscribe = undefined
        dispose = slots.register({
          name: 'conversation.session.header.actions',
          id: 'idealize-mode-shortcut',
          order: 100,
          locale: NS,
          store,
        }, ModeShortcut)
      }
      tryRegister()
      if (dispose === undefined) unsubscribe = slots.subscribe('conversation.view', tryRegister)
      return () => {
        unsubscribe?.()
        dispose?.()
        dispose = undefined
      }
    })
  })
}

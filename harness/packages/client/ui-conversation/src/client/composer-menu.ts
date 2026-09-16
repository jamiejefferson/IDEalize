/**
 * The composer's "+" menu: one place for everything a person adds to a chat
 * (JJ, 15 Sep 2026, on the plus and the paperclip: "could we look to
 * integrate them in the same way as claude does?"). The bar renders "Add
 * files or photos" and the slash-command launcher itself; every other row
 * comes from a plugin through `ctx.composerMenu`, so Skills, Connectors and
 * Plugins live with the packages that know them and the bar knows none.
 *
 * An entry with `rows` is a submenu read each time the menu opens (a promise
 * shows a loading row until it settles); one without is itself the pick. A
 * pick reaches the entry with the session and, for a row, that row's id.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/composer-menu
 */

import type { ReactNode } from 'react'
import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** The chat a pick lands in, with the one write a contributor needs. */
export interface ComposerMenuSession {
  sessionId: SessionId
  /** Append text to the draft, after a space when the draft does not already end in one. */
  insertText(text: string): void
}

/** One submenu row. */
export interface ComposerMenuRow {
  id: string
  label: string
  disabled?: boolean
  /** A section heading among the rows: rendered as a label after a hairline, never picked; the empty row counts only pickable rows. */
  heading?: boolean
  /** Extra text the submenu search matches besides the label (a description). */
  keywords?: string
}

/** One top-level entry a plugin contributes. */
export interface ComposerMenuEntry {
  id: string
  /** Entries sort ascending by this; ties keep registration order. */
  order: number
  label: string
  icon?: ReactNode
  /** Submenu rows, read when the menu opens; absent means the entry itself is the pick. */
  rows?: (session: ComposerMenuSession) => readonly ComposerMenuRow[] | Promise<readonly ComposerMenuRow[]>
  /** True when the entry offers the command catalogue itself; the bar then omits its own Commands row. */
  commands?: boolean
  /** True to put a search field at the top of the submenu (rows filtered by label and keywords). */
  search?: boolean
  /**
   * The pick.
   * @param session - the chat the menu belongs to.
   * @param row - the chosen row's id, or undefined for an entry without rows.
   */
  onSelect: (session: ComposerMenuSession, row: string | undefined) => void
}

/** The registry the composer reads and plugins write. */
export interface ComposerMenuContract {
  /** Every registered entry, sorted. */
  readonly entries: ObservableSnapshot<readonly ComposerMenuEntry[]>
  /**
   * Add one entry for as long as the returned disposer is not called.
   * @param entry - the entry; a duplicate id throws.
   * @returns the disposer removing it.
   */
  register(entry: ComposerMenuEntry): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    composerMenu: ComposerMenuContract
  }
}

/**
 * Create the registry.
 * @returns an empty registry.
 */
export function createComposerMenu(): ComposerMenuContract {
  const registered: ComposerMenuEntry[] = []
  let sorted: readonly ComposerMenuEntry[] = []
  const listeners = new Set<() => void>()
  const publish = (): void => {
    sorted = [...registered].sort((a, b) => a.order - b.order)
    for (const listener of listeners) listener()
  }
  return {
    entries: {
      getSnapshot: () => sorted,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    register(entry) {
      if (registered.some(existing => existing.id === entry.id)) {
        throw new Error(`composer menu: duplicate entry "${entry.id}"`)
      }
      registered.push(entry)
      publish()
      return () => {
        const index = registered.indexOf(entry)
        if (index === -1) return
        registered.splice(index, 1)
        publish()
      }
    },
  }
}

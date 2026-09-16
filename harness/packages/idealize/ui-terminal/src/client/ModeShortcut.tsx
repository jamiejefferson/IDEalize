/**
 * The Chat⇄Terminal shortcut: ⌘J (Ctrl+J elsewhere) flips the chat's surface
 * between the bubbles and the live terminal by selecting the matching
 * `conversation.view` entry. It renders nothing — the view ring's own tabs
 * (Chat | Terminal | Trajectory) are the visible control; this occupant of
 * the header's action seat exists to share the chat store's bound actions.
 */
import { useCallback, useEffect } from 'react'

/** The view ids the shortcut moves between. */
export const CHAT_VIEW = 'chat'
export const TERMINAL_VIEW = 'terminal'

/** Next view for a toggle from the given one (anything other than the terminal reads as chat). */
export function toggledView(current: string | null | undefined): string {
  return current === TERMINAL_VIEW ? CHAT_VIEW : TERMINAL_VIEW
}

/** True for V0's shortcut: ⌘J on macOS, Ctrl+J elsewhere; never with Shift/Alt. */
export function isToggleShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  if (event.altKey || event.shiftKey) return false
  if (!(event.metaKey || event.ctrlKey)) return false
  return event.key === 'j' || event.key === 'J'
}

/** Props the shortcut reads: the chat store's view plus its writer. */
export interface ModeShortcutProps {
  useStore: <T>(selector: (state: { view: string | null }) => T) => T
  actions: { setView: (view: string) => void }
}

/**
 * The invisible shortcut listener.
 * @param props - store hooks.
 * @returns nothing renders.
 */
export function ModeShortcut({ useStore, actions }: ModeShortcutProps) {
  const view = useStore(state => state.view)

  const toggle = useCallback(() => {
    actions.setView(toggledView(view))
  }, [actions, view])

  // ⌘J from anywhere in the window, including inside the terminal grid
  // (capture phase, so xterm's own key handling never swallows it).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isToggleShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      toggle()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [toggle])

  return null
}

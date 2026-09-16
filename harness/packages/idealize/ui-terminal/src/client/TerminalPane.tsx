/**
 * The plain terminal pane: the same xterm.js grid as the chat's Terminal
 * view, over one bare shell that belongs to no chat. The tool rail opens it
 * in the drawer column for running commands beside a chat. The shell is keyed
 * {@link PANE_KEY} rather than a session id, so the host types no launch
 * command into it and the activity watcher never counts its output as an
 * agent's run. The grid is cached like every other (`TerminalView`'s
 * attachments), so closing the pane keeps the shell and its scrollback, and
 * the appearance panel's Terminal section paints it like the main view.
 */
import type React from 'react'
import { TerminalView, type TerminalTransport, type TerminalViewProps } from './TerminalView.tsx'
import css from './TerminalPane.module.css'

/** The one plain shell's key on the host (one pane shell for the whole app). */
export const PANE_KEY = 'idealize-terminal-pane'

/** Props the pane takes from whoever seats it. */
export interface TerminalPaneProps {
  /** The directory the shell starts in the first time it opens; undefined is home. */
  cwd: string | undefined
  /** The host routes by default; swapped in tests. */
  transport?: TerminalTransport
}

/**
 * Bind the pane component to this plugin's copy.
 * @param t - the `idealize-terminal` translate.
 * @returns the pane component.
 */
export function createTerminalPane(t: TerminalViewProps['t']): (props: TerminalPaneProps) => React.JSX.Element {
  return function TerminalPane({ cwd, transport }: TerminalPaneProps) {
    return (
      <div className={css.root} data-terminal-pane="">
        <TerminalView sessionId={PANE_KEY} cwd={cwd} plain {...(transport === undefined ? {} : { transport })} t={t} />
      </div>
    )
  }
}

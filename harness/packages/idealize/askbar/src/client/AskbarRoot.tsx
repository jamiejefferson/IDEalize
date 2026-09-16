/**
 * The floating home: the Askbar window's whole surface. The root owns what
 * only a separate window needs — the drag region (the bar's background is the
 * window's handle; every control opts out, so a drag never starts on a chip)
 * and the transform back to the main window — and renders the shared `Rail`
 * inside it.
 * @module @idealize/askbar/src/client/AskbarRoot
 */

import React, { useCallback, useRef, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AskbarStore } from './askbar-store.ts'
import styles from './Askbar.module.css'
import { Rail } from './Rail.tsx'

export { OWL_SRC } from './Rail.tsx'

/**
 * The bar's own window width (`ASKBAR_WIDTH` in dsh-plugin-desktop, and
 * `.bar` in this package's sheet; restated because neither is importable
 * here).
 */
export const BAR_WINDOW_WIDTH = 108

/** The window width while a panel shows: the column, an 8px gap, the 300px panel, and 4px clear of the far edge. */
export const PANEL_WINDOW_WIDTH = BAR_WINDOW_WIDTH + 8 + 300 + 4

/** What the slot registration hands the root. */
export interface AskbarRootInjected {
  /** The observable bar view (the project it follows rides in the view). */
  store: AskbarStore
}

/** Root props: the injected store plus the bar's locale seat. */
export type AskbarRootProps = AskbarRootInjected & PropsLocale<'idealize-askbar'>

/**
 * Render the floating bar.
 * @param props - the injected store and locale seat.
 * @returns the dock column.
 */
export function AskbarRoot(props: AskbarRootProps): React.JSX.Element {
  const { store, t } = props
  const view = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
  const { project, roster } = view
  const edge = roster === null ? 'left' : roster.config.edge

  /**
   * Expand to the main window; `open` also asks it for the Studio chat (the
   * Studio entry and the panel foot) or for a new chat (the bar's New chat),
   * relayed over the host bridge feed with this project as context when one
   * is open (the Studio spans every project, so it opens without one).
   */
  const transform = (open?: 'studio' | 'new'): void => {
    void fetch('/idealize/askbar/transform', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ to: 'maxi', ...open === undefined ? {} : { open, ...project === '' ? {} : { project } } }),
    }).catch(() => {
      // Network failure only: the bar stays as it is and the control can be pressed again.
    })
  }

  // A panel is 300px and the column is 108px, so in the window as it docks a
  // panel was cut off at its edge (JJ, 13 Sep 2026: "the pop-outs are
  // cropped"). The window grows while one shows and gives the room back when
  // it goes; the column keeps its screen edge, so nothing moves under the
  // pointer. A composition with no desktop shell answers 501 and the bar is a
  // browser tab, where the panel had room all along.
  const heldWidth = useRef(BAR_WINDOW_WIDTH)
  const onPanelChange = useCallback((showing: boolean): void => {
    const width = showing ? PANEL_WINDOW_WIDTH : BAR_WINDOW_WIDTH
    // The rail reports on every render that changes the panel; only a change
    // of width is worth a round trip, and the docked width is already held.
    if (width === heldWidth.current) return
    heldWidth.current = width
    void fetch('/idealize/askbar/width', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ width }),
    }).catch(() => {
      // Network failure only: the window stays as it is and the panel renders clipped.
    })
    // The keyboard comes with the room: a rollover's panel can be typed into
    // without a click, and a closed panel hands the keyboard back to the app
    // the person was in (JJ, 14 Sep 2026).
    void fetch('/idealize/askbar/focus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ focus: showing }),
    }).catch(() => undefined)
  }, [])

  return (
    // The bar is the sidebar's surface: an appearance setting for the sessions
    // column (fill, font) paints the floating home the same way.
    <div className={styles['bar']} data-askbar-bar='' data-edge={edge} data-idealize-surface='sessions'>
      <Rail view={view} home='floating' onOpenMain={transform} onPanelChange={onPanelChange} t={t} />
    </div>
  )
}

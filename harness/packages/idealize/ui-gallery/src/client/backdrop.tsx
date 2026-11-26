/**
 * The Studio backdrop behind the media Studio chat. `@idealize/ui-studio`
 * owns the backdrop and offers its layers as the `studioBackdrop` service;
 * the plugin body hands that component here, and the view seats it behind the
 * whole chat column (title strip, grid and message box). Without the service
 * nothing is drawn and the chat sits on the app theme.
 * @module @idealize/ui-gallery/client/backdrop
 */

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import css from './GalleryView.module.css'

const store = createSnapshotStore<{ Layers: ComponentType | undefined }>({ Layers: undefined })

/**
 * Take the component that draws the current backdrop's layers.
 * @param Layers - the `studioBackdrop` service's component, or undefined when the service leaves.
 */
export function setBackdropLayers(Layers: ComponentType | undefined): void {
  store.update((draft) => { draft.Layers = Layers })
}

/** The chat column the conversation frame draws: it holds the title strip, the view and the message box. */
const COLUMN = '[data-idealize-surface="chat"]'
/** The seat the conversation frame keeps at the foot of the column for the message box and the stats line. */
const SEAT = '[data-composer-seat]'
/** The title strip the conversation frame floats over the head of the column. */
const STRIP = 'header[data-view]'

/**
 * Size a frame to the chat column's own box, so layers drawn in it land
 * exactly over the column's layers. The frame is placed against its parent,
 * which the stylesheet extends above the seat for the fade.
 * @param column - the chat column.
 * @param frame - the frame to place.
 */
function alignToColumn(column: Element, frame: HTMLElement): void {
  const outer = column.getBoundingClientRect()
  const inner = (frame.parentElement ?? frame).getBoundingClientRect()
  frame.style.left = `${String(outer.left - inner.left)}px`
  frame.style.top = `${String(outer.top - inner.top)}px`
  frame.style.width = `${String(outer.width)}px`
  frame.style.height = `${String(outer.height)}px`
}

/**
 * The backdrop for one media Studio chat. It renders a marker inside the view
 * to find the chat column, then draws the layers into that column, under
 * everything else in it.
 *
 * The grid scrolls under the message box, and the box is see-through on a
 * backdrop, so tiles showed through it (JJ, 26 Nov 2026). A second copy of
 * the layers is drawn in the box's seat, placed over the column's copy, so
 * the seat shows the same wall and floor and covers what scrolls beneath. The
 * copy starts 36px above the seat and fades in across that band, so a tile
 * fades out before it reaches the box.
 *
 * The grid also scrolls under the title strip, which is see-through on a
 * backdrop: a light tile behind a light title left it unreadable (measured at
 * 2.4:1, 26 Nov 2026). A third copy is drawn in the strip, behind the title;
 * the strip's own mask fades it out along its lower edge.
 * @returns the marker and, once the column is found, the layers.
 */
export function GalleryBackdrop() {
  const Layers = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot().Layers)
  const marker = useRef<HTMLSpanElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const titleFrame = useRef<HTMLDivElement | null>(null)
  const [column, setColumn] = useState<Element | null>(null)
  const [seat, setSeat] = useState<Element | null>(null)
  const [strip, setStrip] = useState<Element | null>(null)
  useLayoutEffect(() => {
    const found = marker.current?.closest(COLUMN) ?? null
    setColumn(found)
    setSeat(found?.querySelector(SEAT) ?? null)
    setStrip(found?.querySelector(STRIP) ?? null)
  }, [])
  const drawn = Layers !== undefined
  useLayoutEffect(() => {
    if (!drawn || column === null || seat === null) return
    const align = (): void => {
      if (frame.current !== null) alignToColumn(column, frame.current)
      if (titleFrame.current !== null) alignToColumn(column, titleFrame.current)
    }
    align()
    if (typeof ResizeObserver === 'undefined') return
    const sizes = new ResizeObserver(align)
    sizes.observe(column)
    sizes.observe(seat)
    if (strip !== null) sizes.observe(strip)
    // The seat moves when the chat leaves its opening layout, without either box changing size.
    const phases = new MutationObserver(align)
    phases.observe(column, { attributes: true, attributeFilter: ['data-phase'] })
    return () => { sizes.disconnect(); phases.disconnect() }
  }, [drawn, column, seat, strip])
  return (
    <>
      <span ref={marker} hidden data-gallery-backdrop-marker="" />
      {Layers !== undefined && column !== null && createPortal(
        <div className={css.backdropSeat} data-gallery-backdrop=""><Layers /></div>,
        column,
      )}
      {Layers !== undefined && column !== null && seat !== null && createPortal(
        <div className={css.backdropUnderBox} data-gallery-backdrop-under-box="">
          <div ref={frame} className={css.backdropUnderBoxFrame}><Layers /></div>
        </div>,
        seat,
      )}
      {Layers !== undefined && column !== null && strip !== null && createPortal(
        <div className={css.backdropUnderTitle} data-gallery-backdrop-under-title="">
          <div ref={titleFrame} className={css.backdropUnderBoxFrame}><Layers /></div>
        </div>,
        strip,
      )}
    </>
  )
}

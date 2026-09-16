/**
 * Column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details | aside | rail | deck | drawer, under a top banner strip and over a
 * bottom dock strip; the rail rides the inner edge of whichever deck/drawer
 * columns are open), the drag handles
 * (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay' | 'shell.banner' | 'shell.drawer' | 'shell.deck' | 'shell.dock' | 'shell.rail' | 'shell.aside'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/** Drawer column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DrawerColumn(props: { children?: ReactNode }) {
  return <div className={css.drawerCol} data-idealize-surface="files">{props.children}</div>
}

/** Deck column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DeckColumn(props: { children?: ReactNode }) {
  return <div className={css.deckCol} data-idealize-surface="doc">{props.children}</div>
}

/**
 * Rail column grid item: an auto-sized track between details and the deck, so
 * the rail rides the inner (left) edge of whichever right-side panes are open
 * while the deck/drawer content sits flush against the window edge. With both
 * closed their tracks are 0 wide and the rail lands on the window edge. Its
 * measured width is taken off the concession viewport.
 */
function RailColumn(props: { railRef: React.Ref<HTMLDivElement>; children?: ReactNode }) {
  return <div ref={props.railRef} className={css.railCol}>{props.children}</div>
}

/**
 * The aside: an auto track immediately left of the rail, sized by whatever
 * occupies it. Like the rail it is fixed content rather than a party to the
 * column solve, so its measured width leaves the concession viewport.
 * @param props - the measurement ref and the slot's rendered occupant.
 * @returns the aside track.
 */
function AsideColumn(props: { asideRef: React.Ref<HTMLDivElement>; children?: ReactNode }) {
  return <div ref={props.asideRef} className={css.asideCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details' | 'deck' | 'drawer'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const asideRef = useRef<HTMLDivElement | null>(null)
  const [frameWidth, setFrameWidth] = useState(() => window.innerWidth)
  const [railWidth, setRailWidth] = useState(0)
  const [asideWidth, setAsideWidth] = useState(0)
  // Viewport px per layout px. The appearance plugin zooms `#root`, so a
  // pointer's clientX moves in viewport px while the columns and the handles
  // are laid out in the frame's own px; drags divide by this.
  const zoom = useRef(1)
  // The concession viewport is the frame minus the rail and the aside: both
  // are fixed content, never a party to the column solve.
  const viewport = Math.max(0, frameWidth - railWidth - asideWidth)
  // The narrow breakpoint reads the window, not what the aside left of it. An
  // occupied aside is a panel the person opened; collapsing the projects
  // sidebar because a task list appeared would answer one request by undoing
  // another. The solve above still counts the aside, so the columns fit.
  const breakpointViewport = Math.max(0, frameWidth - railWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window), the rail's and the aside's:
  // one rAF-throttled ResizeObserver over all three.
  useEffect(() => {
    const el = frameRef.current
    const rail = railRef.current
    const aside = asideRef.current
    /* v8 ignore next -- the refs are always attached by effect time: all three divs render unconditionally. */
    if (el === null || rail === null || aside === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        // Layout px, not the bounding rect: under a CSS zoom on an ancestor
        // the rect is scaled and the grid tracks are not, and the handles
        // are placed in track px.
        const width = el.offsetWidth
        if (width > 0) {
          setFrameWidth(width)
          const rendered = el.getBoundingClientRect().width
          zoom.current = rendered > 0 ? rendered / width : 1
        }
        setRailWidth(rail.offsetWidth)
        setAsideWidth(aside.offsetWidth)
      })
    })
    observer.observe(el)
    observer.observe(rail)
    observer.observe(aside)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = breakpointViewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const cols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details, panels.drawer, panels.deck)
  const colsRef = useRef(cols)
  colsRef.current = cols
  // The rendered sidebar state: collapsed by preference/breakpoint, or by the
  // solver's rail concession under an open deck/drawer (columns.ts step 4).
  // An open sidebar never solves below SIDEBAR_MIN, so equality is exact.
  const sidebarRail = cols.sidebar === SIDEBAR_COLLAPSED

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const deckBase = useRef(0)
  const drawerBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onDeckStart = useCallback(() => { deckBase.current = colsRef.current.deck; setDragging(true) }, [])
  const onDrawerStart = useCallback(() => { drawerBase.current = colsRef.current.drawer; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    dx /= zoom.current
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    dx /= zoom.current
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const onDeckDrag = useCallback((dx: number) => {
    dx /= zoom.current
    actions.setDeck(deckBase.current - dx)
  }, [actions])
  const onDrawerDrag = useCallback((dx: number) => {
    dx /= zoom.current
    actions.setDrawer(drawerBase.current - dx)
  }, [actions])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px auto ${cols.deck}px auto ${cols.drawer}px` }}
      data-sidebar-collapsed={sidebarRail || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-deck-collapsed={cols.deck === 0 || undefined}
      data-drawer-collapsed={cols.drawer === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      {/* Strip above every column, the rail track included: banner content owns its ground. */}
      <div className={css.bannerRow} data-shell-banner>
        {renderSlot('shell.banner', {})}
      </div>
      <div className={css.sidebarCol} data-idealize-surface="sessions">
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). */}
        {renderSlot('sidebar', {
          collapsed: sidebarRail,
          width: cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
        <AsideColumn asideRef={asideRef}>{renderSlot('shell.aside', {})}</AsideColumn>
        {/* The document pane opens on the conversation's side of the rail, so
            the tool rail keeps the same screen position whether a document is
            open or not (JJ, 10 Sep 2026). The drawer stays beyond the rail. */}
        <DeckColumn>{renderSlot('shell.deck', {})}</DeckColumn>
        <RailColumn railRef={railRef}>{renderSlot('shell.rail', {})}</RailColumn>
        <DrawerColumn>{renderSlot('shell.drawer', {})}</DrawerColumn>
      </>
      {/* Strip under every column, the rail track included: dock content owns its ground. */}
      <div className={css.dockRow} data-shell-dock>
        {renderSlot('shell.dock', {})}
      </div>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!sidebarRail && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {/* Every handle offsets from the frame width, because the columns it
          measures sit at the window edge. Each one sits on its own column's
          left border, which is the border a person sees and the one that
          moves when they drag (JJ, 2026-08-28 and again 1 Sep 2026: "there
          are drag handles but they're misplaced"). The drawer's therefore
          sits right of the rail rather than left of it: with a document open
          the rail's left border is the DOCUMENT's right edge, and a handle
          there moved the wrong pane. Nothing resizes the rail, so its left
          border carries no handle at all. The details border is rail-free
          arithmetic either way: frameWidth − rail − aside − details − deck −
          drawer ≡ viewport − details − deck − drawer. */}
      {cols.details > 0 && <DragHandle side="details" left={viewport - cols.details - cols.deck - cols.drawer} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
      {cols.deck > 0 && <DragHandle side="deck" left={frameWidth - railWidth - cols.deck - cols.drawer} onStart={onDeckStart} onDrag={onDeckDrag} onEnd={onDragEnd} />}
      {cols.drawer > 0 && <DragHandle side="drawer" left={frameWidth - cols.drawer} onStart={onDrawerStart} onDrag={onDrawerDrag} onEnd={onDragEnd} />}
    </div>
  )
}

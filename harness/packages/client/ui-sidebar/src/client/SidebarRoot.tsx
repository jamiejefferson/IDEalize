/**
 * Sidebar shell: column geometry only. Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts and the four upper
 * controls enter the 56px rail from the same horizontal offset (one icon each,
 * same top-down order) on one fade that ends with the slide. The bottom-pinned
 * settings control only fades. The workspace/session browsing region between
 * the New Session button and the foot is the `sidebar.workspaces` registrant's;
 * while the column is collapsed and `sidebar.rail` is occupied, that seat's
 * registrant takes the region instead. The foot holds `sidebar.settings` plus
 * `sidebar.footer.action`; the shell hands them the wide flag (plus an expand
 * request callback for the browser and the rail).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  BrandMark,
  IconNewChatOutline16, IconPanelLeftOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  useRailOccupied,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  const railOccupied = useRailOccupied()
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  return (
    <div
      ref={column}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading, !pointerInside && css.quietBars,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      <div className={css.logoRow}>
        {/* Expanded: the square logo card presides top-left; the collapse
            toggle and the labelled New-chat control stack down the right
            edge, glyphs flush with it (Paper "Projects rail"). */}
        {wide && <BrandMark className={css.brandCard} size={58} />}
        <div className={css.headerControls}>
          {/* The top row: window-level controls other plugins add (the
              desktop mini-mode toggle) sit left of the collapse toggle, so
              they read with it rather than in a tool rail (JJ, 2026-08-28).
              The row is 70px, so the stack holds two rows only. */}
          <div className={css.headerTopRow}>
            {wide && renderSlot('sidebar.header.action', { wide })}
            {/* Rail resting state is the mark; hovering swaps in the panel
                icon (the expand affordance, figma sidebar-hover flow). */}
            <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
              <button
                type="button"
                className={clsx(css.iconButton, css.toggle)}
                aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
                onClick={() => { toggleSidebar() }}
              >
                {/* The rail carries the same 58px logo card as the wide header
                    (JJ, 15 Sep 2026: "it can fit at the same size as in the
                    regular view"); hovering swaps in the expand affordance. */}
                {!wide && <BrandMark className={css.railCard} size={58} />}
                {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
                <IconPanelLeftOutline16 className={css.panelIcon} size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          </div>
          {wide && (
            <Tooltip label={t('session.new.label')} delayMs={500}>
              <button
                type="button"
                className={clsx(css.iconButton, css.newChat)}
                aria-label={t('session.new.label')}
                onClick={() => { startSession() }}
              >
                <IconNewChatOutline16 size={16} />
                <span className={css.newChatLabel}>{t('session.new')}</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* The rail keeps its compact New-chat icon; expanded, the header icon
          under the collapse toggle carries the action. */}
      {!wide && (
        <Tooltip label={t('session.new.label')} delayMs={500}>
          <button
            type="button"
            className={css.newSession}
            aria-label={t('session.new.label')}
            onClick={() => { startSession() }}
          >
            <IconNewChatOutline16 size={18} />
          </button>
        </Tooltip>
      )}

      {/* The browsing region fills the column between the controls and the
          foot in both states. Collapsed, an occupied rail seat takes the
          region; otherwise the browser's own icon column rides the same slot
          it rides wide, so a composition without a rail never remounts it. */}
      <div className={css.regionArea}>
        {!wide && railOccupied
          ? renderSlot('sidebar.rail', { expandSidebar: () => { toggleSidebar() } })
          : renderSlot('sidebar.workspaces', {
            wide,
            expandSidebar: () => { if (collapsed) toggleSidebar() },
          })}
      </div>

      {/* Footer actions stack above Settings in both sidebar widths. */}
      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
      </div>
    </div>
  )
}

/**
 * The composer's overflow control: a three-dot button on the tool row that
 * holds the two settings which belong to the chat rather than to the work in
 * front of the user — the project's access mode and this chat's brain.
 *
 * Both used to sit on the row as chips, at opposite ends, beside whatever
 * settings the active space added (aspect, resolution, duration, count). On a
 * media space the row read as one undifferentiated line of controls (JJ, 9 Sep
 * 2026: "the main ask bar settings is a mess"). The row now carries the
 * space's own settings, and the two standing choices live one click away.
 *
 * The access control is not this package's to render: the composer passes it
 * in as `control` on the {@link 'conversation.input.access'} seat, already
 * built, and this component only decides where it goes.
 *
 * The panel is portalled to the body and positioned against the trigger. The
 * composer's tool row scrolls sideways when its content asks for more
 * (`.tools` carries `overflow-x: auto`, FORK.md), and CSS forces the other
 * axis to `auto` with it, so a panel opening upward out of the row was
 * clipped away: it mounted, measured and reported itself visible while
 * painting nothing (JJ, 11 Sep 2026: "3-dot menu in the askbar not working").
 * @module @idealize/activity-pills/client/ComposerOverflow
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the composer's access seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrainSwitcher, type BrainSwitcherInjected } from './BrainSwitcher.tsx'
import css from './ComposerOverflow.module.css'

/** Full slot component props: the access seat's share, the locale seat, and the brain face the panel's second row needs. */
export type ComposerOverflowProps =
  PropsRuntime<'conversation.input.access'>
  & PropsLocale<'idealize-activity'>
  & InjectFace<BrainSwitcherInjected>

function Dots(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="3" cy="7" r="1.35" fill="currentColor" />
      <circle cx="7" cy="7" r="1.35" fill="currentColor" />
      <circle cx="11" cy="7" r="1.35" fill="currentColor" />
    </svg>
  )
}

/**
 * The overflow control and its panel.
 * @param props - composed slot props; `control` is the composer's own access chip.
 * @returns the trigger, and the panel while it is open.
 */
export function ComposerOverflow(props: ComposerOverflowProps) {
  const { control, locked, t } = props
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  const wrap = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLSpanElement | null>(null)

  // Left-aligned to the trigger and 8px above it, in viewport coordinates:
  // the panel is fixed, so it owes nothing to the scrolled row it came from.
  // Re-measured on layout so the first paint lands in place, and again on a
  // resize, which is the only thing that moves the composer while it is open.
  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const place = (): void => {
      const trigger = wrap.current
      if (trigger === null) return
      const box = trigger.getBoundingClientRect()
      setAt({ left: box.left, bottom: window.innerHeight - box.top + 8 })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  // One document listener, live only while the panel is open. Pointerdown
  // rather than click: a chip inside the panel opens its own menu on click,
  // and closing on that click would take the panel away underneath it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (wrap.current?.contains(target) === true) return
      if (panel.current?.contains(target) === true) return
      // A menu opened from inside the panel portals to the body, so a click on
      // one of its rows lands outside this subtree. Those rows carry their own
      // close, and the panel stays until the pointer lands on the page itself.
      if (target instanceof Element && target.closest('[role="menu"], [role="dialog"]') !== null) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open])

  useEffect(() => {
    if (locked) setOpen(false)
  }, [locked])

  const body = at === null ? null : (
    <span
      ref={panel}
      className={css.panel}
      role="dialog"
      aria-label={t('overflow.trigger')}
      data-composer-overflow-panel=""
      style={{ left: `${String(at.left)}px`, bottom: `${String(at.bottom)}px` }}
    >
      <span className={css.item}>
        <span className={css.label}>{t('overflow.access')}</span>
        {control}
      </span>
      <span className={css.item}>
        <span className={css.label}>{t('overflow.brain')}</span>
        <BrainSwitcher {...props} />
      </span>
    </span>
  )

  return (
    <span className={css.wrap} ref={wrap} data-composer-overflow="">
      <button
        type="button"
        className={css.trigger}
        data-composer-overflow-trigger=""
        aria-label={t('overflow.trigger')}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={locked}
        onClick={() => { setOpen(value => !value) }}
      >
        <Dots />
      </button>
      {open && body !== null && createPortal(body, document.body)}
    </span>
  )
}

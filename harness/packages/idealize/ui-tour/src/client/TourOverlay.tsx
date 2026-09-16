/**
 * The first-run showcase (V0's ShowcaseTour): dims the frame, cuts a hole
 * around one control at a time, and explains it. The scrim is the dismiss
 * surface; Return advances, Escape skips.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { CARD_WIDTH, placeCard, spotlightOf, type Rect, type Size } from './placement.ts'
import type { TourStep, TourTarget } from './tour-script.ts'
import css from './TourOverlay.module.css'

export interface TourOverlayProps {
  steps: TourStep[]
  index: number
  /** Resolve a target to its on-screen element (null when absent). */
  resolve: (target: TourTarget) => Element | null
  onNext: () => void
  onBack: () => void
  onFinish: () => void
  t: TranslateNS<'idealize-tour'>
}

/** Convert an element's viewport rect into the overlay's coordinate space. */
function relativeRect(element: Element, root: Element): Rect {
  const box = element.getBoundingClientRect()
  const origin = root.getBoundingClientRect()
  return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height }
}

export function TourOverlay({ steps, index, resolve, onNext, onBack, onFinish, t }: TourOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [spotlight, setSpotlight] = useState<Rect | null>(null)
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 })
  const [cardSize, setCardSize] = useState<Size>({ width: CARD_WIDTH, height: 200 })
  const step = steps[index]
  const isLast = index >= steps.length - 1

  // Measure the target and the frame on every step change and resize. A
  // target that vanished mid-tour leaves the card floating centred (V0).
  useLayoutEffect(() => {
    const measure = (): void => {
      const root = rootRef.current
      if (root === null || step === undefined) return
      setContainer({ width: root.clientWidth, height: root.clientHeight })
      const element = step.target === null ? null : resolve(step.target)
      setSpotlight(element === null ? null : spotlightOf(relativeRect(element, root)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [step, resolve])

  useLayoutEffect(() => {
    const card = cardRef.current
    if (card === null) return
    const observer = new ResizeObserver(() => {
      setCardSize({ width: card.offsetWidth, height: card.offsetHeight })
    })
    observer.observe(card)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onFinish()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onNext()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onFinish, onNext])

  if (step === undefined) return null
  const origin = placeCard(cardSize, spotlight, container)
  // The scrim is four panels around the hole (one full panel with no hole):
  // a box-shadow spread large enough to cover the frame does not paint.
  const hole = spotlight ?? { x: 0, y: 0, width: 0, height: 0 }
  const panels = spotlight === null
    ? [{ left: 0, top: 0, right: 0, bottom: 0 }]
    : [
      { left: 0, top: 0, right: 0, height: Math.max(0, hole.y) },
      { left: 0, top: hole.y + hole.height, right: 0, bottom: 0 },
      { left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.height },
      { left: hole.x + hole.width, top: hole.y, right: 0, height: hole.height },
    ]

  return (
    <div ref={rootRef} className={css.root} data-idealize-tour role="dialog" aria-label={t(step.title)}>
      {panels.map((panel, i) => (
        <div key={i} className={css.scrim} style={panel} onClick={onFinish} />
      ))}
      {spotlight !== null && (
        <div
          className={css.ring}
          style={{ left: spotlight.x, top: spotlight.y, width: spotlight.width, height: spotlight.height }}
        />
      )}
      <div ref={cardRef} className={css.card} style={{ left: origin.x, top: origin.y }}>
        <div className={css.head}>
          <span>{t(step.title)}</span>
        </div>
        <p className={css.body}>{t(step.body)}</p>
        <div className={css.foot}>
          <div className={css.dots} aria-hidden="true">
            {steps.map((entry, i) => (
              <span key={entry.title} className={css.dot} data-active={i === index ? '' : undefined} />
            ))}
          </div>
          {index > 0 && (
            <button type="button" className={css.back} onClick={onBack}>{t('tour.back')}</button>
          )}
          <button type="button" className={css.next} onClick={onNext} data-tour-next>
            {isLast ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  )
}

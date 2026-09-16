import { useCallback, useEffect, useRef, useState } from 'react'
import { OWL_FRAMES } from './owl-frames.ts'

/** Flipbook cadence, ms per frame (V0's ~12fps run-cycle). */
const FRAME_MS = 83

/** {@link OwlMark} props. */
export interface OwlMarkProps {
  /** Rendered height in CSS pixels; width follows the 190:210 intrinsic ratio. */
  size?: number
  /** Optional class for placement and motion. */
  className?: string | undefined
  /**
   * V0's welcome behaviour: play the run-cycle once on appear, then settle;
   * roll over for another go. A run in flight is never restarted, and
   * prefers-reduced-motion keeps the owl still.
   */
  animate?: boolean
}

/**
 * The IDEalize owl mascot (V0's welcome mark), rendered from the inlined
 * boot-splash flipbook so it needs no network request. Hover detection lives
 * on a stationary wrapper, not the frames: an animated image moving under
 * the pointer would end its own hover and cancel the run.
 * @param props - see {@link OwlMarkProps}.
 * @returns a wrapper span carrying the owl `img`.
 */
export function OwlMark({ size = 105, className, animate = false }: OwlMarkProps) {
  const [frame, setFrame] = useState(0)
  const raf = useRef<number | null>(null)

  const play = useCallback((): void => {
    if (!animate || raf.current !== null) return
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Elapsed-time stepping over requestAnimationFrame: immune to timer
    // throttling and dropped frames; a hidden page simply pauses the run.
    const started = performance.now()
    const total = OWL_FRAMES.length * FRAME_MS
    const step = (now: number): void => {
      const elapsed = now - started
      if (elapsed >= total) {
        // V0 rests on the run-cycle's last frame (it sits next to the first,
        // so a replay doesn't visibly jump).
        raf.current = null
        setFrame(OWL_FRAMES.length - 1)
        return
      }
      setFrame(Math.min(OWL_FRAMES.length - 1, Math.floor(elapsed / FRAME_MS)))
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }, [animate])

  // The appear run, and unmount safety for whichever run is in flight.
  useEffect(() => {
    play()
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
  }, [play])

  return (
    <span style={{ display: 'inline-flex' }} onMouseEnter={play}>
      <img
        src={OWL_FRAMES[frame]}
        alt=""
        aria-hidden="true"
        className={className}
        width={Math.round(size * 190 / 210)}
        height={size}
        draggable={false}
      />
    </span>
  )
}

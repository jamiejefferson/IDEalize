/**
 * The owl's three gestures on one pointer (MiniMode plan, interaction model):
 * a press that moves more than 4 px is a drag; a press held 250 ms without
 * moving is push-to-talk; anything shorter is a click, and two clicks inside
 * 300 ms are a double-click. Pure state with an injected clock, so every
 * boundary is pinned by a spec.
 * @module @idealize/powell/client/gestures
 */

/** Thresholds, in ms and px. */
export const HOLD_MS = 250
export const DRAG_PX = 4
export const DOUBLE_MS = 300

/** What the owl should do. */
export type GestureEffect =
  | { kind: 'hold-start' }
  | { kind: 'hold-end' }
  | { kind: 'drag-start' }
  | { kind: 'drag-end' }
  | { kind: 'click' }
  | { kind: 'double-click' }

/** Timer seam: the real one is setTimeout. */
export interface Timers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
  now(): number
}

/** Tracks one pointer through press, move and release. */
export class Gestures {
  private phase: 'up' | 'pressed' | 'holding' | 'dragging' = 'up'
  private origin = { x: 0, y: 0 }
  private holdTimer: unknown
  private lastClick = -Infinity

  /**
   * @param emit - receives each gesture.
   * @param timers - the clock.
   */
  constructor(private readonly emit: (effect: GestureEffect) => void, private readonly timers: Timers = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now: () => Date.now(),
  }) {}

  down(x: number, y: number): void {
    this.cancelTimers()
    this.phase = 'pressed'
    this.origin = { x, y }
    this.holdTimer = this.timers.set(() => {
      if (this.phase !== 'pressed') return
      this.phase = 'holding'
      this.emit({ kind: 'hold-start' })
    }, HOLD_MS)
  }

  move(x: number, y: number): void {
    if (this.phase !== 'pressed') return
    if (Math.hypot(x - this.origin.x, y - this.origin.y) <= DRAG_PX) return
    this.timers.clear(this.holdTimer)
    this.phase = 'dragging'
    this.emit({ kind: 'drag-start' })
  }

  up(): void {
    const phase = this.phase
    this.phase = 'up'
    this.timers.clear(this.holdTimer)
    if (phase === 'holding') {
      this.emit({ kind: 'hold-end' })
      return
    }
    if (phase === 'dragging') {
      this.emit({ kind: 'drag-end' })
      return
    }
    if (phase !== 'pressed') return
    const now = this.timers.now()
    // A click acts at once (the pill must not wait to rule out a double); a
    // second click inside the window then adds the double-click.
    if (now - this.lastClick <= DOUBLE_MS) {
      this.lastClick = -Infinity
      this.emit({ kind: 'double-click' })
      return
    }
    this.lastClick = now
    this.emit({ kind: 'click' })
  }

  /** The pointer was lost (window blur, capture lost): end whatever was running. */
  cancel(): void {
    if (this.phase === 'holding' || this.phase === 'dragging') this.up()
    this.phase = 'up'
    this.timers.clear(this.holdTimer)
  }

  private cancelTimers(): void {
    this.timers.clear(this.holdTimer)
  }
}

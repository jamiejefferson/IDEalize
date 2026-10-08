/**
 * The owl's live view: one SSE stream from the host, whose `say` and `hush`
 * events go straight to the mouth and whose `view` events feed React.
 * @module @idealize/powell/client/store
 */

import type { PowellStreamEvent, PowellView } from '../types.ts'
import type { Mouth } from './voice.ts'

const EMPTY: PowellView = { mood: 'idle', status: '', project: null, bubble: null, busy: false, voiceConsent: false, muted: false }

/** A subscribable snapshot of the host's view. */
export interface PowellStore {
  getSnapshot(): PowellView
  subscribe(listener: () => void): () => void
  /** Whether the stream is connected. */
  connected(): boolean
  stop(): void
}

/**
 * Connect to the host's stream.
 * @param mouth - plays `say` lines.
 * @returns the store.
 */
export function startStore(mouth: Mouth): PowellStore {
  let view = EMPTY
  let live = false
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  const source = new EventSource('/idealize/powell/events')
  source.onopen = () => {
    live = true
    notify()
  }
  source.onerror = () => {
    live = false
    notify()
  }
  source.onmessage = (message) => {
    let event: PowellStreamEvent
    try {
      event = JSON.parse(message.data as string) as PowellStreamEvent
    } catch {
      return
    }
    if (event.type === 'view') {
      view = event.view
      mouth.setMuted(view.muted)
      notify()
    } else if (event.type === 'say') {
      mouth.say(event.id, event.text, event.clip)
    } else {
      mouth.hush()
    }
  }
  return {
    getSnapshot: () => view,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    connected: () => live,
    stop: () => { source.close() },
  }
}

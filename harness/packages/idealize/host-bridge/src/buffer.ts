/**
 * The bridge's event buffer: a capped in-memory ring of notification events
 * with live subscriber fanout. Pure state — the service owns wiring and HTTP.
 */

/** What a bridge event is about; the shell maps kinds to badges and toasts. */
export type BridgeEventKind =
  | 'cron-run'
  | 'cron-changed'
  | 'agent-finished'
  | 'agent-error'
  | 'approval-pending'
  | 'approval-decided'
  | 'mail'
  | 'notify'
  | 'focus'
  | 'reveal'
  | 'open-studio'
  | 'new-chat'
  | 'open-folder'
  | 'attention'

/** One notification the host wants a shell (desktop or browser) to surface. */
export interface BridgeEvent {
  /** Monotonic per-process sequence; `since` cursors compare against it. */
  seq: number
  /** ISO-8601 instant the event was recorded. */
  at: string
  kind: BridgeEventKind
  /** Short human line, e.g. `Nightly digest — ok in 2.1s`. */
  title: string
  /** Longer human detail; empty when the title says it all. */
  body: string
  /** The session the event belongs to, when it has one. */
  sessionId?: string
  /** The project the Askbar showed when it asked for the Studio (context only: the Studio spans every project). */
  project?: string
  /** The Studio event an `attention` alert was raised for; opening the alert opens this event. */
  studioEvent?: string
  /** On `agent-finished`: the turn the agent stopped on ended in an error, so no reply is waiting. */
  failed?: boolean
  /** The absolute folder an `open-folder` event asks the shell to register as a project and open. */
  folder?: string
}

const CAP = 200

/** The notification feed's retained tail (200 events) with live fan-out to subscribers. */
export class BridgeBuffer {
  private events: BridgeEvent[] = []
  private nextSeq = 1
  private subscribers = new Set<(event: BridgeEvent) => void>()

  /**
   * Record one event and fan it out to live subscribers.
   * @param input - the event without its `seq` and `at`, which this call assigns.
   * @returns the stored event; a throwing subscriber does not affect it or the others.
   */
  push(input: Omit<BridgeEvent, 'seq' | 'at'>): BridgeEvent {
    const event: BridgeEvent = { seq: this.nextSeq, at: new Date().toISOString(), ...input }
    this.nextSeq += 1
    this.events.push(event)
    if (this.events.length > CAP) this.events.splice(0, this.events.length - CAP)
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event)
      } catch {
        // a broken subscriber must not sever the others
      }
    }
    return event
  }

  /**
   * Events after a cursor, oldest first.
   * @param sinceSeq - the last sequence the caller has seen; 0 for everything retained.
   * @returns the retained events with a greater `seq`.
   */
  recent(sinceSeq: number): BridgeEvent[] {
    return this.events.filter(event => event.seq > sinceSeq)
  }

  /**
   * Attach a live listener.
   * @param listener - called synchronously with each pushed event.
   * @returns the detach function.
   */
  subscribe(listener: (event: BridgeEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }
}

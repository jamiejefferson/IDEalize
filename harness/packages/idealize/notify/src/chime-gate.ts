/**
 * The done-chime gate, ported from V0's `chimeSeeded` rule: the chime fires
 * on the working→attention transition (the bridge's `agent-finished` event)
 * and never for work that already finished before this page attached —
 * restoring the app, or reloading the tab while the host kept running, must
 * stay silent. Pure state over bridge event sequence numbers.
 */

/** The bridge event fields the gate reads (the full event carries more). */
export interface GateEvent {
  seq: number
  kind: string
  sessionId?: string
}

/** Decides which bridge events are fresh attention transitions worth a chime, ignoring history replayed at attach. */
export interface ChimeGate {
  /**
   * One-time seed: the newest retained sequence at attach time. Events at or
   * below it are history, never a fresh transition. Later calls are ignored.
   */
  seed(latestSeq: number): void
  /** Whether the gate has been seeded. */
  readonly seeded: boolean
  /**
   * Consider one event; true when it is a fresh working→attention transition
   * the chime should answer. Before seeding nothing fires.
   */
  consider(event: GateEvent): boolean
}

/** The bridge event kind that marks an agent's working→attention transition. */
export const ATTENTION_KIND = 'agent-finished'

/**
 * Create a gate; it fires nothing until `seed()` is called.
 * @returns a fresh, unseeded gate.
 */
export function createChimeGate(): ChimeGate {
  let seedSeq: number | undefined
  let lastSeq = 0
  return {
    get seeded() { return seedSeq !== undefined },
    seed(latestSeq) {
      if (seedSeq !== undefined) return
      seedSeq = latestSeq
      lastSeq = latestSeq
    },
    consider(event) {
      if (seedSeq === undefined) return false
      if (event.seq <= lastSeq) return false
      lastSeq = event.seq
      return event.kind === ATTENTION_KIND
    },
  }
}

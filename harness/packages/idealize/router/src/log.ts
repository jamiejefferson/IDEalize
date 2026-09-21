/**
 * The router's log: one JSON line per decided turn, in the harness data
 * folder. It holds the reading and the figures, never the message, so the
 * file can be shared when a switch needs explaining.
 */

import { appendFile, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { Decision, StayReason } from './decide.ts'
import type { JevFailure } from './jev.ts'
import type { TaskReading } from './tasks.ts'

export const ROUTER_LOG_FILE = 'router-log.jsonl'
/** Past this size the log moves to `router-log.1.jsonl` and starts again. */
const MAX_LOG_BYTES = 2_000_000

export interface LogEntry {
  at: string
  session: string
  brain?: string | undefined
  reading: TaskReading
  /** Why Jev did not read this turn, when the local rules did. */
  jevFailure?: JevFailure | undefined
  jevMs?: number | undefined
  jevCost?: number | undefined
  from: string
  to: string
  switched: boolean
  stayed?: StayReason | undefined
  recommended?: string | undefined
  improvement: number
  switchConfidence: number
  rationale: string
}

const routeOf = (model: { provider: string; model: string }): string => `${model.provider}/${model.model}`

/**
 * One decision as a log line.
 * @param session - the chat's id.
 * @param decision - what the router decided.
 * @param reading - the reading it decided on.
 * @param extra - the brain and what the Jev call cost.
 * @returns the entry.
 */
export function entryFor(
  session: string, decision: Decision, reading: TaskReading,
  extra: {
    brain?: string | undefined
    jevFailure?: JevFailure | undefined
    jevMs?: number | undefined
    jevCost?: number | undefined
    from: { provider: string; model: string }
    now?: Date
  },
): LogEntry {
  return {
    at: (extra.now ?? new Date()).toISOString(),
    session,
    brain: extra.brain,
    reading,
    jevFailure: extra.jevFailure,
    jevMs: extra.jevMs,
    jevCost: extra.jevCost,
    from: routeOf(extra.from),
    to: routeOf(decision.use),
    switched: decision.switched,
    stayed: decision.stayed,
    recommended: decision.recommended === undefined ? undefined : routeOf(decision.recommended),
    improvement: Number(decision.improvement.toFixed(3)),
    switchConfidence: Number(decision.switchConfidence.toFixed(3)),
    rationale: decision.rationale,
  }
}

/**
 * Append one entry. A log that cannot be written never fails a turn.
 * @param home - the harness data folder.
 * @param entry - the line to add.
 */
export async function appendLog(home: string, entry: LogEntry): Promise<void> {
  const file = join(home, ROUTER_LOG_FILE)
  try {
    const size = await stat(file).then(found => found.size, () => 0)
    if (size > MAX_LOG_BYTES) await rename(file, join(home, 'router-log.1.jsonl'))
    await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // The turn matters more than its record.
  }
}

/**
 * The newest entries, newest first, for the settings' log view.
 * @param home - the harness data folder.
 * @param limit - how many to return.
 * @returns the entries; an absent or unreadable log reads as empty.
 */
export async function readLog(home: string, limit = 50): Promise<LogEntry[]> {
  const text = await readFile(join(home, ROUTER_LOG_FILE), 'utf8').catch(() => '')
  const entries: LogEntry[] = []
  for (const line of text.split('\n').reverse()) {
    if (line.trim() === '') continue
    try {
      entries.push(JSON.parse(line) as LogEntry)
    } catch {
      // A torn last line from a crash is skipped.
    }
    if (entries.length >= limit) break
  }
  return entries
}

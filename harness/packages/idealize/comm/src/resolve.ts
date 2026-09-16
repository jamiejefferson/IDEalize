/**
 * Addressing: a `<session>` argument resolves by id, then by alias
 * (`coordinator`/`project-agent`, `studio-agent`), then by agent name, then by
 * label, then by project folder name. Several matches are an error naming the
 * candidates; the first match is never picked silently.
 */

import { basename } from 'node:path'
import type { CommRole } from './store.ts'

/** What resolution needs to know about one session. */
export interface SessionRecord {
  id: string
  /** The chat's agent name, once assigned. */
  name?: string
  /** The task label: the spawn title, the live title, or the folder. */
  label: string
  cwd?: string
  role: CommRole | 'chat'
}

/** The outcome of resolving a target: the session, or the error line the CLI prints. */
export type Resolution =
  | { ok: true; session: SessionRecord }
  | { ok: false; error: string }

/**
 * Resolve one target against a roster.
 * @param target - the id, alias, label, or folder name.
 * @param roster - every addressable session.
 * @param from - the caller's id; the `coordinator` alias means the caller's own project's.
 * @returns the matched session, or `ok: false` with the reason (unknown target, ambiguous match, no such role running).
 */
export function resolveTarget(target: string, roster: readonly SessionRecord[], from?: string): Resolution {
  const exact = roster.find(session => session.id === target)
  if (exact !== undefined) return { ok: true, session: exact }
  const lower = target.toLowerCase()
  if (lower === 'coordinator' || lower === 'project-agent') {
    const senderProject = roster.find(session => session.id === from)?.cwd
    const agents = roster.filter(session => session.role === 'project-agent')
    const own = senderProject === undefined ? undefined : agents.find(agent => agent.cwd === senderProject)
    if (own !== undefined) return { ok: true, session: own }
    const [onlyAgent] = agents
    if (onlyAgent !== undefined && agents.length === 1) return { ok: true, session: onlyAgent }
    if (agents.length === 0) return { ok: false, error: 'no project agent is running' }
    return { ok: false, error: `several project agents are running (${agents.map(agent => agent.id).join(', ')}) — use a session id` }
  }
  // One Studio coordinator runs, so its alias needs no folder to disambiguate.
  if (lower === 'studio-agent') {
    const studio = roster.find(session => session.role === 'studio-agent')
    if (studio !== undefined) return { ok: true, session: studio }
    return { ok: false, error: 'the Studio coordinator is not running' }
  }
  let matches = roster.filter(session => session.name?.toLowerCase() === lower)
  if (matches.length === 0) matches = roster.filter(session => session.label.toLowerCase() === lower)
  if (matches.length === 0) {
    matches = roster.filter(session => session.cwd !== undefined && basename(session.cwd).toLowerCase() === lower)
  }
  const [only] = matches
  if (only !== undefined && matches.length === 1) return { ok: true, session: only }
  if (matches.length === 0) return { ok: false, error: `no session matching '${target}'` }
  return {
    ok: false,
    error: `'${target}' matches ${matches.length} sessions (${matches.map(session => session.id).join(', ')}) — use a session id`,
  }
}

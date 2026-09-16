/**
 * Cross-domain sessions face: the contract surface sibling domains (today:
 * workspaces) consume instead of the sessions implementation. The sessions
 * domain satisfies it structurally — SessionRuntime is assignable, checked
 * wherever the assembly layer or a test injects the real service — so
 * widening this face is the explicit act of widening the inter-domain
 * dependency.
 */

import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
// Type-only: the `space`/`brain` SessionProjectionMap merge the reuse rule in
// `workspaces/service.ts` reads. The map is merge-extensible, so the keys are
// only in the program that declares them.
import type {} from '@idealize/spaces/client'
import type { ObservableSnapshot } from './store.ts'

/** Session-list row facts sibling domains read: recency, blank-reuse eligibility, and its cwd canon. */
export interface SessionsPortSummary {
  id: SessionId
  /** Empty-log bit (blank sessions are reused by New Session instead of minting another). */
  blank: boolean
  cwd?: string
  updatedAt: number
  /**
   * Host-computed projection values. Read for reuse eligibility: a blank
   * session a plugin has already put to work is not a fresh one.
   */
  projectionValues?: Readonly<Partial<SessionProjectionMap>>
}

/** Session-list facts sibling domains read: readiness, selection, and the row map. */
export interface SessionsPortList {
  ids: SessionId[]
  byId: Record<SessionId, SessionsPortSummary>
  current: SessionId | undefined
  phase: 'pending' | 'ready'
}

/** The sessions-service face injected into sibling domains. */
export interface SessionsPort {
  /** Observable list snapshot (read face only; writes stay inside the sessions domain). */
  readonly list: ObservableSnapshot<SessionsPortList>
  /**
   * Create a session on the host.
   * @param opts - target workspace.
   * @returns the new session id.
   */
  create(opts: { workspaceId: WorkspaceId }): Promise<SessionId>
  /**
   * Select a session as current.
   * @param id - session id (must exist in the list store).
   */
  open(id: SessionId): void
  /** Clear the current selection into the no-session view state. */
  clear(): void
}

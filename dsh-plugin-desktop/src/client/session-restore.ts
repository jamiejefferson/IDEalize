/**
 * Session survival across the restart that applies a shell-mode change.
 *
 * The client runtime already persists the selection (localStorage
 * `dsh.sessions.current`), but the desktop's loopback origin carries a fresh
 * random port after every relaunch, so that storage never survives a
 * mode-change restart. This module bridges the gap through the Electron
 * Host: every selection change is recorded on the view-state route, and a
 * new generation re-opens the recorded session once the session list carries
 * it — unless the user (or the runtime's own restore) has already put a
 * session on stage.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { DESKTOP_VIEW_STATE_PATH } from '../view-state-contract.ts'

/**
 * Record the current session on the Host and re-open the recorded one at boot.
 * @param ctx - active browser Cordis context.
 * @param request - fetch used for the loopback view-state route (test seam).
 * @returns disposer stopping recording and any pending restore.
 */
export function installSessionRestore(
  ctx: ClientContext,
  request: typeof globalThis.fetch = globalThis.fetch,
): () => void {
  let disposed = false
  let recorded: string | undefined
  let restoreTarget: SessionId | undefined

  const record = (sessionId: string): void => {
    if (sessionId === recorded) return
    recorded = sessionId
    // A live selection wins over any pending restore.
    restoreTarget = undefined
    void request(DESKTOP_VIEW_STATE_PATH, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {
      // Recording is best-effort: a failed write only costs the restore after
      // the next restart, and the next selection change retries.
      recorded = undefined
    })
  }

  const consider = (): void => {
    if (disposed) return
    const { current, byId } = ctx.sessions.list.getSnapshot()
    if (current !== undefined) {
      record(current)
      return
    }
    if (restoreTarget !== undefined && byId[restoreTarget] !== undefined) {
      const target = restoreTarget
      restoreTarget = undefined
      ctx.sessions.open(target)
    }
  }

  const unsubscribe = ctx.sessions.list.subscribe(consider)

  void request(DESKTOP_VIEW_STATE_PATH, { cache: 'no-store' })
    .then(async response => response.ok ? response.json() as Promise<unknown> : undefined)
    .then((state) => {
      if (disposed || typeof state !== 'object' || state === null) return
      const sessionId = (state as { sessionId?: unknown }).sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      if (ctx.sessions.list.getSnapshot().current !== undefined) return
      restoreTarget = sessionId as SessionId
      consider()
    })
    .catch(() => {
      // Restore is best-effort: without the stored id the generation starts
      // on the welcome view exactly as an unrecorded launch would.
    })

  consider()
  return () => {
    disposed = true
    unsubscribe()
  }
}

/**
 * @idealize/vault — commit-evidence documentation over the canonical
 * structure `@idealize/doc-policy` owns.
 *
 * The documentation folder, scaffold, conventions, and session-start context
 * injection live in `ctx.docPolicy`; this plugin keeps the write side:
 *
 * - on `session/flush` (throttled), finds the project note whose `repo:`
 *   matches the session's git toplevel and appends commit evidence since the
 *   note's own `last_touched`, advancing the date — no commits, no write, and
 *   failures are logged, never thrown into session teardown; a successful
 *   append triggers a docPolicy rescan so the index stays fresh (DOC-06);
 * - serves `GET /idealize/vault/reconcile` (loopback only): notes whose repos
 *   moved ahead of them.
 *
 * Settings section `idealize-vault` keeps the projects root (`projectsRoot`);
 * the documentation folder is docPolicy's `idealize-docs` section.
 *
 * @module @idealize/vault
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { gitToplevel, noteForRepo } from '@idealize/doc-policy'
import { appendSessionLog, commitsSince, reconcile } from './notes.ts'

export { appendSessionLog, commitsSince, reconcile } from './notes.ts'
export type { CommitLine, StaleNote } from './notes.ts'

export const name = 'idealize-vault'

export const inject = ['docPolicy']

const NS = settingsNamespace('idealize-vault')

/** Plugin config, mirrored by the `idealize-vault` settings section. */
export interface VaultConfig {
  /** Absolute directory the vault's per-project folders live under. */
  projectsRoot?: string
}

export const Config: z<VaultConfig> = z.object({
  projectsRoot: z.string(),
})

/** Today as the vault's absolute-date convention (YYYY-MM-DD, local time). */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function apply(ctx: Context, config: VaultConfig): void {
  installSettingsSection(ctx, NS, Config, config, {
    setSource: () => {},
    onChange: () => {},
  })

  /** The commit-evidence append for one closing session. */
  const documentClose = async (session: Session): Promise<void> => {
    const folder = ctx.docPolicy.folder()
    const cwd = session.header.cwd
    if (folder === undefined || cwd === undefined) return
    const toplevel = await gitToplevel(cwd)
    if (toplevel === undefined) return
    const note = await noteForRepo(folder, toplevel)
    if (note === undefined) return
    const commits = await commitsSince(toplevel, note.lastTouched)
    const appended = await appendSessionLog(note, commits, today())
    if (appended.length > 0) {
      ctx.logger.info(`idealize-vault: appended ${appended.length} commit(s) to ${note.path}`)
      // Managed documentation changed: refresh the docs index (DOC-06).
      await ctx.docPolicy.scan()
    }
  }

  // Evidence starts on `session/flush`, not `session/disposed`: dispose is
  // fire-and-forget and reaches this late-mounted plugin only after its own
  // disposal. The flush itself is not held: it is the durability barrier every
  // turn's first step waits on, and a git read in the project (which can sit
  // behind another process's index lock) is bookkeeping, not durability. The
  // work runs detached and is awaited at this plugin's disposal, so the
  // headless runner's final flush still lands the evidence before teardown.
  // Flushes recur through a session, so the check is throttled per session
  // and the append itself dedups by hash.
  const lastChecked = new WeakMap<Session, number>()
  const inflight = new Set<Promise<void>>()
  ctx.on('session/flush', (session) => {
    const now = Date.now()
    const prior = lastChecked.get(session)
    if (prior !== undefined && now - prior < 15_000) return
    lastChecked.set(session, now)
    const work = documentClose(session)
      .catch((error: unknown) => {
        ctx.logger.warn('idealize-vault: session documentation failed (session unaffected)')
        ctx.logger.warn(error)
      })
      .finally(() => { inflight.delete(work) })
    inflight.add(work)
  })
  ctx.effect(() => () => Promise.allSettled([...inflight]).then(() => undefined), 'idealize-vault: settle detached documentation')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: '/idealize/vault/reconcile',
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const host = (req.headers.host ?? '').replace(/:\d+$/, '')
          if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
            res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
            return
          }
          const folder = ctx.docPolicy.folder()
          if (folder === undefined) {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ configured: false, stale: [] }))
            return
          }
          const stale = await reconcile(folder)
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ configured: true, stale }))
        },
      }),
      'idealize-vault: reconcile endpoint',
    )
  })
}

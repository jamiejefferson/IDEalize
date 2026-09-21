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
 * - on the same flush, rewrites the chat's Markdown copy under the project
 *   note's folder (`sessions/`), so the conversation outlives the app's own log
 *   and any model can be handed it (`sessionFiles`, on unless switched off);
 * - serves `GET` and `POST /idealize/vault/settings` (loopback only): the
 *   `sessionFiles` switch the Files panel's documentation views show;
 * - serves `GET /idealize/vault/reconcile` (loopback only): notes whose repos
 *   moved ahead of them.
 *
 * Settings section `idealize-vault` keeps the projects root (`projectsRoot`);
 * the documentation folder is docPolicy's `idealize-docs` section.
 *
 * @module @idealize/vault
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { realpath } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { gitToplevel, noteForRepo } from '@idealize/doc-policy'
import { appendSessionLog, commitsSince, reconcile } from './notes.ts'
import { writeTranscript } from './transcript.ts'
import type { TranscriptMessage } from './transcript.ts'

export { appendSessionLog, commitsSince, reconcile } from './notes.ts'
export type { CommitLine, StaleNote } from './notes.ts'
export { SESSIONS_DIR, transcriptOf, writeTranscript } from './transcript.ts'
export type { TranscriptInput, TranscriptMessage } from './transcript.ts'

export const name = 'idealize-vault'

export const inject = ['docPolicy']

const NS = settingsNamespace('idealize-vault')

/** Plugin config, mirrored by the `idealize-vault` settings section. */
export interface VaultConfig {
  /** Absolute directory the vault's per-project folders live under. */
  projectsRoot?: string
  /** Keep a Markdown copy of each chat in its project's documentation folder. */
  sessionFiles?: boolean
}

export const Config: z<VaultConfig> = z.object({
  projectsRoot: z.string(),
  sessionFiles: z.boolean().default(true),
})

/** Today as the vault's absolute-date convention (YYYY-MM-DD, local time). */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function apply(ctx: Context, config: VaultConfig): void {
  let current: () => VaultConfig = () => ({ ...config })
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source: () => VaultConfig) => {
      current = source
    },
    onChange: () => {},
  })

  /** The chat's Markdown copy, rewritten whole from the log. */
  const documentChat = async (session: Session, projectFolder: string, project: string): Promise<void> => {
    const events = session.events
    const titled = events.findLast(event => (event.type as string) === 'session/title') as { data?: { title?: unknown } } | undefined
    const brain = events.findLast(event => (event.type as string) === 'idealize/brain') as { data?: { brain?: unknown } } | undefined
    const first = events[0] as { time?: number } | undefined
    await writeTranscript(projectFolder, {
      sessionId: String(session.header.id),
      title: typeof titled?.data?.title === 'string' && titled.data.title !== '' ? titled.data.title : undefined,
      started: new Date(first?.time ?? Date.now()).toISOString(),
      project,
      brain: typeof brain?.data?.brain === 'string' ? brain.data.brain : undefined,
      messages: session.deriveMessages() as unknown as TranscriptMessage[],
    })
  }

  /** The commit-evidence append for one closing session. */
  const documentClose = async (session: Session): Promise<void> => {
    const folder = ctx.docPolicy.folder()
    const cwd = session.header.cwd
    if (folder === undefined || cwd === undefined) return
    const toplevel = await gitToplevel(cwd)
    // A project outside git still has a note that names its folder, and its chats are still worth keeping.
    const root = toplevel ?? await realpath(cwd).catch(() => undefined)
    if (root === undefined) return
    const note = await noteForRepo(folder, root)
    if (note === undefined) return
    if (current().sessionFiles !== false) {
      // `Projects/<name>/_index.md` files under its own folder; a single-file note gets a folder of its name.
      const projectFolder = basename(note.path) === '_index.md' ? dirname(note.path) : note.path.replace(/\.md$/, '')
      // The copy is a convenience; a chat it cannot write still gets its commit evidence.
      await documentChat(session, projectFolder, root).catch((error: unknown) => {
        ctx.logger.warn(`idealize-vault: the chat's Markdown copy was not written: ${String(error)}`)
      })
    }
    if (toplevel === undefined) return
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
  // A flush inside the window is not dropped: it books one run for the window's
  // end, so the last save of a turn (the model's reply) always reaches the
  // chat's copy. Without it the copy stopped at the person's message whenever
  // the reply landed within 15 seconds of the previous check.
  const trailing = new Map<Session, ReturnType<typeof setTimeout>>()
  const THROTTLE_MS = 15_000
  // One run at a time per chat: a booked run that overlapped the one before it read the note before the first
  // had written, and both appended the same commits.
  const queue = new WeakMap<Session, Promise<void>>()
  const document = (session: Session): void => {
    lastChecked.set(session, Date.now())
    const work = (queue.get(session) ?? Promise.resolve())
      .then(() => documentClose(session))
      .catch((error: unknown) => {
        ctx.logger.warn('idealize-vault: session documentation failed (session unaffected)')
        ctx.logger.warn(error)
      })
      .finally(() => { inflight.delete(work) })
    queue.set(session, work)
    inflight.add(work)
  }
  ctx.on('session/flush', (session) => {
    const prior = lastChecked.get(session)
    const wait = prior === undefined ? 0 : THROTTLE_MS - (Date.now() - prior)
    if (wait <= 0) {
      document(session)
      return
    }
    if (trailing.has(session)) return
    trailing.set(session, setTimeout(() => {
      trailing.delete(session)
      document(session)
    }, wait))
  })
  // At disposal a booked run happens at once, and every run is awaited, so the headless runner's final flush
  // still lands the evidence and the chat's last state before teardown.
  ctx.effect(() => () => {
    for (const [session, timer] of trailing) {
      clearTimeout(timer)
      document(session)
    }
    trailing.clear()
    return Promise.allSettled([...inflight]).then(() => undefined)
  }, 'idealize-vault: settle detached documentation')

  ctx.inject(['webServer', 'settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.webServer.register({
        kind: 'exact',
        path: '/idealize/vault/settings',
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const host = (req.headers.host ?? '').replace(/:\d+$/, '')
          if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
            res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
            return
          }
          if (req.method === 'POST') {
            if (req.headers['x-idealize-auth'] !== '1') {
              res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
              return
            }
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(chunk as Buffer)
            let body: { sessionFiles?: unknown }
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { sessionFiles?: unknown }
            } catch {
              body = {}
            }
            if (typeof body.sessionFiles !== 'boolean') {
              res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'sessionFiles must be true or false' }))
              return
            }
            await settingsCtx.settings.update(NS, { sessionFiles: body.sessionFiles })
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sessionFiles: current().sessionFiles !== false }))
        },
      }),
      'idealize-vault: session files setting',
    )
  })

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

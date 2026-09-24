/**
 * @idealize/notify — Host half of the announcement banner and the done chime.
 *
 * - Registers the `idealize-notify` settings section (chime on/off, volume,
 *   last dismissed announcement id) the browser half reads and writes
 *   through its settings scope.
 * - `GET  /idealize/notify/app` — `{appVersion}` for the banner's version gate.
 * - `GET  /idealize/notify/chime.mp3` — V0's TaskComplete chime asset.
 * - `GET  /idealize/notify/sounds` — the chime catalogue: the built-in chime
 *   plus the operating system's own alert sounds (`./sounds.ts`).
 * - `GET  /idealize/notify/sound?id=…` — one catalogue sound, by id alone.
 * - `POST /idealize/notify/native` — `{title, body}` raised as a native
 *   notification through the desktop shell's `desktopActions.notify` when
 *   that service is composed and offers it; 409 otherwise, so the browser
 *   half falls back to Web Notifications.
 * - `GET  /idealize/notify/attention` — the read-position and
 *   notification-delivery ledger.
 * - `POST /idealize/notify/attention/read` — `{project, seq}` moves a
 *   project's read position forward.
 * - `POST /idealize/notify/attention/state` — `{event, state}` records that
 *   the person opened or dismissed one alert.
 *
 * Every recorded Studio event is decided against the MVP policy table here
 * (`./attention.ts`); an event that alerts is recorded on the ledger and
 * pushed onto the host bridge as an `attention` event, which the browser half
 * raises and reports back on.
 *
 * Same loopback + `x-idealize-auth` fence as the other /idealize routes.
 * @module @idealize/notify
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: the `idealize/studio-event` Events merge this plugin listens on.
import type {} from '@idealize/studio'
import { attentionNotice, notificationPolicyFor } from './attention.ts'
import type { PolicyTask } from './attention.ts'
import { AttentionStore, attentionLedgerPath } from './attention-store.ts'
import { CHIME_SOUND_PATH, CHIME_SOUNDS_PATH } from './chime-sounds.ts'
import { NOTIFY_SETTINGS_NAMESPACE, NotifySettingsSchema } from './settings.ts'
import { createSoundLibrary } from './sounds.ts'

export { NOTIFY_SETTINGS_NAMESPACE, NotifySettingsSchema, type NotifySettings } from './settings.ts'
export { BUILT_IN_CHIME, BUILT_IN_CHIME_SOUND, CHIME_SOUND_PATH, CHIME_SOUNDS_PATH, chimeSoundUrl, decodeChimeSounds, type ChimeSound } from './chime-sounds.ts'
export { createSoundLibrary, systemSoundSources, type SoundFile, type SoundLibrary, type SoundSources } from './sounds.ts'
export { compareVersions, decodeAnnouncement, selectAnnouncement, versionInRange, type Announcement } from './announcement.ts'
export { ATTENTION_KIND, createChimeGate, type ChimeGate, type GateEvent } from './chime-gate.ts'
export { attentionNotice, notificationPolicyFor, USER_PARTICIPANT } from './attention.ts'
export type { AlertDecision, AttentionNotice, PolicyEvent, PolicyRow, PolicyTask } from './attention.ts'
export { AttentionStore, attentionLedgerPath } from './attention-store.ts'
export type { AttentionLedger, NotificationRecord, NotificationState } from './attention-store.ts'

const V1_APP_VERSION = '1.0.0-dev'

/** The chime asset, resolved from the package root (src/ and lib/ sit one level under it). */
const CHIME_URL = new URL('../assets/TaskComplete.mp3', import.meta.url)

/** Plugin config. */
export interface Config {
  /**
   * The running app's version, compared against announcement min/max bounds;
   * `IDEALIZE_APP_VERSION` (set by the desktop shell) when empty.
   */
  appVersion?: string
}

export const Config: z<Config> = z.object({
  appVersion: z.string().default(''),
})

/** The ledger's read path. */
export const ATTENTION_PATH = '/idealize/notify/attention'
/** The read-position write path. */
export const ATTENTION_READ_PATH = '/idealize/notify/attention/read'
/** The alert-state write path. */
export const ATTENTION_STATE_PATH = '/idealize/notify/attention/state'

/**
 * Where transcoded system sounds are kept, beside the attention ledger.
 * @param dshHome - the resolved harness home.
 * @returns the cache folder.
 */
export function chimeSoundCacheDir(dshHome: string): string {
  return join(dshHome, 'idealize', 'notify', 'sounds')
}

/** The desktop shell's notify face, present only when the Electron host offers it. */
interface DesktopNotifyLike {
  notify(notification: { title: string; body: string }): void
}

/**
 * The host bridge's feed, read structurally: the alert reaches the window as
 * one more feed event, and a composition without the bridge simply records
 * the alert without raising it.
 */
interface BridgeLike {
  buffer: {
    push(event: { kind: 'attention'; title: string; body: string; project?: string; studioEvent?: string }): unknown
  }
}

/** `@idealize/studio`'s service, read structurally so no runtime dependency binds the two. */
interface StudioLike {
  state(project: string): Promise<{ tasks: { id: string; requester: string; goal: string }[] }>
}

function refuse(req: IncomingMessage, res: ServerResponse, mutating: boolean): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Probe the desktop shell's notify face without injecting it: the service is
 * absent in the browser-only composition and plain property access throws.
 * @param ctx - any context in the host tree.
 * @returns the shell's notify face, or undefined when no desktop shell is composed.
 */
export function desktopNotifier(ctx: Context): DesktopNotifyLike | undefined {
  const maybe = (ctx as unknown as { get(name: string): unknown }).get('desktopActions')
  return typeof (maybe as DesktopNotifyLike | undefined)?.notify === 'function'
    ? maybe as DesktopNotifyLike
    : undefined
}

/**
 * Probe the Studio without injecting it: this plugin records alerts about a
 * timeline it does not depend on, and a composition without one simply never
 * raises any.
 * @param ctx - any context in the host tree.
 * @returns the Studio service, or undefined when nothing provides it.
 */
function studioService(ctx: Context): StudioLike | undefined {
  return (ctx as unknown as { get(service: string): unknown }).get('idealizeStudio') as StudioLike | undefined
}

/**
 * Probe the host bridge the same way: without it the alert is recorded and no
 * window is told.
 * @param ctx - any context in the host tree.
 * @returns the bridge, or undefined when nothing provides it.
 */
function bridgeFeed(ctx: Context): BridgeLike | undefined {
  return (ctx as unknown as { get(service: string): unknown }).get('idealizeBridge') as BridgeLike | undefined
}

export function apply(ctx: Context, config: Config): void {
  const appVersion = (config.appVersion ?? '').trim() || (process.env.IDEALIZE_APP_VERSION ?? '').trim() || V1_APP_VERSION
  const home = resolveDshHome()
  const store = new AttentionStore(attentionLedgerPath(home))
  const sounds = createSoundLibrary(chimeSoundCacheDir(home))

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(settingsNamespace(NOTIFY_SETTINGS_NAMESPACE), NotifySettingsSchema)
  })

  // Every recorded Studio event meets the MVP table. The rows that alert are
  // recorded here and pushed to the window; the rows that do not are the
  // Askbar's chip fold and the timeline, which own themselves.
  ctx.on('idealize/studio-event', (event) => {
    void (async (): Promise<void> => {
      // Routine progress is most of the timeline, and the table answers it
      // without the fold. Only a failure's decision depends on the task, so
      // that is the one row worth reading the project's state for.
      const first = notificationPolicyFor(event)
      if (!first.alert && first.row !== 'failed') return
      let task: PolicyTask | undefined
      if (event.taskId !== undefined) {
        const state = await studioService(ctx)?.state(event.project)
        task = state?.tasks.find(row => row.id === event.taskId)
      }
      const decision = notificationPolicyFor(event, task)
      if (!decision.alert) return
      // A second arrival of one event keeps the first record and stays quiet.
      const { raised } = await store.recordSent({ event: String(event.id), project: event.project, row: decision.row })
      if (!raised) return
      const notice = attentionNotice(decision.row, event, task)
      bridgeFeed(ctx)?.buffer.push({
        kind: 'attention',
        title: notice.title,
        body: notice.body,
        project: event.project,
        studioEvent: String(event.id),
      })
    })().catch((error: unknown) => {
      ctx.logger.warn(`idealize-notify: the attention record failed: ${String(error)}`)
    })
  })

  ctx.inject(['webServer'], (webCtx) => {
    type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
    const register = (path: string, mutating: boolean, handler: RouteHandler): void => {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            if (refuse(req, res, mutating)) return
            try {
              await handler(req, res)
            } catch (error) {
              /* v8 ignore next -- every rejection these handlers raise is an Error; the cast only types a thrown non-Error. */
              sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        `idealize-notify: ${path}`,
      )
    }

    register('/idealize/notify/app', false, (_req, res) => {
      sendJson(res, 200, { appVersion })
    })

    register('/idealize/notify/chime.mp3', false, async (_req, res) => {
      const body = await readFile(CHIME_URL)
      res.writeHead(200, {
        'content-type': 'audio/mpeg',
        'content-length': body.length,
        'cache-control': 'public, max-age=86400',
      }).end(body)
    })

    register(CHIME_SOUNDS_PATH, false, async (_req, res) => {
      sendJson(res, 200, { sounds: await sounds.list() })
    })

    register(CHIME_SOUND_PATH, false, async (req, res) => {
      // The id is looked up, never joined onto a path: the catalogue is the fence.
      const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('id') ?? ''
      const found = await sounds.file(id)
      if (found === undefined) {
        sendJson(res, 404, { error: 'no such sound' })
        return
      }
      const body = await readFile(found.path)
      res.writeHead(200, {
        'content-type': found.contentType,
        'content-length': body.length,
        'cache-control': 'public, max-age=86400',
      }).end(body)
    })

    register(ATTENTION_PATH, false, async (_req, res) => {
      sendJson(res, 200, await store.load())
    })

    register(ATTENTION_READ_PATH, true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { project?: unknown; seq?: unknown }
      if (typeof body.project !== 'string' || body.project === '' || typeof body.seq !== 'number' || !Number.isInteger(body.seq) || body.seq < 0) {
        sendJson(res, 400, { ok: false, error: 'read position needs a project and a whole seq' })
        return
      }
      sendJson(res, 200, { ok: true, seq: await store.markRead(resolve(body.project), body.seq) })
    })

    register(ATTENTION_STATE_PATH, true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { event?: unknown; state?: unknown }
      if (typeof body.event !== 'string' || body.event === '' || (body.state !== 'opened' && body.state !== 'dismissed')) {
        sendJson(res, 400, { ok: false, error: 'alert state needs an event and opened|dismissed' })
        return
      }
      const record = await store.markState(body.event, body.state)
      if (record === undefined) {
        sendJson(res, 404, { ok: false, error: 'no alert was raised for that event' })
        return
      }
      sendJson(res, 200, { ok: true, record })
    })

    register('/idealize/notify/native', true, async (req, res) => {
      const notifier = desktopNotifier(webCtx)
      if (notifier === undefined) {
        sendJson(res, 409, { error: 'desktop shell not present' })
        return
      }
      const body = JSON.parse(await readBody(req)) as { title?: unknown; body?: unknown }
      const title = typeof body.title === 'string' && body.title !== '' ? body.title : 'IDEalize'
      notifier.notify({ title, body: typeof body.body === 'string' ? body.body : '' })
      sendJson(res, 200, { ok: true })
    })
  })
}

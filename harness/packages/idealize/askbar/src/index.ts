/**
 * @idealize/askbar — host half of the Askbar (A1 prototype): the roster
 * route the bar renders from, and the transform route that asks the desktop
 * shell to collapse to or expand from the bar.
 *
 * HTTP: `GET /idealize/askbar/roster?project=<folder>&sessions=<id,id>` joins
 * comm's chat listing, the project board's blockers and the Studio fold into
 * chip rows plus the bar's interaction timings; `sessions` names the sidebar's
 * rows in order, and without it every comm chat of the folder is covered.
 * `GET /idealize/askbar/owl.webp` serves the skin's still owl frame for the
 * Studio tile. `POST /idealize/askbar/transform` `{to: 'mini'|'maxi'}` drives
 * the desktop shell's window transform (loopback + `x-idealize-auth: 1`);
 * without a desktop shell it answers 501. Reads are loopback-only.
 *
 * comm and studio are probed, never injected: the roster degrades to an
 * empty listing without comm and to comm-only states without studio, so the
 * bar renders honestly in any composition.
 * @module @idealize/askbar
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { OWL_FRAME_STILL } from '@idealize/skin'
import type { StudioState } from '@idealize/studio'
import { assembleChips, assembleGroups, assembleGroupsOf, type CommBoardRow, type CommListRow } from './roster.ts'
import type { AskbarRosterGroup, AskbarRoster } from './types.ts'

export { chipStateOf } from './chip-state.ts'
export type { ChipAttention, ChipBlocker, ChipExecution, ChipStateInput } from './chip-state.ts'
export { portraitOf } from './portrait.ts'
export type { Portrait } from './portrait.ts'
export { assembleChips, assembleGroups, assembleGroupsOf } from './roster.ts'
export type { CommBoardRow, CommListRow } from './roster.ts'
export type { AskbarChip, AskbarConfigWire, AskbarEdge, AskbarRoster, ChipState } from './types.ts'

/** Roster path. */
export const ROSTER_PATH = '/idealize/askbar/roster'
/** Transform path. */
export const TRANSFORM_PATH = '/idealize/askbar/transform'
/** The still owl (the Studio tile's mark), served as WebP. */
export const OWL_PATH = '/idealize/askbar/owl.webp'

/**
 * Hold the bar's window at a width so a panel beside its column is not cut
 * off at the window edge. `POST { width }`; a width at or below the column's
 * own gives the room back.
 */
export const WIDTH_PATH = '/idealize/askbar/width'

/**
 * Give the bar's window the keyboard, or hand it back. `POST { focus }`. A
 * revealed panel asks for it so the person can type into the ask field from a
 * rollover (JJ, 14 Sep 2026); a closed panel gives it back so their typing
 * returns to the app they were in. The bar's window is a non-activating
 * panel, so taking the keyboard never brings the app forward.
 */
export const FOCUS_PATH = '/idealize/askbar/focus'

/** The skin's still frame decoded once from its data URI. */
const OWL_STILL_BYTES = Buffer.from(OWL_FRAME_STILL.slice(OWL_FRAME_STILL.indexOf(',') + 1), 'base64')

export const name = 'idealize-askbar'

/** Validated Askbar configuration: the bar's docked edge and its interaction timings. */
export interface Config {
  /** Screen edge the Askbar docks to (JJ, 1 Sep 2026: left, configurable). */
  edge: 'left' | 'right'
  /** Hover delay before a chip reveals its destination card, in milliseconds. */
  hoverRevealMs: number
  /** Pending-send countdown between releasing a hold and dispatch, in milliseconds (JJ, 1 Sep 2026: one second). */
  pendingSendMs: number
  /** Maxi/mini window transform animation duration, in milliseconds. */
  transformMs: number
  /** Roster poll interval for the bar renderer, in milliseconds. */
  pollMs: number
}

export const Config: z<Config> = z.object({
  /** Screen edge the bar docks to (JJ, 1 Sep 2026: left, configurable). */
  edge: z.union(['left', 'right'] as const).default('left').description('Screen edge the Askbar docks to.'),
  /** Hover delay before a chip reveals its destination card, in milliseconds. */
  hoverRevealMs: z.natural().default(150).description('Hover delay before a chip reveals its destination card (ms).'),
  /** Pending-send countdown after releasing a hold, in milliseconds (JJ, 1 Sep 2026: one second). */
  pendingSendMs: z.natural().default(1000).description('Countdown between releasing a hold and dispatch (ms).'),
  /** Window transform animation duration, in milliseconds. */
  transformMs: z.natural().default(200).description('Maxi/mini window transform animation duration (ms).'),
  /** Roster poll interval for the bar renderer, in milliseconds. */
  pollMs: z.natural().default(2000).description('Askbar roster poll interval (ms).'),
})

/** comm's command face, structurally (probed so comm stays optional). */
interface CommHandleLike {
  handle(request: { command: 'list' }): Promise<{ ok: boolean; sessions?: CommListRow[] }>
  /** An absent `path` answers every project's rungs, which the grouped read wants. */
  handle(request: { command: 'board'; path?: string }): Promise<{ ok: boolean; rungs?: CommBoardRow[] }>
}

/**
 * The terminal service slice the roster reads, structurally over `ctx.get`.
 * A Terminal chat runs somebody else's CLI rather than a harness agent, so
 * comm's `running` reads every busy shell as idle without this.
 */
interface TerminalsLike {
  working(): string[]
}

/** The Studio service slice the roster reads, structurally over `ctx.get`. */
interface StudioLike {
  state(project: string): Promise<StudioState>
  /** Every stored project's fold, which the grouped read uses in place of a call per project. */
  overview(): Promise<{ project: string; state: StudioState }[]>
}

/**
 * Each project's fold, keyed by project folder. A composition without the
 * Studio has no folds, and the groups then carry the states comm alone can
 * tell (running, blocked, unread) rather than none.
 * @param studio - the Studio service, or undefined when none is composed.
 * @returns the folds, empty when there is no Studio.
 */
async function foldsOf(studio: StudioLike | undefined): Promise<Map<string, StudioState>> {
  if (studio === undefined) return new Map()
  return new Map((await studio.overview()).map(row => [row.project, row.state]))
}

/** The desktop shell's transform face; the methods land with the Askbar window class. */
/** The host bridge's push face, restated (`@idealize/host-bridge` owns it; optional here). */
interface BridgeLike {
  buffer: { push: (event: { kind: 'open-studio' | 'new-chat'; title: string; body: string; project?: string }) => unknown }
}

interface DesktopTransformLike {
  collapseToBar?(): Promise<void> | void
  expandFromBar?(): Promise<void> | void
  setBarWidth?(width: number): void
  focusBar?(focus: boolean): void
}

// TODO extract one owner for the loopback fence trio (spaces, comm, activity-pills, studio, askbar all copy it).
/* jscpd:ignore-start */
/** Loopback fence plus the mutating-request header, matching the other IDEalize routes. */
function refuse(req: IncomingMessage, res: ServerResponse, mutating = false): boolean {
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

/** The roster query: the resolved project, the sessions to cover, and whether every project's agents ride along. */
interface RosterQuery {
  /** The resolved project folder, or '' for a window with no project yet. */
  project: string
  /** The sidebar's rows, in order; absent means every comm chat of the folder, empty means no chips. */
  sessions: readonly string[] | undefined
  /** True when the caller asked for every project's agents grouped (the sidebar rail). */
  all: boolean
}

/**
 * The roster query, parsed once. An empty `project` passes through as ''
 * (a window with no project yet gets an empty roster, not an error); an
 * absent `project` ends the response with a 400.
 */
function rosterQueryOf(req: IncomingMessage, res: ServerResponse): RosterQuery | undefined {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const project = url.searchParams.get('project')
  if (project === null) {
    sendJson(res, 400, { ok: false, error: 'missing project' })
    return undefined
  }
  const sessions = url.searchParams.get('sessions')
  return {
    project: project === '' ? '' : resolve(project),
    sessions: sessions === null ? undefined : sessions.split(',').filter(id => id !== ''),
    all: url.searchParams.get('all') === '1',
  }
}
/* jscpd:ignore-end */

export function apply(ctx: Context, config: Config): void {
  ctx.inject(['webServer'], (webCtx) => {
    type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
    const register = (path: string, handler: Handler): void => {
      webCtx.effect(
        () => webCtx.webServer.register({ kind: 'exact', path, handler }),
        `idealize-askbar: ${path}`,
      )
    }

    register(ROSTER_PATH, async (req, res) => {
      if (refuse(req, res)) return
      const query = rosterQueryOf(req, res)
      if (query === undefined) return
      const { project } = query
      try {
        // A window with no project yet polls with '': serve the timings and
        // no chips without asking comm for a board it cannot have.
        const commAll = webCtx.get('idealizeComm') as CommHandleLike | undefined
        const comm = project === '' ? undefined : commAll
        // A grouped read spans every project, so it lists even when this
        // window names none; a per-project read keeps its old silence.
        const lister = query.all ? commAll : comm
        const listing = lister === undefined ? undefined : await lister.handle({ command: 'list' })
        // A grouped read needs every project's rows, and this window's are
        // among them in the same newest-first order: one board read serves both.
        const everyRung = query.all ? (await commAll?.handle({ command: 'board' }))?.rungs ?? [] : undefined
        const board = comm === undefined
          ? undefined
          : everyRung === undefined
            ? await comm.handle({ command: 'board', path: project })
            : { rungs: everyRung.filter(row => row.projectPath === project) }
        const studioAll = webCtx.get('idealizeStudio') as StudioLike | undefined
        const studio = project === '' ? undefined : studioAll
        const state = studio === undefined ? undefined : await studio.state(project)
        // The sidebar rail spans every project, so it asks for the groups as
        // well: one listing, one board with no path, and one fold per project
        // the Studio has stored, rather than a read per project per poll.
        const working = new Set((webCtx.get('idealizeTerminals') as TerminalsLike | undefined)?.working() ?? [])
        // Rows named: the groups hold those rows in the order named (the
        // sidebar's). No rows named: every chat comm lists in each folder.
        let groups: AskbarRosterGroup[] | undefined
        if (query.all) {
          const rungs = everyRung ?? []
          const folds = await foldsOf(studioAll)
          groups = query.sessions === undefined
            ? assembleGroups(listing?.sessions ?? [], rungs, folds, working)
            : assembleGroupsOf(query.sessions, listing?.sessions ?? [], rungs, folds, working)
        }
        const roster: AskbarRoster = {
          project,
          config: {
            edge: config.edge,
            hoverRevealMs: config.hoverRevealMs,
            pendingSendMs: config.pendingSendMs,
            transformMs: config.transformMs,
            pollMs: config.pollMs,
            // ctx.get() probes a service this plugin does not inject: the
            // transcription seam is optional, and the bar works without it.
            speech: (webCtx as unknown as { get(name: string): unknown }).get('transcription') !== undefined,
          },
          chips: assembleChips(project, listing?.sessions ?? [], board?.rungs ?? [], state, query.sessions, working),
          ...groups === undefined ? {} : { groups },
        }
        sendJson(res, 200, roster)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })

    register(OWL_PATH, (req, res) => {
      if (refuse(req, res)) return Promise.resolve()
      // The frame is a build constant: cache it for the window's lifetime.
      res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' }).end(OWL_STILL_BYTES)
      return Promise.resolve()
    })

    register(WIDTH_PATH, async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
        return
      }
      if (refuse(req, res, true)) return
      let width: unknown
      try {
        ;({ width } = JSON.parse(await readBody(req)) as { width?: unknown })
      } catch {
        sendJson(res, 400, { ok: false, error: 'body is not JSON' })
        return
      }
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
        sendJson(res, 400, { ok: false, error: 'width must be a positive number' })
        return
      }
      const shell = webCtx.get('desktopActions') as DesktopTransformLike | undefined
      if (shell?.setBarWidth === undefined) {
        sendJson(res, 501, { ok: false, error: 'no desktop shell with a bar window is composed' })
        return
      }
      shell.setBarWidth(width)
      sendJson(res, 200, { ok: true })
    })

    register(FOCUS_PATH, async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
        return
      }
      if (refuse(req, res, true)) return
      let focus: unknown
      try {
        ;({ focus } = JSON.parse(await readBody(req)) as { focus?: unknown })
      } catch {
        sendJson(res, 400, { ok: false, error: 'body is not JSON' })
        return
      }
      if (typeof focus !== 'boolean') {
        sendJson(res, 400, { ok: false, error: 'focus must be a boolean' })
        return
      }
      const shell = webCtx.get('desktopActions') as DesktopTransformLike | undefined
      if (shell?.focusBar === undefined) {
        sendJson(res, 501, { ok: false, error: 'no desktop shell with a bar window is composed' })
        return
      }
      shell.focusBar(focus)
      sendJson(res, 200, { ok: true })
    })

    register(TRANSFORM_PATH, async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
        return
      }
      if (refuse(req, res, true)) return
      let to: unknown
      let open: unknown
      let project: unknown
      try {
        ;({ to, open, project } = JSON.parse(await readBody(req)) as { to?: unknown; open?: unknown; project?: unknown })
      } catch {
        sendJson(res, 400, { ok: false, error: 'body is not JSON' })
        return
      }
      if (to !== 'mini' && to !== 'maxi') {
        sendJson(res, 400, { ok: false, error: 'to must be "mini" or "maxi"' })
        return
      }
      if (open !== undefined && open !== 'studio' && open !== 'new') {
        sendJson(res, 400, { ok: false, error: 'open must be "studio" or "new" when present' })
        return
      }
      // The Studio request rides the host bridge feed, which the main window's
      // client already reads: it opens the Studio chat when the event lands.
      // The Studio spans every project (JJ, 3 Sep 2026), so the bar's project
      // is carried as context only. Pushed before the window transform so a
      // shell-less host (501 below) still serves a browser tab.
      if (open !== undefined) {
        const named = typeof project === 'string' && project !== '' ? project : undefined
        const relayed = open === 'studio'
          ? { kind: 'open-studio' as const, title: 'Open the Studio' }
          : { kind: 'new-chat' as const, title: 'Start a new chat' }
        ;(webCtx.get('idealizeBridge') as BridgeLike | undefined)?.buffer.push({
          ...relayed, body: named ?? '', ...named === undefined ? {} : { project: named },
        })
      }
      const actions = webCtx.get('desktopActions') as DesktopTransformLike | undefined
      const transform = to === 'mini' ? actions?.collapseToBar?.bind(actions) : actions?.expandFromBar?.bind(actions)
      if (transform === undefined) {
        sendJson(res, 501, { ok: false, error: 'no desktop shell with a window transform is composed' })
        return
      }
      try {
        await transform()
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })
}

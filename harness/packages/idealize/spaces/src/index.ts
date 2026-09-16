/**
 * @idealize/spaces — the space vocabulary and the durable record of which
 * space a chat is in.
 *
 * A space is what a chat IS: Chat, Terminal, Gallery, Sound Stage or Motion.
 * The spaces are declared in {@link SPACES}, not derived from the
 * `conversation.view` ring: a declared table states the roster whatever the
 * ring happens to carry, which is what let Motion appear as an ordinary tile
 * through the months it had no view. The ring keeps rendering the space; this
 * package owns the fact.
 *
 * The record is a session event, because the view ring's `view` field lives in
 * the browser's `localStorage` and cannot answer "which space is this chat" for
 * the sidebar, for the host, or on a second machine. `idealize/space` and
 * `idealize/brain` are appended with the envelope's `ignorable` marker and
 * projected as `space` and `brain`.
 *
 * The brain record is model-visible, not only durable:
 * {@link installBrainPrompt} contributes the logged brain's standing
 * instructions to the prompt of a chat the preset lock will no longer
 * recompose ({@link brainPersona}).
 *
 * HTTP:
 * - `POST /idealize/spaces/select` `{sessionId, space, brain?, instructions?}`
 *   records a chat's space, and its brain when one is named. Loopback-fenced
 *   and gated on `x-idealize-auth: 1`.
 * - `GET /idealize/spaces` serves the roster both welcome steps read: per
 *   space, its brain count and whether a model can serve it. The field split
 *   is the product invariant — see {@link spaceRoster}.
 * - `GET /idealize/spaces/icons/<space>.svg` serves each space's icon from
 *   `assets/icons/`, the one home of the six files every surface renders
 *   ({@link spaceIconSrc} names the URL). Loopback-only; any other path under
 *   the prefix answers 404 by table lookup, so no request text reaches the
 *   filesystem.
 *
 * Chats made before spaces existed are DERIVED, never backfilled: nothing is
 * written into an existing log ({@link deriveSpace}).
 * @module @idealize/spaces
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MEDIA_PRESETS, type GenerationAvailability } from '@idealize/generate'
import { installBrainPrompt } from './brain-prompt.ts'
import { brainProjectionDefinition, foldBrain, foldSpace, spaceProjectionDefinition } from './projection.ts'
import { RETIRED_ROLE_PRESETS, isSpaceId, SPACE_IDS, type SpaceId } from './space-table.ts'
import { SPACE_ICON_PATH } from './space-icons.ts'
import {
  chatModelResolves, ROSTER_PATH, spaceCapabilityRequirements, spaceRoster,
  type ActivitySpacesSection, type ChatModelSections,
} from './roster.ts'

export {
  CHAT_ONLY_PRESETS, DEFAULT_SPACE, deriveSpace, isSpaceId, LAUNCHABLE_SPACE_IDS, LAUNCHABLE_SPACES, presetSpaces,
  RETIRED_ROLE_PRESETS, SPACE_IDS, SPACES, spaceById,
} from './space-table.ts'
export type { SpaceComposition, SpaceDefinition, SpaceId, SpaceRecord } from './space-table.ts'
export {
  brainProjectionDefinition, foldBrain, foldBrainRecord, foldSpace, resolveSessionSpace,
  spaceProjectionDefinition,
} from './projection.ts'
export { brainPersona, installBrainPrompt } from './brain-prompt.ts'
export type { BrainPersona } from './brain-prompt.ts'
export type { BrainEventData, BrainProjection, SpaceEventData, SpaceProjection } from './projection-types.ts'
export { brainPresets, chatModelResolves, ROSTER_PATH, spaceCapabilityRequirements, spaceRoster } from './roster.ts'
export { SPACE_ICON_PATH, spaceIconSrc } from './space-icons.ts'
export type {
  ActivitySpacesSection, CapabilityPreset, ChatModelSections, RosterPreset, SpaceBrain, SpaceReason,
  SpaceRosterEntry, SpaceRosterFacts,
} from './roster.ts'

/**
 * The activity preset settings section. `@idealize/activity-pills` owns the
 * schema; this package reads its `spaces` and `models` maps.
 */
const ACTIVITY_NS = settingsNamespace('idealize-activity-pills')

/** The llm-pi-ai settings section (restated; `@idealize/models` owns the schema), read for the free route. */
const LLM_NS = settingsNamespace('llm-pi-ai')

/** Each media space's capability requirement; a space naming an undeclared preset throws at load. */
const SPACE_REQUIREMENTS = spaceCapabilityRequirements(MEDIA_PRESETS)

/**
 * Read an optional service. `ctx.get` reads the global service store, which is
 * how a package asks for a service it does not inject: the generation seam, the
 * `idealize` command service and the desktop shell each ship in some
 * compositions and not others.
 */
function optional(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(name: string): unknown }).get(name)
}

/** Availability per media capability, or undefined while no generation service is composed at all. */
function mediaAvailability(ctx: Context): Record<string, GenerationAvailability> | undefined {
  const generation = ctx.get('generation')
  if (generation === undefined) return undefined
  const availability: Record<string, GenerationAvailability> = {}
  for (const [capability, requirements] of SPACE_REQUIREMENTS) {
    availability[capability] = generation.availability(requirements)
  }
  return availability
}

/**
 * The preset ids carrying agent roles — both coordinators, the project one and
 * the Studio one — plus the retired ones, which stay opt-in; role ids are
 * empty while `@idealize/comm` is not composed.
 */
function rolePresets(ctx: Context): string[] {
  const comm = optional(ctx, 'idealizeComm') as
    { config?: () => { projectAgentPreset?: string; studioAgentPreset?: string } } | undefined
  const roles = comm?.config?.()
  // An untyped `ctx.get` probe: a composition may carry an older settings
  // shape, so each id is taken only when it is there.
  const named = [roles?.projectAgentPreset, roles?.studioAgentPreset]
  return [...named.filter(id => id !== undefined), ...RETIRED_ROLE_PRESETS]
}

/** Whether the desktop shell is present, which the terminal space needs; the same probe the pill row makes. */
function desktopShell(ctx: Context): boolean {
  const actions = optional(ctx, 'desktopActions') as { openTerminal?: unknown } | undefined
  return typeof actions?.openTerminal === 'function'
}

/** Cordis plugin name. */
export const name = 'idealize-spaces'

/** The route that records a chat's space. */
export const SELECT_PATH = '/idealize/spaces/select'

/**
 * The space an icon request names: the pathname must be exactly
 * `/idealize/spaces/icons/<space>.svg` for a declared space id. Anything else,
 * including a traversal attempt, is undefined; the id is then a table member,
 * so the file path built from it carries no request text.
 * @param pathname - the request's pathname, query already stripped.
 * @returns the declared space, or undefined when the path names none.
 */
export function iconSpace(pathname: string): SpaceId | undefined {
  const prefix = `${SPACE_ICON_PATH}/`
  if (!pathname.startsWith(prefix) || !pathname.endsWith('.svg')) return undefined
  const id = pathname.slice(prefix.length, -'.svg'.length)
  return isSpaceId(id) ? id : undefined
}

/** The packaged icon file for one declared space. */
function iconFile(id: SpaceId): URL {
  return new URL(`../assets/icons/${id}.svg`, import.meta.url)
}

/** An accepted selection, or the refusal to send back as a 400. */
export type SpaceSelection =
  | { ok: true; sessionId: string; space: SpaceId; brain?: string; instructions?: string }
  | { ok: false; error: string }

/**
 * Validate one POST body for the selection route. The wire is where shapes are
 * checked; the append path then trusts what it receives.
 * @param body - the parsed JSON body (wire boundary: untrusted).
 * @returns the accepted selection, or the refusal.
 */
export function parseSelection(body: unknown): SpaceSelection {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const { sessionId, space, brain, instructions } = body as Record<string, unknown>
  if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, error: 'sessionId is required' }
  if (!isSpaceId(space)) return { ok: false, error: `space must be one of: ${SPACE_IDS.join(', ')}` }
  const selection: SpaceSelection = { ok: true, sessionId, space }
  if (brain !== undefined) {
    if (typeof brain !== 'string' || brain === '') return { ok: false, error: 'brain must be an agent preset id' }
    selection.brain = brain
  }
  if (instructions !== undefined) {
    if (typeof instructions !== 'string') return { ok: false, error: 'instructions must be a string' }
    selection.instructions = instructions
  }
  return selection
}

/**
 * Record a chat's space, and its brain when the selection names one.
 *
 * Both events carry the envelope's `ignorable` marker: a reader without this
 * vocabulary resolves the chat's space through the derivation ladder instead of
 * refusing the log. An event is skipped when the log already records the same
 * value, so re-entering a space does not grow the log.
 * @param session - the chat to record against.
 * @param selection - the validated selection.
 * @returns which events were appended.
 */
export function recordSelection(
  session: Session,
  selection: Extract<SpaceSelection, { ok: true }>,
): { space: boolean; brain: boolean } {
  const spaceChanged = foldSpace(session.events) !== selection.space
  if (spaceChanged) session.append('idealize/space', { space: selection.space }, { ignorable: true })
  const brain = selection.brain
  const brainChanged = brain !== undefined && foldBrain(session.events) !== brain
  if (brainChanged) {
    session.append('idealize/brain', {
      brain,
      ...selection.instructions === undefined ? {} : { instructions: selection.instructions },
    }, { ignorable: true })
  }
  return { space: spaceChanged, brain: brainChanged }
}

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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/**
 * Register the space and brain projections, the selection route, and the
 * roster route.
 * @param ctx - the host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(spaceProjectionDefinition)
    projectionCtx.sessionProjections.register(brainProjectionDefinition)
  })

  // The logged brain's voice. Separate child from the projections above: a
  // headless composition assembles prompts with no projection registry, and a
  // cold projection read mounts no prompt registry.
  ctx.inject(['systemPrompt'], installBrainPrompt)

  ctx.inject(['webServer', 'sessions'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: SELECT_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
            return
          }
          if (refuse(req, res, true)) return
          let body: unknown
          try {
            body = JSON.parse(await readBody(req))
          } catch {
            sendJson(res, 400, { error: 'body is not JSON' })
            return
          }
          const selection = parseSelection(body)
          if (!selection.ok) {
            sendJson(res, 400, { error: selection.error })
            return
          }
          const session = webCtx.sessions.get(SessionId(selection.sessionId))
          if (session === undefined) {
            sendJson(res, 404, { error: `no live session "${selection.sessionId}"` })
            return
          }
          const recorded = recordSelection(session, selection)
          sendJson(res, 200, { ok: true, space: selection.space, recorded })
        },
      }),
      `idealize-spaces: POST ${SELECT_PATH}`,
    )
  })

  ctx.inject(['webServer'], (iconCtx) => {
    // Read once per process; the files change only with a build. The
    // response is `no-cache` with an ETag rather than the askbar owl's
    // year-long immutable cache: JJ reviews these drafts build by build, and an
    // immutable entry in the desktop shell's HTTP cache would keep showing the
    // previous build's icon. A repeat load costs a 304.
    const icons = new Map<SpaceId, { body: Buffer; etag: string }>()
    iconCtx.effect(
      () => iconCtx.webServer.register({
        kind: 'prefix',
        path: SPACE_ICON_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET' }).end('GET only')
            return
          }
          if (refuse(req, res)) return
          /* v8 ignore next -- a served request always carries a url; the guard only types the read. */
          const id = iconSpace(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
          if (id === undefined) {
            res.writeHead(404, { 'content-type': 'text/plain' }).end('no such space icon')
            return
          }
          let icon = icons.get(id)
          if (icon === undefined) {
            const body = await readFile(iconFile(id))
            icon = { body, etag: `"${createHash('sha1').update(body).digest('hex')}"` }
            icons.set(id, icon)
          }
          if (req.headers['if-none-match'] === icon.etag) {
            res.writeHead(304, { etag: icon.etag, 'cache-control': 'no-cache' }).end()
            return
          }
          res.writeHead(200, {
            'content-type': 'image/svg+xml',
            'content-length': icon.body.length,
            'cache-control': 'no-cache',
            etag: icon.etag,
          }).end(icon.body)
        },
      }),
      `idealize-spaces: GET ${SPACE_ICON_PATH}/<space>.svg`,
    )
  })

  ctx.inject(['webServer', 'agentPresets', 'settings'], (rosterCtx) => {
    rosterCtx.effect(
      () => rosterCtx.webServer.register({
        kind: 'exact',
        path: ROSTER_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET' }).end('GET only')
            return
          }
          if (refuse(req, res)) return
          const activity = rosterCtx.settings.get(ACTIVITY_NS) as ActivitySpacesSection | undefined
          const presets = await rosterCtx.agentPresets.list()
          sendJson(res, 200, {
            spaces: spaceRoster({
              presets: presets
                .filter(preset => preset.broken === undefined)
                .map(preset => ({ id: preset.id, name: preset.name ?? preset.id, trust: preset.trust })),
              rolePresets: rolePresets(rosterCtx),
              storedSpaces: activity?.spaces ?? {},
              storedModels: activity?.models ?? {},
              defaultPreset: rosterCtx.agentPresets.defaultId,
              mediaAvailability: mediaAvailability(rosterCtx),
              chatModel: chatModelResolves({
                activity,
                defaultModel: rosterCtx.settings.get(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE) as
                  ChatModelSections['defaultModel'],
                llm: rosterCtx.settings.get(LLM_NS) as ChatModelSections['llm'],
              }),
              desktopShell: desktopShell(rosterCtx),
            }),
          })
        },
      }),
      `idealize-spaces: GET ${ROSTER_PATH}`,
    )
  })
}

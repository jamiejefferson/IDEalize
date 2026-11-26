/**
 * @idealize/gen-tools — host half: seeds the three media agent presets
 * (Gallery, Sound Stage, Video) into the user preset root the first time a
 * deployment runs without any of them, so the welcome card's Images, Sounds
 * and Video choices have presets to select. Each seeded composition carries
 * ONLY the generation toolset — its persona, the `@idealize/gen-tools/tools`
 * row, and the background-job controls — so a generating session composes no
 * shell, filesystem, web, or delegation tools (AC-06). Seeding never
 * overwrites: a root that holds any media agent id is left as it is, so a
 * user who deletes one keeps that deletion (the `@idealize/activity-pills`
 * seeding rule).
 *
 * The same composition is what every brain confined to generating spaces
 * gets, seeded or not: `mediaCompositionFor` builds it for
 * `@idealize/activity-pills`, which applies it when a brain is created or
 * saved into Images, Sounds or Video and repairs presets that predate the
 * rule at startup.
 *
 * The tools themselves live at `@idealize/gen-tools/tools`, registered from
 * the preset compositions rather than here — a host-plane registration would
 * put the generation tools in every session's catalogue.
 * @module @idealize/gen-tools
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { COMPOSITION_FILE, METADATA_FILE, renderPresetMetadata } from '@deepseek-ai/dsh-agent-presets'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { MEDIA_AGENTS, buildMediaComposition, hasMediaAgentPresets } from './presets.ts'
import { approvedOf, approvedRows, GEN_TOOLS_NS, GenToolsSettings } from './approved.ts'

export { approvalKey } from './paid.ts'
export { approvedRows, GEN_TOOLS_NS, GenToolsSettings } from './approved.ts'
export type { ApprovedModelRow } from './approved.ts'

export {
  GENERATION_ONLY_PLUGINS, MEDIA_AGENTS, MEDIA_AGENT_IDS, buildMediaComposition, generatesOnly, hasMediaAgentPresets,
  isGenerationOnlyComposition, mediaAgentsBySpace, mediaCompositionFor, mediaPersona,
} from './presets.ts'
export type { MediaAgentDefinition } from './presets.ts'
export type { GenerationReroutedData } from './types.ts'

/** Plugin config. */
export interface Config {
  /**
   * The preset root the media agents are written to. Defaults to the
   * roster's own user root (`$DSH_HOME/.agent-presets`), which is where
   * `dsh-agent-presets` reads locally authored presets from.
   */
  root?: string
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  root: z.string(),
})

/** Cordis plugin name. */
export const name = 'idealize-gen-tools'
/** Required services. */
export const inject = ['agentPresets']

/**
 * Seed the media agent presets unless the roster already carries one.
 * @param ctx - the host plugin context (its `agentPresets` roster is consulted).
 * @param root - the preset root directory the agents are written into.
 * @returns resolves once seeding finished or was skipped.
 */
export async function seedMediaAgents(ctx: Context, root: string): Promise<void> {
  const roster = await ctx.agentPresets.list()
  if (hasMediaAgentPresets(roster.map(preset => preset.id))) return
  for (const agent of MEDIA_AGENTS) {
    const directory = join(root, agent.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(join(directory, COMPOSITION_FILE), buildMediaComposition(agent), { mode: 0o600 })
    const metadata = renderPresetMetadata({ name: agent.name, description: agent.description, order: agent.order })
    /* v8 ignore next -- every media agent is a module constant carrying a name, a description and an order, so metadata always renders. */
    if (metadata !== undefined) await writeFile(join(directory, METADATA_FILE), metadata, { mode: 0o600 })
  }
  ctx.logger.info(`gen-tools: seeded ${String(MEDIA_AGENTS.length)} media agents (${MEDIA_AGENTS.map(agent => agent.id).join(', ')}) into ${root}`)
}

/**
 * Seed the media agents once the roster service is up.
 * @param ctx - the host plugin context.
 * @param config - the seeding root.
 */
export function apply(ctx: Context, config: Config): void {
  const root = config.root === undefined || config.root === ''
    ? dshHomePath('.agent-presets')
    : expandHomePath(config.root)
  seedMediaAgents(ctx, root).catch((error: unknown) => {
    ctx.logger.warn(`gen-tools: seeding failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  installSettingsSection(ctx, GEN_TOOLS_NS, GenToolsSettings, { approved: {} }, { setSource: () => {}, onChange: () => {} })
  installApprovedRoute(ctx)
}

/** The route listing the Studio models a person approved, and taking one off the list. */
export const APPROVED_PATH = '/idealize/generate/approved'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Mount {@link APPROVED_PATH}. GET answers `{ models }`, one row per approved
 * model. POST `{ key, approved: false }` removes a model, so Studio asks again
 * before its next use. POST with `approved: true` is refused: a yes is only
 * ever given to the question that shows the price. Loopback only; the POST
 * demands the `x-idealize-auth` header.
 * @param ctx - the host plugin context.
 */
export function installApprovedRoute(ctx: Context): void {
  ctx.inject(['webServer', 'settings'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: APPROVED_PATH,
      handler: async (req, res) => {
        const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
        if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
          res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
          return
        }
        if (req.method === 'GET') {
          sendJson(res, 200, { models: approvedRows(approvedOf(webCtx.settings)) })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST' }).end('GET or POST only')
          return
        }
        if (req.headers['x-idealize-auth'] !== '1') {
          res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
          return
        }
        let body: { key?: unknown; approved?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as { key?: unknown; approved?: unknown }
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' })
          return
        }
        if (typeof body.key !== 'string' || body.key === '' || body.approved !== false) {
          sendJson(res, 400, { error: 'send { key, approved: false } to have Studio ask again for a model' })
          return
        }
        const { [body.key]: _removed, ...rest } = approvedOf(webCtx.settings)
        // A merge cannot drop a key, and the section holds this one field.
        await webCtx.settings.replace(GEN_TOOLS_NS, { approved: rest })
        sendJson(res, 200, { ok: true, models: approvedRows(rest) })
      },
    }), `gen-tools: ${APPROVED_PATH}`)
  })
}

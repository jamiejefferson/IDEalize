/**
 * The `/idealize/brains/media` route: GET lists every media preset with its
 * stored model choice, compatibility-filtered candidates, and availability;
 * POST stores (or clears) one preset's choice in the `idealize-activity-pills`
 * settings section's `models` map, beside the activity agents' choices.
 * The `/idealize/brains/media-keys` route: GET lists the backends that take a
 * key from the person with whether one is stored; POST stores (or, with an
 * empty key, removes) one backend's key through `ctx.credentials` and
 * refreshes that backend's catalogue. The `/idealize/generate/inputs` route:
 * GET with `?space=` answers the space's chosen media model and the inputs a
 * person may choose for it, read from the model's own schema. Loopback-fenced;
 * the mutations demand the `x-idealize-auth` header.
 * @module @idealize/generate/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  applyMediaSelection,
  MEDIA_PRESETS,
  mediaPresetStates,
  parseMediaSelection,
  presetIdForSpace,
  storedMediaModel,
} from './media.ts'
import type { ActivityModelsSectionFace, GenerationInputQueries, GenerationKeyQueries, GenerationQueries } from './media.ts'

/**
 * Twin of `normalizeApiKey` in `@deepseek-ai/dsh-llm` (mirrored by
 * `LEGAL_API_KEY` in `dsh-client-ui-settings-models` and `@idealize/onboarding`):
 * printable ASCII, space excluded.
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/** The activity preset settings section (that plugin owns the schema; the media choices share its `models` map). */
const ACTIVITY_NS = settingsNamespace('idealize-activity-pills')

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
 * Mount the media preset route and the inputs route while a web server and
 * settings service are composed beside the generation service.
 * @param ctx - the generation service's plugin context.
 * @param runtime - the catalogue, key and input queries the routes read.
 */
export function installMediaRoutes(ctx: Context, runtime: GenerationQueries & GenerationKeyQueries & GenerationInputQueries): void {
  installMediaKeyRoute(ctx, runtime)
  ctx.inject(['webServer', 'settings'], (webCtx) => {
    const section = (): ActivityModelsSectionFace | undefined =>
      webCtx.settings.get(ACTIVITY_NS) as ActivityModelsSectionFace | undefined

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/generate/inputs',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET' }).end('method not allowed')
          return
        }
        if (refuse(req, res)) return
        const space = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('space') ?? ''
        const presetId = presetIdForSpace(space)
        if (presetId === undefined) {
          sendJson(res, 400, { error: 'space must name a generating space: gallery, soundstage or motion' })
          return
        }
        const stored = storedMediaModel(section(), presetId)
        if (stored === null) {
          sendJson(res, 200, { model: null, fields: [] })
          return
        }
        const model = { provider: stored.backend, model: stored.model }
        try {
          sendJson(res, 200, { model, fields: await runtime.inputs(stored) })
        } catch (error) {
          // The strip still renders without the fields; the schema fetch retries on the next open.
          webCtx.logger.warn(`idealize-generate: input schema for ${stored.backend}/${stored.model} unavailable: ${error instanceof Error ? error.message : String(error)}`)
          sendJson(res, 200, { model, fields: [] })
        }
      },
    }), 'idealize-generate: /idealize/generate/inputs')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/brains/media',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          if (refuse(req, res)) return
          sendJson(res, 200, { presets: mediaPresetStates(runtime, section()) })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST' }).end('method not allowed')
          return
        }
        if (refuse(req, res, true)) return
        let body: unknown
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' })
          return
        }
        const selection = parseMediaSelection(body)
        if (!selection.ok) {
          sendJson(res, 400, { error: selection.error })
          return
        }
        if (selection.model !== null) {
          const chosen = selection.model
          const preset = MEDIA_PRESETS.find(candidate => candidate.id === selection.id)
          const offered = preset !== undefined && runtime.compatible(preset.requiredCapabilities)
            .some(entry => entry.backend === chosen.backend && entry.model.id === chosen.model)
          if (!offered) {
            sendJson(res, 400, {
              error: `model "${selection.model.backend}/${selection.model.model}" is not a compatible candidate for preset "${selection.id}"`,
            })
            return
          }
        }
        const current = section()
        if (current === undefined) {
          sendJson(res, 503, { error: 'the activity preset settings section is not available' })
          return
        }
        const models = applyMediaSelection(current, selection.id, selection.model)
        await webCtx.settings.update(ACTIVITY_NS, { models })
        sendJson(res, 200, { ok: true, id: selection.id, model: selection.model })
      },
    }), 'idealize-generate: /idealize/brains/media')
  })
}

/**
 * Mount the media-keys route while a web server and credential store are
 * composed beside the generation service.
 * @param ctx - the generation service's plugin context.
 * @param runtime - the key queries the route reads and the refresh it triggers.
 */
function installMediaKeyRoute(ctx: Context, runtime: GenerationKeyQueries): void {
  ctx.inject(['webServer', 'credentials'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/brains/media-keys',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          if (refuse(req, res)) return
          sendJson(res, 200, { providers: runtime.credentials() })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST' }).end('method not allowed')
          return
        }
        if (refuse(req, res, true)) return
        let body: { backend?: unknown; apiKey?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as typeof body
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' })
          return
        }
        const provider = runtime.credentials().find(row => row.backend === body.backend)
        if (provider === undefined) {
          sendJson(res, 400, { error: 'backend must name a registered backend that takes a key' })
          return
        }
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        if (apiKey !== '' && !LEGAL_API_KEY.test(apiKey)) {
          sendJson(res, 400, { error: 'apiKey contains characters an API key cannot carry' })
          return
        }
        const ref = credentialRef(provider.env)
        if (apiKey === '') await webCtx.credentials.unset(ref)
        else await webCtx.credentials.set(ref, apiKey)
        try {
          await runtime.refreshBackend(provider.backend)
        } catch (error) {
          // The key is stored either way; the refresh's failure is the catalogue's news, reported beside the state.
          const connected = runtime.credentials().find(row => row.backend === provider.backend)?.connected ?? false
          const refresh = error instanceof Error ? error.message : String(error)
          sendJson(res, 200, { ok: true, backend: provider.backend, connected, refresh })
          return
        }
        const connected = runtime.credentials().find(row => row.backend === provider.backend)?.connected ?? false
        sendJson(res, 200, { ok: true, backend: provider.backend, connected })
      },
    }), 'idealize-generate: /idealize/brains/media-keys')
  })
}

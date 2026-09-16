/**
 * IDEalize free tokens: the `freetokens` provider over a FreeLLMAPI sidecar
 * (our fork: jamiejefferson/idealize-freellmapi). Two modes:
 *
 * - **Embedded** (config `sidecarDir` or `serverBundle` set, or the desktop
 *   pointing IDEALIZE_FREETOKENS_SERVER at its shipped single-file server
 *   bundle): the plugin spawns the forked server itself on a private
 *   loopback port with its own data directory
 *   under the harness home, provisions it hands-free (first-run setup +
 *   unified key over loopback), stores the credentials and registers the
 *   provider route — zero user setup. The user's only job is adding
 *   upstream provider keys (OpenRouter first) on the page.
 * - **Adopt** (no `sidecarDir`): detect an already-running instance (JJ's
 *   own on 3001) and register it with a pasted key, as before.
 *
 * Registration writes two places:
 * - the key goes into the credentials service under FREETOKENS_API_KEY, and
 * - the settings document's `llm-pi-ai:` section gains a hand-declared
 *   `freetokens` route (openai-completions at the sidecar's /v1) listing the
 *   models the sidecar reported.
 *
 * HTTP surface (loopback-fenced; adopt demands the header):
 * - GET  /idealize/freetokens — status page (sidecar detected, route state).
 * - POST /idealize/freetokens/adopt — {apiKey} verify + register.
 * - GET  /idealize/freetokens/status — the same facts as JSON.
 * - GET  /idealize/freetokens/routing — the engine's routing strategy, its
 *   active weight vector (null in priority mode), the saved custom vector
 *   and the per-model score breakdown (engine GET /api/fallback/routing).
 * - POST /idealize/freetokens/routing/strategy — {strategy, weights?}: switch
 *   the engine's strategy; weights {reliability, speed, intelligence} are
 *   any non-negative vector, saved as the custom vector (engine PUT
 *   /api/fallback/routing). Reliability is one weight of the engine's convex
 *   score, drawn per request from each model's success/failure posterior.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

import { readAdminPassword, writeAdminPassword } from './admin-password.ts'
import { IdealizeAttribution } from './attribution.ts'
import { SidecarManager } from './sidecar.ts'
import { spendPage } from './spend-page.ts'
import { statusPage } from './status-page.ts'

export { IdealizeAttribution, PROJECT_HEADER } from './attribution.ts'

const KEY_ENV = 'FREETOKENS_API_KEY'
const ADMIN_PASSWORD_ENV = 'FREETOKENS_ADMIN_PASSWORD'
const LLM_NS = settingsNamespace('llm-pi-ai')
/** The engine's routing strategies: the manual chain, four scored presets, or the saved custom vector. */
const ROUTING_STRATEGIES = ['priority', 'balanced', 'smartest', 'fastest', 'reliable', 'custom'] as const
const ROUTING_AXES = ['reliability', 'speed', 'intelligence'] as const

/** Plugin config: an external engine origin, or one of the two embedded-mode entry points. */
export interface Config {
  /** The sidecar's origin; /v1 is appended for the provider route. */
  baseURL?: string
  /** The fork checkout's `server` directory; set = embedded mode. */
  sidecarDir?: string
  /**
   * Absolute path to a single-file server bundle (esbuild output); set =
   * embedded mode. The desktop app ships one in its resources and points
   * here through the IDEALIZE_FREETOKENS_SERVER env var, which fills this
   * in when neither it nor sidecarDir is configured.
   */
  serverBundle?: string
  /** Loopback port the embedded sidecar binds. */
  sidecarPort?: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default('http://127.0.0.1:3001'),
  sidecarDir: z.string(),
  serverBundle: z.string(),
  sidecarPort: z.number().default(3213),
})

interface SidecarStatus {
  baseURL: string
  detected: boolean
  keyStored: boolean
  routeRegistered: boolean
  modelCount?: number
  /** Embedded-mode lifecycle: starting → up with N models / failed: reason. */
  embedded?: string
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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/** Whether anything answers at the sidecar origin (no key needed). */
async function detectSidecar(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(baseURL, { signal: AbortSignal.timeout(3_000) })
    return res.status < 500
  } catch {
    return false
  }
}

/** Verify a key against the sidecar and return the model ids it serves. */
async function verifyKey(baseURL: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseURL}/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`sidecar rejected the key (HTTP ${res.status})`)
  const parsed = await res.json() as { data?: { id?: unknown }[] }
  const ids = (parsed.data ?? [])
    .map(row => typeof row.id === 'string' ? row.id : '')
    .filter(id => id !== '')
  if (ids.length === 0) throw new Error('sidecar reported no models')
  return ids
}

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(IdealizeAttribution)
  const present = (value: string | undefined): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined
  const sidecarDir = present(config.sidecarDir)
  const bundle = present(config.serverBundle) ?? (sidecarDir === undefined ? present(process.env.IDEALIZE_FREETOKENS_SERVER) : undefined)
  const entry = sidecarDir !== undefined ? join(sidecarDir, 'dist', 'index.js') : bundle
  const embedded = entry !== undefined
  const baseURL = embedded
    ? `http://127.0.0.1:${config.sidecarPort ?? 3213}`
    : (config.baseURL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

  ctx.inject(['webServer', 'credentials', 'settings'], (webCtx) => {
    let embedState = embedded ? 'starting' : undefined

    /** Store the key and write the provider route — shared by adopt + embedded. */
    const registerRoute = async (apiKey: string): Promise<number> => {
      const models = await verifyKey(baseURL, apiKey)
      await webCtx.credentials.set(credentialRef(KEY_ENV), apiKey)
      await webCtx.settings.update(LLM_NS, {
        providers: {
          freetokens: {
            displayName: 'Free tokens',
            apiKeyEnv: KEY_ENV,
            api: 'openai-completions',
            baseURL: `${baseURL}/v1`,
            models: models.map(id => ({ id })),
          },
        },
      })
      return models.length
    }

    /** Fresh dashboard session via the stored admin password (embedded only). */
    const adminToken = async (): Promise<string> => {
      const stored = await webCtx.credentials.resolve(credentialRef(ADMIN_PASSWORD_ENV))
      if (stored === undefined) throw new Error('no stored admin password; the sidecar was not provisioned by this host')
      const res = await fetch(`${baseURL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'host@idealize.local', password: stored.value }),
        signal: AbortSignal.timeout(10_000),
      })
      const body = await res.json() as { token?: string }
      if (typeof body.token !== 'string') throw new Error(`sidecar login failed (HTTP ${res.status})`)
      return body.token
    }

    if (entry !== undefined) {
      const dataDir = join(resolveDshHome(), 'freetokens-data')
      const manager = new SidecarManager({
        entry,
        // The dev checkout expects its own directory; the single-file
        // bundle has no package context, so it runs from the data dir.
        ...sidecarDir !== undefined ? { cwd: sidecarDir } : { cwd: dataDir },
        port: config.sidecarPort ?? 3213,
        dataDir,
        log: (message) => { webCtx.logger.warn(message) },
      })
      webCtx.effect(() => {
        void (async () => {
          await manager.start()
          const stored = await webCtx.credentials.resolve(credentialRef(ADMIN_PASSWORD_ENV))
          // The credential store and the sidecar's database can be reset
          // independently, and setup runs once per database: without the
          // record kept beside the data, a lost credential leaves the
          // embedded sidecar unable to log in or to set up ever again.
          const recovered = stored?.value ?? readAdminPassword(dataDir)
          const provisioned = await manager.provision(recovered)
          if (provisioned.adminPassword !== undefined) {
            await webCtx.credentials.set(credentialRef(ADMIN_PASSWORD_ENV), provisioned.adminPassword)
            writeAdminPassword(dataDir, provisioned.adminPassword)
          } else if (stored?.value === undefined && recovered !== undefined) {
            // Recovered from the file: put the credential store back in step.
            await webCtx.credentials.set(credentialRef(ADMIN_PASSWORD_ENV), recovered)
          } else if (recovered !== undefined && readAdminPassword(dataDir) === undefined) {
            // A data directory provisioned before this record existed.
            writeAdminPassword(dataDir, recovered)
          }
          // A cold data dir serves an empty catalog until the first
          // catalog-sync lands, so registration retries across that window.
          for (let attempt = 1; ; attempt += 1) {
            try {
              const count = await registerRoute(provisioned.apiKey)
              embedState = `up with ${count} models`
              return
            } catch (error) {
              embedState = `registration attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`
              if (attempt >= 20) throw error
              await new Promise(resolve => setTimeout(resolve, 5_000))
            }
          }
        })().catch((error: unknown) => {
          embedState = `failed: ${error instanceof Error ? error.message : String(error)}`
          webCtx.logger.warn(`freetokens: embedded sidecar ${embedState}`)
        })
        return () => { manager.stop() }
      }, 'idealize-freetokens: embedded sidecar')
    }

    const status = async (): Promise<SidecarStatus> => {
      const detected = await detectSidecar(baseURL)
      const keyStored = (await webCtx.credentials.resolve(credentialRef(KEY_ENV))) !== undefined
      const section = webCtx.settings.get(LLM_NS) as
        { providers?: Record<string, { models?: unknown[] }> } | undefined
      const route = section?.providers?.freetokens
      return {
        baseURL,
        detected,
        keyStored,
        routeRegistered: route !== undefined,
        ...Array.isArray(route?.models) ? { modelCount: route.models.length } : {},
        ...embedState === undefined ? {} : { embedded: embedState },
      }
    }

    const register = (
      path: string,
      mutating: boolean,
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
    ): void => {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            if (refuse(req, res, mutating)) return
            try {
              await handler(req, res)
            } catch (error) {
              sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        `idealize-freetokens: ${path}`,
      )
    }

    register('/idealize/freetokens', false, async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(statusPage(await status()))
    })

    register('/idealize/freetokens/status', false, async (_req, res) => {
      sendJson(res, 200, await status())
    })

    register('/idealize/freetokens/provider-keys', false, async (_req, res) => {
      const token = await adminToken()
      const upstream = await fetch(`${baseURL}/api/keys`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      sendJson(res, upstream.ok ? 200 : 502, await upstream.json())
    })

    register('/idealize/freetokens/routing', false, async (_req, res) => {
      const token = await adminToken()
      const upstream = await fetch(`${baseURL}/api/fallback/routing`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      sendJson(res, upstream.ok ? 200 : 502, await upstream.json())
    })

    register('/idealize/freetokens/routing/strategy', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { strategy?: unknown; weights?: unknown }
      const strategy = ROUTING_STRATEGIES.find(name => name === body.strategy)
      if (strategy === undefined) {
        sendJson(res, 400, { error: `strategy must be one of ${ROUTING_STRATEGIES.join(', ')}` })
        return
      }
      let weights: Record<typeof ROUTING_AXES[number], number> | undefined
      if (body.weights !== undefined) {
        const given = body.weights as Record<string, unknown>
        const axis = (value: unknown): number | undefined =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
        const vector = { reliability: axis(given.reliability), speed: axis(given.speed), intelligence: axis(given.intelligence) }
        if (ROUTING_AXES.some(key => vector[key] === undefined) || ROUTING_AXES.every(key => vector[key] === 0)) {
          sendJson(res, 400, { error: 'weights need reliability, speed and intelligence as non-negative numbers, not all zero' })
          return
        }
        weights = vector as Record<typeof ROUTING_AXES[number], number>
      }
      const token = await adminToken()
      const upstream = await fetch(`${baseURL}/api/fallback/routing`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ strategy, ...weights === undefined ? {} : { weights } }),
        signal: AbortSignal.timeout(10_000),
      })
      sendJson(res, upstream.ok ? 200 : 502, await upstream.json())
    })

    register('/idealize/freetokens/provider-key', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { platform?: unknown; key?: unknown; label?: unknown }
      if (typeof body.platform !== 'string' || body.platform === '') {
        sendJson(res, 400, { error: 'platform is required' })
        return
      }
      const token = await adminToken()
      const upstream = await fetch(`${baseURL}/api/keys`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: body.platform,
          ...typeof body.key === 'string' && body.key !== '' ? { key: body.key } : {},
          ...typeof body.label === 'string' && body.label !== '' ? { label: body.label } : {},
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const result = await upstream.json() as Record<string, unknown>
      if (!upstream.ok) {
        sendJson(res, 502, result)
        return
      }
      // New upstream key can grow the usable catalog; refresh the route.
      const stored = await webCtx.credentials.resolve(credentialRef(KEY_ENV))
      if (stored !== undefined) {
        try {
          const count = await registerRoute(stored.value)
          sendJson(res, 200, { ...result, models: count })
          return
        } catch {
          // key saved; the model refresh can wait for the next boot
        }
      }
      sendJson(res, 200, result)
    })

    register('/idealize/spend', false, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(spendPage())
    })

    register('/idealize/spend/by-project', false, async (req, res) => {
      const range = new URL(req.url ?? '/', 'http://localhost').searchParams.get('range') ?? '30d'
      const token = await adminToken()
      const upstream = await fetch(`${baseURL}/api/analytics/by-label?range=${encodeURIComponent(range)}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      sendJson(res, upstream.ok ? 200 : 502, await upstream.json())
    })

    register('/idealize/freetokens/adopt', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { apiKey?: unknown }
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (apiKey === '') {
        sendJson(res, 400, { error: 'apiKey is required' })
        return
      }
      if (!await detectSidecar(baseURL)) {
        sendJson(res, 502, { error: `no FreeLLMAPI sidecar answering at ${baseURL}` })
        return
      }
      const count = await registerRoute(apiKey)
      sendJson(res, 200, { ok: true, models: count })
    })
  })
}
